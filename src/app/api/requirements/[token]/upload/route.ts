import { NextResponse, type NextRequest } from "next/server";
import {
  storeClientDocument,
  type ClientDocType,
} from "@/lib/requirements/store";
import {
  resolveRequirementToken,
  settleToken,
} from "@/lib/requirements/token";

/**
 * Where a customer's ID and insurance certificate actually arrive.
 *
 * **A route handler, not a Server Function, and that is the whole design.**
 * Server Functions cap their request body at 1 MB (`serverActions.bodySizeLimit`
 * — see next/docs "Server Actions"), and to reach one at all the file has to be
 * base64'd first, which adds a third again. A photo of a driving licence taken
 * on a modern phone is 3–7 MB before encoding. Every real upload would have
 * failed, and failed with a framework error rather than anything a customer
 * could act on. Multipart form data on a route handler carries bytes as bytes.
 *
 * The ceiling here is 8 MB per file and it is not arbitrary. `src/proxy.ts`
 * matches this path, and a matched request has its body cloned and buffered so
 * it can be read twice — capped at `proxyClientMaxBodySize`, 10 MB by default,
 * past which **Next truncates the buffer and logs a warning rather than failing
 * the request**. A 12 MB upload would therefore arrive as a silently
 * half-written file that opens as a grey smear, and the customer would be told
 * it worked. So the limit sits below the truncation point and the length is
 * checked before a byte is read, which is the only place a real refusal can
 * still be sent.
 *
 * No session, by design: the person uploading has no login and never will. The
 * token in the URL is the entire authorization, so it is resolved first and
 * nothing — not the form parse, not a directory create — happens before it
 * comes back good.
 */

/** Below `proxyClientMaxBodySize`'s 10 MB, with room for the multipart wrapper. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;

const DOC_TYPES: ClientDocType[] = ["ID_FRONT", "ID_BACK", "COI"];

/** What each upload satisfies, so a link can only be used for what it asked. */
const SATISFIES = {
  ID_FRONT: "ID",
  ID_BACK: "ID",
  COI: "COI",
} as const;

/**
 * What a customer's phone or scanner will realistically produce. An allowlist
 * rather than a denylist: the file is written to disk and served back later,
 * and "anything but the ones we thought of" is not a rule that holds.
 */
const ACCEPTED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
};

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/requirements/[token]/upload">,
) {
  const { token } = await ctx.params;

  // First, and before anything is read from the body.
  const grant = await resolveRequirementToken(token);
  if (!grant.ok) {
    return NextResponse.json(
      { error: grant.message, reason: grant.reason },
      { status: grant.reason === "expired" ? 410 : 404, headers: NO_STORE },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error:
          "That file is too large to send. Anything up to 8 MB is fine — most phone cameras have a smaller setting, or a photo of the screen will do.",
      },
      { status: 413, headers: NO_STORE },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "That upload did not come through. Try it again." },
      { status: 400, headers: NO_STORE },
    );
  }

  const kind = String(form.get("type") ?? "") as ClientDocType;
  if (!DOC_TYPES.includes(kind)) {
    return NextResponse.json(
      { error: "Unknown document type." },
      { status: 400, headers: NO_STORE },
    );
  }

  // A link that asked only for insurance cannot be used to file an ID against
  // the account. The token says what it is for and that is what it is for.
  if (!grant.asked.includes(SATISFIES[kind])) {
    return NextResponse.json(
      { error: "This link did not ask for that document." },
      { status: 403, headers: NO_STORE },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "No file was attached." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error:
          "That file is over 8 MB. Send a smaller photo — a picture taken at a lower resolution is perfectly readable for this.",
      },
      { status: 413, headers: NO_STORE },
    );
  }

  const extension = ACCEPTED[file.type];
  if (!extension) {
    return NextResponse.json(
      {
        error:
          "That file type will not do — send a photo (JPEG, PNG or HEIC) or a PDF.",
      },
      { status: 415, headers: NO_STORE },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Guards the truncation case the length header cannot: a proxy-truncated body
  // parses to a short file rather than a failed request.
  if (bytes.length === 0) {
    return NextResponse.json(
      { error: "That upload arrived empty. Try it again." },
      { status: 400, headers: NO_STORE },
    );
  }

  const named = file.name && file.name.trim() ? file.name : `upload${extension}`;

  try {
    const result = await storeClientDocument(grant.clientId, kind, bytes, named);
    const settled = await settleToken(grant);
    return NextResponse.json(
      { ok: true, satisfied: result.satisfied, complete: settled },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("requirements upload failed", error);
    return NextResponse.json(
      {
        error:
          "We could not file that. Nothing was saved — try again, and tell us if it keeps happening.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}

// Customer identity documents. Never let anything between here and the phone
// keep a copy of the response, or of the fact one was made.
const NO_STORE = { "Cache-Control": "private, no-store" };
