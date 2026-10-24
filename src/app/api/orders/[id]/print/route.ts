import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import {
  ORDER_DOCUMENT_KINDS,
  renderOrderDocument,
  type OrderDocumentKind,
} from "@/lib/documents/signed-quote";

/**
 * GET /api/orders/[id]/print?doc=quote|order-detail|delivery-note|asset-list
 *
 * The order's Print menu: each document rendered from the order as it stands,
 * never stored, so every open reflects the current lines and shipping. The
 * asset list takes `serials=1` to print each unit's serial beside its tag;
 * `download=1` forces a download instead of opening in the browser. Session
 * required — the client's own copy of the quote is on their link.
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
  const search = request.nextUrl.searchParams;
  const doc = search.get("doc") ?? "quote";
  if (!(ORDER_DOCUMENT_KINDS as readonly string[]).includes(doc)) {
    return NextResponse.json({ error: "Unknown document" }, { status: 400 });
  }

  const rendered = await renderOrderDocument(id, doc as OrderDocumentKind, {
    serials: search.get("serials") === "1",
  });
  if (!rendered.ok) {
    return NextResponse.json(
      { error: `This document cannot be generated right now: ${rendered.problem}` },
      { status: 409 },
    );
  }

  const download = search.get("download") === "1";
  return new NextResponse(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${rendered.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
