import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { renderFlowQuotePdf } from "@/lib/flow/quote-pdf";

/**
 * The Flow quote PDF for an order, for staff to print or send by hand — the same
 * document the client signs online, unsigned (or showing the frozen terms and
 * autopay line once they have approved). Ported from v1's quote download route
 * (Flow branch); v1 offered it from the order's Print menu, v2 from the
 * Documents card.
 *
 * Session-gated: the client's copy is the signed one filed on approval, reached
 * through /api/documents. Rendered, never stored — each open reflects the order.
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
  const rendered = await renderFlowQuotePdf(id);
  if (!rendered.ok) {
    return NextResponse.json(
      { error: `This Flow quote cannot be generated right now: ${rendered.problem}` },
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
