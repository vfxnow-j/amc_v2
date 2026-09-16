import { requireAuth } from "@/lib/auth-utils";
import { renderFundingRequestPdf } from "@/lib/actions/documents";

/**
 * The funding request form as a PDF, streamed inline.
 *
 * Rendered on demand, so it always matches the request as it stands. The copy
 * saved at submission is a different thing — what accounting was sent — and the
 * record lists it separately.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const rendered = await renderFundingRequestPdf(id);
  if (!rendered) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
