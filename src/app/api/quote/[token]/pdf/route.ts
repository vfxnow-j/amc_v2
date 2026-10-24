import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderQuotePdf } from "@/lib/documents/signed-quote";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * The quote PDF for a client's link. The token is the authorisation, as it is
 * for the page itself: it must exist and not have expired. The PDF is the
 * order's own quote and nothing else — the token resolves to exactly one order,
 * so a client cannot ask for anybody else's. Rendering is costly, so it is
 * rate-limited per address; a refusal says only that, never why a token failed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit("quote-pdf", client, 20, 60_000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { token } = await params;
  const link = await prisma.quoteToken.findUnique({
    where: { token },
    select: { reservationId: true, expiresAt: true, reservation: { select: { status: true } } },
  });
  // Not while it is being revised: the PDF is rendered from the live order, so it
  // would carry half-finished edits the page itself refuses to show.
  if (!link || link.expiresAt < new Date() || link.reservation.status === "REVISION") {
    return NextResponse.json({ error: "This quote link is not available" }, { status: 404 });
  }

  const rendered = await renderQuotePdf(link.reservationId);
  if (!rendered.ok) {
    return NextResponse.json({ error: "This quote cannot be generated right now" }, { status: 409 });
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
