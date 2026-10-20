import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-utils";
import { businessToday } from "@/lib/billing/calendar";
import { buildForecastWorkbook } from "@/lib/forecast/export";
import { parsePeriod } from "@/lib/forecast/period";
import { getForecast } from "@/lib/queries/forecast";

/**
 * Export Accounting → Forecast as a workbook: `?period=month|next-month|quarter|
 * next-quarter|year|12m` (default 12m). Admins only, like the screen. Built from
 * the same getForecast the page renders, so the two cannot disagree.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });

  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  const now = new Date();
  const forecast = await getForecast(now);
  const workbook = await buildForecastWorkbook(forecast, period, businessToday(now));
  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="forecast-${period}-${now.toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
