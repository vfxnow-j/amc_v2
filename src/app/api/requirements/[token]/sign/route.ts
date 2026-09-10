import { NextResponse, type NextRequest } from "next/server";
import { signAgreement, templatePathIfPresent } from "@/lib/requirements/store";
import { resolveRequirementToken, settleToken } from "@/lib/requirements/token";

/**
 * Signing the rental agreement from the portal.
 *
 * A route handler alongside the upload one rather than a Server Function, for
 * two reasons. A drawn signature arrives as a PNG data URL and a slow, careful
 * signature on a tablet runs to several hundred kilobytes — comfortably inside
 * the 1 MB action cap, but not so far inside that it is worth betting a
 * customer's signing session on. The stronger reason is that this is a public
 * surface: keeping it here means `lib/actions/agreement.ts` publishes no
 * ungated Server Function at all, and the token is the only key to any of it.
 *
 * Signing is refused outright when no template is configured. That is the state
 * this instance is actually in — `documents/templates/rental-agreement.pdf` was
 * not carried across in the refresh — and the honest failure is to say there is
 * nothing to sign, never to record an agreement against a document that does
 * not exist.
 */

/** A generous ceiling for a drawn signature; a real one is far under it. */
const MAX_SIGNATURE_CHARS = 900_000;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/requirements/[token]/sign">,
) {
  const { token } = await ctx.params;

  const grant = await resolveRequirementToken(token);
  if (!grant.ok) {
    return NextResponse.json(
      { error: grant.message, reason: grant.reason },
      { status: grant.reason === "expired" ? 410 : 404, headers: NO_STORE },
    );
  }

  if (!grant.asked.includes("AGREEMENT")) {
    return NextResponse.json(
      { error: "This link did not ask for a signature." },
      { status: 403, headers: NO_STORE },
    );
  }

  if (!(await templatePathIfPresent())) {
    return NextResponse.json(
      {
        error:
          "There is no agreement on file to sign yet. Nothing was recorded — please tell us and we will send the document across.",
      },
      { status: 409, headers: NO_STORE },
    );
  }

  let body: { signerName?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "That did not come through. Try signing again." },
      { status: 400, headers: NO_STORE },
    );
  }

  const signerName = typeof body.signerName === "string" ? body.signerName.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature : "";

  if (signerName.length < 2) {
    return NextResponse.json(
      { error: "Type the name of the person signing." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!signature.startsWith("data:image/png;base64,")) {
    return NextResponse.json(
      { error: "Draw a signature in the box before confirming." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (signature.length > MAX_SIGNATURE_CHARS) {
    return NextResponse.json(
      { error: "That signature is too large to record. Draw it again." },
      { status: 413, headers: NO_STORE },
    );
  }

  try {
    await signAgreement(grant.clientId, signerName, signature);
    const settled = await settleToken(grant);
    return NextResponse.json(
      { ok: true, complete: settled },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("requirements signing failed", error);
    return NextResponse.json(
      {
        error:
          "The agreement could not be recorded. Nothing was saved — please try again.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}

const NO_STORE = { "Cache-Control": "private, no-store" };
