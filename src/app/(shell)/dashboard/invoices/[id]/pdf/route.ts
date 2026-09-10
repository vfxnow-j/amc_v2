import { requireAuth } from "@/lib/auth-utils";
import { renderInvoicePdf } from "@/lib/accounting/invoice-pdf";

/**
 * The invoice as a PDF, streamed inline so the browser's own viewer opens it.
 *
 * A route handler rather than a client dialog: the record then carries no PDF
 * renderer in its bundle, the link works from the keyboard, and it can be
 * right-clicked to save. `proxy.ts` already bounces an anonymous request to
 * /login, but the session is re-checked here — the proxy is a redirect layer,
 * not the authorization boundary, and this hands out a customer's billing
 * address.
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
  const rendered = await renderInvoicePdf(id);
  if (!rendered) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.filename}"`,
      // A draft can change between one look and the next.
      "Cache-Control": "private, no-store",
    },
  });
}
