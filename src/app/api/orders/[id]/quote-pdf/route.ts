import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { renderQuotePdf } from "@/lib/documents/signed-quote";

/**
 * The quote PDF for an order — rental, sale, rent-to-own or Flow — for staff to
 * open, print or attach by hand. Rendered from the order as it stands, never
 * stored, so every open reflects the current lines. It was v1's Print → Quote;
 * v2's order page has no Print menu, so it sits in the Documents card.
 *
 * Session-gated. The client's own copy is the one on their quote link
 * (/api/quote/[token]/pdf) and, once they sign, the filed one in /api/documents.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth();
  if (!authResult.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rendered = await renderQuotePdf(id);
  if (!rendered.ok) {
    return NextResponse.json(
      { error: `This quote cannot be generated right now: ${rendered.problem}` },
      { status: 409 },
    );
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${rendered.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
