import { NextResponse, type NextRequest } from "next/server";
import { createElement } from "react";
import { requireAdmin } from "@/lib/auth-utils";
import type { OwnershipType } from "@/generated/prisma/client";
import { FixedAssetsPDF } from "@/components/documents/fixed-assets-pdf";
import { getServerLogoDataUri } from "@/lib/actions/documents";
import { renderPdf } from "@/lib/notifications/reports/pdf";
import {
  FIXED_ASSET_VIEWS,
  fixedAssetCategories,
  fixedAssetsCsv,
  getFixedAssets,
  OWNERSHIP_LABEL,
  type FixedAssetView,
} from "@/lib/queries/fixed-assets";

/**
 * Export the fixed asset register exactly as filtered on screen:
 * `?format=pdf|csv&view=&ownership=&category=&q=`. Admins only, like the screen
 * — cost, financing and book values are accounting's.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const view = (FIXED_ASSET_VIEWS as readonly string[]).includes(params.get("view") ?? "")
    ? (params.get("view") as FixedAssetView)
    : "in-service";
  const ownershipParam = params.get("ownership");
  const ownership = ownershipParam && ownershipParam in OWNERSHIP_LABEL ? (ownershipParam as OwnershipType) : undefined;
  const categoryId = params.get("category") || undefined;
  const query = params.get("q") || undefined;

  const { rows, totals, generatedAt } = await getFixedAssets({ view, ownership, categoryId, query });
  const stamp = generatedAt.toISOString().slice(0, 10);

  if (params.get("format") === "csv") {
    return new NextResponse(fixedAssetsCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fixed-assets-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const category = categoryId ? (await fixedAssetCategories()).find((row) => row.id === categoryId)?.name : null;
  const scope = [
    view === "in-service" ? "In service" : view === "disposed" ? "Disposed" : "All units",
    ownership ? OWNERSHIP_LABEL[ownership] : null,
    category,
    query ? `matching “${query}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const logoDataUri = await getServerLogoDataUri().catch(() => undefined);
  const buffer = await renderPdf(createElement(FixedAssetsPDF, { rows, totals, scope, generatedAt, logoDataUri }));
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="fixed-assets-${stamp}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
