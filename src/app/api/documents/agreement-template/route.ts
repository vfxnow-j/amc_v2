import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { writeTemplate } from "@/lib/requirements/store";

/**
 * Uploading the rental agreement template.
 *
 * This was a latent fault, not a new feature. `uploadAgreementTemplate` was a
 * Server Function taking the PDF as a base64 string, and Server Function
 * requests are capped at 1 MB (`serverActions.bodySizeLimit`) — base64 costs a
 * third on top, so any template over roughly 750 KB failed, and failed with a
 * framework error rather than anything the settings screen could explain. A
 * rental agreement with a logo and a scanned schedule is comfortably past that.
 * Nobody had hit it because there is no template in this instance at all yet,
 * which is precisely the kind of bug that surfaces on the day it matters most.
 *
 * Multipart on a route handler, then, exactly like the customer-facing upload
 * — and 8 MB for the same reason set out there: `src/proxy.ts` matches this
 * path, and a matched body is buffered to 10 MB and **truncated silently**
 * past it. A truncated PDF is worse than a rejected one; `pdf-lib` would fail
 * to load it later, in front of a customer mid-signature.
 *
 * Admin only. The session is required twice over — the proxy redirects an
 * anonymous request because `/api/documents` is in neither public list, and
 * `requireAdmin` here is the gate that actually decides, because the proxy is
 * explicitly not the authorization boundary in this app.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error ?? "Admin access required" },
      { status: auth.error === "Unauthorized" ? 401 : 403 },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "That PDF is too large — 8 MB is the ceiling." },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload did not parse." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "The template has to be a PDF — that is what gets signed." },
      { status: 415 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "That PDF is over 8 MB. Flatten or compress it and try again." },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // A truncated body parses as a short file rather than a failed request, and
  // a PDF that does not end in its trailer is not a PDF.
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    return NextResponse.json(
      { error: "That file does not read as a PDF. It may not have uploaded whole." },
      { status: 400 },
    );
  }

  const meta = await writeTemplate(bytes, file.name || "rental-agreement.pdf", auth.userId);

  await logAudit({
    action: "UPDATE",
    entityType: "Settings",
    entityId: "rental_agreement_template",
    newValues: { filename: meta.filename, fileSize: meta.fileSize },
    userId: auth.userId,
  });

  return NextResponse.json({ ok: true, template: meta });
}
