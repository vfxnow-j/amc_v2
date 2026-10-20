import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-utils";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { buildMonthEndWorkbook } from "@/lib/month-end/workbook";
import { parseMonth } from "@/lib/month-end/month";

/**
 * Export Accounting → Month-end as a workbook: `?month=YYYY-MM` (default last
 * month). Admins only, like the screen — cost and book values are accounting's.
 * Built from the same loader the page renders, so the two cannot disagree.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });

  const month = parseMonth(request.nextUrl.searchParams.get("month"));
  const { workbook } = await buildMonthEndWorkbook(month, { revenue: getEarnedRevenue });
  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="month-end-${month}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
