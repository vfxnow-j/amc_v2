import { requireAuth } from "@/lib/auth-utils";
import { renderPurchaseOrderPdf } from "@/lib/actions/documents";

/**
 * The purchase order as a PDF, streamed inline.
 *
 * The renderer already existed server-side — `renderPurchaseOrderPdf` was
 * written for the email attachment — so this is only the route in front of it,
 * and the record needs no PDF code in its bundle. It renders the PO as it
 * stands, which is deliberately not the same as the saved `Document`: that one
 * is a snapshot from the moment of receipt, and both are worth having.
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
  const rendered = await renderPurchaseOrderPdf(id);
  if (!rendered) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
