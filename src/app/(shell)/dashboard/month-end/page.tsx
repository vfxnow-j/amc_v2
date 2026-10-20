import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardSkeleton } from "@/components/record/record-card";
import { money } from "@/lib/format";
import { monthLabel, parseMonth, shiftMonth } from "@/lib/month-end/month";
import { loadMonthEnd } from "@/lib/queries/month-end";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Month-end" };

const th = "px-2 py-[6px] text-right text-colhead uppercase text-ink-muted";
const td = "px-2 py-[6px] text-right tabular-nums";

/**
 * Accounting → Month-end: the fixed-asset roll-forward for a month (opening,
 * additions, disposals at book value, depreciation, closing) and the year so
 * far, with the full workbook behind it. Ported from v1 (2026-10-19).
 *
 * The arithmetic is lib/month-end/roll.ts; this page only lays it out.
 */
export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.month);
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/dashboard");

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Month-end"
        blurb="Fixed assets rolled forward for the month: each model's useful life, straight line, $0 salvage, from the received date, a full month in the month it arrives. The workbook adds the register, additions, disposals with fees and net, each unit's lifeline and the exceptions."
        actions={
          <>
            <nav aria-label="Month" className="flex items-center gap-1">
              <Link href={`/dashboard/month-end?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className="rounded-pill bg-sunken p-[6px]">
                <ChevronLeft className="size-[14px]" aria-hidden />
              </Link>
              <span className="min-w-[8.5rem] text-center text-pill">{monthLabel(month)}</span>
              <Link href={`/dashboard/month-end?month=${shiftMonth(month, 1)}`} aria-label="Next month" className="rounded-pill bg-sunken p-[6px]">
                <ChevronRight className="size-[14px]" aria-hidden />
              </Link>
            </nav>
            {/* A plain GET form: the browser downloads the workbook for the month above. */}
            <form action="/api/reports/month-end" method="get">
              <input type="hidden" name="month" value={month} />
              <button type="submit" className="flex items-center gap-1 rounded-pill bg-accent-solid px-3 py-[6px] text-pill text-accent-on-solid">
                <FileSpreadsheet className="size-[13px]" aria-hidden /> Export Excel
              </button>
            </form>
          </>
        }
      />
      <Suspense
        fallback={
          <>
            <CardSkeleton title="Roll-forward" rows={7} />
            <CardSkeleton title="By month" rows={8} />
          </>
        }
      >
        <Body month={month} />
      </Suspense>
    </>
  );
}

async function Body({ month }: { month: string }) {
  const { byMonth, roll } = await loadMonthEnd(month);
  const gain = (n: number) => (n >= 0 ? "text-success" : "text-destructive");

  const rows: { label: string; units: number | null; cost: number | null; accum: number | null; nbv: number | null; bold?: boolean }[] = [
    { label: "Opening", units: roll.opening.count, cost: roll.opening.cost, accum: roll.opening.accum, nbv: roll.opening.nbv, bold: true },
    { label: "+ Additions", units: roll.additions.count, cost: roll.additions.cost, accum: 0, nbv: roll.additions.cost },
    { label: "− Disposals, at book value", units: roll.disposals.count, cost: -roll.disposals.cost, accum: -roll.disposals.accum, nbv: -roll.disposals.nbv },
    { label: "− Depreciation", units: null, cost: null, accum: roll.depreciation, nbv: -roll.depreciation },
    { label: "Closing", units: roll.closing.count, cost: roll.closing.cost, accum: roll.closing.accum, nbv: roll.closing.nbv, bold: true },
  ];
  const cell = (n: number | null) => (n == null ? "" : money(n));

  return (
    <div className="grid gap-[14px] lg:grid-cols-3">
      <Card title={`Roll-forward — ${monthLabel(month)}`} meta="units with a known in-service date" className="lg:col-span-2">
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-detail">
            <thead>
              <tr className="border-b border-hairline">
                <th className={`${th} text-left`} />
                <th className={th}>Units</th>
                <th className={th}>Cost</th>
                <th className={th}>Accum. depr.</th>
                <th className={th}>Net book value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={`border-b border-hairline ${r.bold ? "font-bold" : ""}`}>
                  <td className="px-2 py-[6px]">{r.label}</td>
                  <td className={td}>{r.units ?? ""}</td>
                  <td className={td}>{cell(r.cost)}</td>
                  <td className={td}>{cell(r.accum)}</td>
                  <td className={td}>{cell(r.nbv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-1.5 px-2 text-detail">
            {roll.check === 0 ? (
              <>
                <CheckCircle2 className="size-[14px] text-success" aria-hidden /> Balances: opening + additions − disposals − depreciation = closing.
              </>
            ) : (
              <>
                <TriangleAlert className="size-[14px] text-destructive" aria-hidden /> Out of balance by {money(roll.check)}.
              </>
            )}
          </p>
        </div>
      </Card>

      <Card title="Disposals in month">
        <dl className="flex flex-col gap-[6px] px-4 pb-4 text-detail">
          <Line label="Sale proceeds" value={money(roll.disposals.proceeds)} />
          <Line label="Selling fees" value={`−${money(roll.disposals.fees)}`} />
          <Line label="Net proceeds" value={money(roll.disposals.net)} bold />
          <Line label="Book value disposed" value={`−${money(roll.disposals.nbv)}`} />
          <Line label="Gain / (loss)" value={money(roll.disposals.gainLoss)} bold tone={gain(roll.disposals.gainLoss)} />
          <p className="pt-3 text-micro text-ink-faint">
            Also carried at cost, in-service date unknown (import stamp): {roll.unknownDate.closeCount} units, {money(roll.unknownDate.closeCost)}.
          </p>
        </dl>
      </Card>

      <Card title={`By month — ${month.slice(0, 4)}`} className="lg:col-span-3">
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-detail">
            <thead>
              <tr className="border-b border-hairline">
                <th className={`${th} text-left`}>Month</th>
                <th className={th}>Opening NBV</th>
                <th className={th}>Additions</th>
                <th className={th}>Disposed NBV</th>
                <th className={th}>Depreciation</th>
                <th className={th}>Closing NBV</th>
                <th className={th}>Units</th>
                <th className={th}>Net proceeds</th>
                <th className={th}>Gain / (loss)</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.map((m) => (
                <tr key={m.month} className={`border-b border-hairline ${m.month === month ? "bg-row-alt font-bold" : ""}`}>
                  <td className="px-2 py-[6px]">
                    <Link href={`/dashboard/month-end?month=${m.month}`} className="hover:underline">
                      {m.month}
                    </Link>
                  </td>
                  <td className={td}>{money(m.opening.nbv)}</td>
                  <td className={td}>
                    {m.additions.count} · {money(m.additions.cost)}
                  </td>
                  <td className={td}>
                    {m.disposals.count} · {money(m.disposals.nbv)}
                  </td>
                  <td className={td}>{money(m.depreciation)}</td>
                  <td className={td}>{money(m.closing.nbv)}</td>
                  <td className={td}>{m.closing.count}</td>
                  <td className={td}>{money(m.disposals.net)}</td>
                  <td className={`${td} ${gain(m.disposals.gainLoss)}`}>{money(m.disposals.gainLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 px-2 text-micro text-ink-faint">
            Early-year disposals are mostly the legacy &ldquo;Not in warehouse&rdquo; import cleanup — the workbook flags them as unconfirmed, not real write-offs.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd className={`tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
