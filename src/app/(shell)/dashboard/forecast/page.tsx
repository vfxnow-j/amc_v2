import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { ForecastChart, type ChartMonth } from "@/components/forecast/forecast-chart";
import { ChoiceSelect } from "@/components/forecast/choice-select";
import { ClientsCard } from "@/components/forecast/client-forecast";
import { FileSpreadsheet } from "lucide-react";
import { ForecastReport } from "@/components/forecast/forecast-report";
import { PrintButton } from "@/components/forecast/print-button";
import { businessToday } from "@/lib/billing/calendar";
import { PERIOD_LABEL, parsePeriod, periodMonths, type ExportPeriod } from "@/lib/forecast/period";
import { PeriodSelect } from "@/components/forecast/period-select";
import { money, moneyCompact } from "@/lib/format";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { STATUS_LABEL } from "@/lib/reservations/status";
import {
  BOOKED_STREAMS,
  KINDS,
  KIND_LABEL,
  STREAM_LABEL,
  getForecast,
  type Forecast,
  type ForecastDeal,
  type ForecastOrder,
  type Kind,
  type Stream,
} from "@/lib/queries/forecast";

export const metadata = { title: "Forecast" };

const TYPE_LABEL: Record<string, string> = {
  RENTAL: "Rental",
  SALE: "Sale",
  RENT_TO_OWN: "Rent-to-own",
  CLOUD: "Cloud",
  FLOW: "Flow",
};

/**
 * Accounting → Forecast: the business's money for the next twelve months on
 * one page — what is booked, what is expected, and when it lands as cash.
 *
 * The arithmetic is lib/queries/forecast.ts; this page only lays it out. Every
 * figure is ex-tax. Booked never mixes with expected: they are separate rows
 * and separate colours, and the headline figures say which they are.
 */
const kindRow = (fn: (k: Kind) => number) => Object.fromEntries(KINDS.map((k) => [k, fn(k)])) as Record<Kind, number>;

export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ view?: string; period?: string }> }) {
  const sp = await searchParams;
  const report = sp.view === "report";
  const period = parsePeriod(sp.period);
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/dashboard");

  return (
    <>
      <div data-print-hide className="contents">
        <PageHeader
          eyebrow="Accounting"
          title="Forecast"
          blurb="Twelve months of revenue already set, what's expected to sell, and when the cash lands — ex-tax, priced the way orders are invoiced."
          actions={
            <>
              <ViewToggle report={report} period={period} />
              <PeriodSelect value={period} report={report} />
              {report ? <PrintButton /> : null}
              <ExportForm period={period} />
            </>
          }
        />
      </div>
      {report ? (
        <Suspense fallback={<CardSkeleton title="Forecast report" rows={14} />}>
          <ReportBody period={period} />
        </Suspense>
      ) : (
      <Suspense
        fallback={
          <>
            <CardSkeleton title="Revenue by month" rows={8} />
            <CardSkeleton title="Month by month" rows={14} />
          </>
        }
      >
        <Body period={period} />
      </Suspense>
      )}
    </>
  );
}

async function ReportBody({ period }: { period: ExportPeriod }) {
  const f = await getForecast();
  return <ForecastReport f={f} period={period} monthKeys={periodMonths(period, businessToday(f.generatedAt))} />;
}

/** Dashboard ↔ printable report, same page, same numbers. */
function ViewToggle({ report, period }: { report: boolean; period: ExportPeriod }) {
  const cls = (on: boolean) =>
    `rounded-pill px-3 py-[6px] text-pill ${on ? "bg-accent-solid text-accent-on-solid" : "bg-sunken text-ink"}`;
  return (
    <nav aria-label="Forecast view" className="flex items-center gap-1">
      <Link href={`/dashboard/forecast?period=${period}`} className={cls(!report)}>
        Dashboard
      </Link>
      <Link href={`/dashboard/forecast?view=report&period=${period}`} className={cls(report)}>
        Report
      </Link>
    </nav>
  );
}

/** A plain GET form: the browser downloads the workbook for the period picked above, no script needed. */
function ExportForm({ period }: { period: ExportPeriod }) {
  return (
    <form action="/api/reports/forecast" method="get" className="flex items-center gap-2">
      <input type="hidden" name="period" value={period} />
      <button
        type="submit"
        className="flex items-center gap-1 rounded-pill bg-accent-solid px-3 py-[6px] text-pill text-accent-on-solid"
      >
        <FileSpreadsheet className="size-[13px]" aria-hidden /> Export Excel
      </button>
    </form>
  );
}

async function Body({ period }: { period: ExportPeriod }) {
  const full = await getForecast();
  // The grid, the headline figures and the cash lines are cut to the period;
  // the chart, the deal lists and the clients keep the whole twelve months.
  const inPeriod = new Set(periodMonths(period, businessToday(full.generatedAt)));
  const f: Forecast = { ...full, months: full.months.filter((m) => inPeriod.has(m.key)) };
  if (f.months.length === 0)
    return <CardEmpty>{PERIOD_LABEL[period]} is already past — there is no forecast for it. Pick a later period.</CardEmpty>;
  const keys = f.months.map((m) => m.key);
  const at = (stream: Stream, k: string) => f.revenue[stream][k] ?? 0;

  const recurringAt = (k: string) => at("rental", k) + at("cloud", k) + at("rto", k) + at("flow", k);
  const onceAt = (k: string) => at("oneTime", k) + at("sale", k);
  const expectedAt = (k: string) => at("playRecurring", k) + at("playOnce", k) + at("leads", k);
  const bookedTotal = keys.reduce((s, k) => s + recurringAt(k) + onceAt(k), 0);
  const expectedTotal = keys.reduce((s, k) => s + expectedAt(k), 0);
  const runRateMonth = full.months[1];
  const runRate = recurringAt(runRateMonth.key);

  const cashInBooked = (k: string) => BOOKED_STREAMS.reduce((s, st) => s + (f.cash[st][k] ?? 0), 0);
  const cashInExpected = (k: string) =>
    (f.cash.playRecurring[k] ?? 0) + (f.cash.playOnce[k] ?? 0) + (f.cash.leads[k] ?? 0);
  const cashOut = (k: string) =>
    f.cashOut.leases[k] + f.cashOut.purchaseOrders[k] + f.cashOut.expenses[k];
  const net90 = keys.reduce((s, k) => s + cashInBooked(k) - cashOut(k), 0);

  const chart: ChartMonth[] = [
    ...f.history.map((h) => ({
      key: h.key,
      short: h.short,
      past: true,
      earned: h.earned,
      booked: kindRow(() => 0),
      expected: kindRow(() => 0),
      prospects: 0,
      target: 0,
    })),
    ...full.months.map((m) => ({
      key: m.key,
      short: m.short,
      past: false,
      earned: 0,
      booked: kindRow((k) => at(k, m.key)),
      expected: kindRow((k) => f.expectedByKind[k][m.key] ?? 0),
      prospects: at("leads", m.key),
      target: f.targets[m.key] ?? 0,
    })),
  ];

  const counted = full.deals.filter((d) => d.orders.some((o) => o.counted));
  const uncounted = full.deals.filter((d) => !d.orders.some((o) => o.counted));
  const versionsHidden = full.deals.reduce((s, d) => s + d.orders.filter((o) => !o.counted && !o.stale).length, 0);
  const rolling = full.attention.rolling.length;

  return (
    <>
      <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`Booked · ${PERIOD_LABEL[period].toLowerCase()}`}
          value={moneyCompact(bookedTotal)}
          detail={`${full.booked.filter((o) => o.inWindow > 0).length} live orders · ${rolling} rolling past due`}
        />
        <Kpi
          label={`Recurring in ${runRateMonth.label.split(" ")[0]}`}
          value={moneyCompact(runRate)}
          detail="the first whole month, booked only"
        />
        <Kpi
          label="Expected on top"
          value={moneyCompact(expectedTotal)}
          detail={`${counted.length} deals in play, weighted by stage`}
          soft
        />
        <Kpi
          label={`Net cash · ${PERIOD_LABEL[period].toLowerCase()}`}
          value={moneyCompact(net90)}
          detail="booked cash in − leases and POs"
          tone={net90 < 0 ? "alert" : "plain"}
        />
      </section>

      <Card title="Revenue by month" meta="six months earned, twelve months set" className="shrink-0">
        <ForecastChart months={chart} />
      </Card>

      <MonthGrid f={f} periodLabel={PERIOD_LABEL[period]} recurringAt={recurringAt} onceAt={onceAt} expectedAt={expectedAt} cashInBooked={cashInBooked} cashInExpected={cashInExpected} cashOut={cashOut} />

      <ClientsCard f={full} />

      <div className="grid shrink-0 gap-3 xl:grid-cols-2">
        <BookedCard orders={full.booked} />
        <DealsCard counted={counted} uncounted={uncounted} versionsHidden={versionsHidden} leads={full.leads} />
      </div>

      <AttentionCard f={full} />
    </>
  );
}

function Kpi({
  label,
  value,
  detail,
  soft,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail: string;
  soft?: boolean;
  tone?: "plain" | "alert";
}) {
  return (
    <div className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p
        className={`mt-1 text-[26px] font-bold tabular-nums tracking-[-0.02em] ${
          tone === "alert" ? "text-destructive" : soft ? "text-ink-muted" : ""
        }`}
      >
        {value}
      </p>
      <p className="text-detail text-ink-faint">{detail}</p>
    </div>
  );
}

/* ── The grid ───────────────────────────────────────────────────────────── */

type RowSpec = { label: string; values: number[]; kind?: "total" | "soft" | "out" | "net" | "cum"; hint?: string };

function MonthGrid({
  f,
  recurringAt,
  onceAt,
  expectedAt,
  cashInBooked,
  cashInExpected,
  cashOut,
  periodLabel,
}: {
  f: Forecast;
  periodLabel: string;
  recurringAt: (k: string) => number;
  onceAt: (k: string) => number;
  expectedAt: (k: string) => number;
  cashInBooked: (k: string) => number;
  cashInExpected: (k: string) => number;
  cashOut: (k: string) => number;
}) {
  const keys = f.months.map((m) => m.key);
  const of = (fn: (k: string) => number) => keys.map(fn);
  const streamRow = (s: Stream, kind?: RowSpec["kind"]): RowSpec => ({
    label: STREAM_LABEL[s],
    values: of((k) => f.revenue[s][k] ?? 0),
    kind,
  });
  const nonZero = (r: RowSpec) => r.values.some((v) => Math.abs(v) >= 0.5);

  const revenue: RowSpec[] = [
    ...(["rental", "cloud", "rto", "flow", "oneTime", "sale"] as Stream[]).map((s) => streamRow(s)).filter(nonZero),
    { label: "Booked", values: of((k) => recurringAt(k) + onceAt(k)), kind: "total" },
    ...KINDS.map((k): RowSpec => ({
      label: `${KIND_LABEL[k]} — quotes, weighted`,
      values: of((m) => f.expectedByKind[k][m] ?? 0),
      kind: "soft",
    })).filter(nonZero),
    { ...streamRow("leads", "soft"), label: "Prospects — leads, weighted" },
    { label: "Booked + expected", values: of((k) => recurringAt(k) + onceAt(k) + expectedAt(k)), kind: "total" },
  ];
  const targets = of((k) => f.targets[k] ?? 0);
  if (targets.some((v) => v > 0)) revenue.push({ label: "Target", values: targets, kind: "soft" });

  const net = of((k) => cashInBooked(k) - cashOut(k));
  const cumulative = net.map((_, i) => net.slice(0, i + 1).reduce((a, b) => a + b, 0));
  const cash: RowSpec[] = [
    { label: "Cash in — booked", values: of(cashInBooked), hint: f.carriedIn > 0 ? `includes ${money(f.carriedIn)} billed before ${f.months[0].short} and due after` : undefined },
    { label: "Lease payments", values: of((k) => -f.cashOut.leases[k]), kind: "out" },
    { label: "Purchase orders", values: of((k) => -f.cashOut.purchaseOrders[k]), kind: "out" },
    { label: "Expenses & payroll", values: of((k) => -f.cashOut.expenses[k]), kind: "out" },
    { label: "Net cash — booked", values: net, kind: "net" },
    { label: "Running total", values: cumulative, kind: "cum" },
    { label: "Expected cash on top", values: of(cashInExpected), kind: "soft" },
  ].filter((r) => r.kind === "net" || r.kind === "cum" || nonZero(r as RowSpec)) as RowSpec[];

  const cols = `minmax(150px,1.5fr) repeat(${keys.length}, minmax(64px,1fr)) minmax(84px,1.1fr)`;

  return (
    <Card title="Month by month" meta={`${periodLabel} · ex-tax · revenue when billed, cash when due by terms`} className="shrink-0">
      <div className="overflow-x-auto pb-3">
        <div className="min-w-[1080px] px-2 text-detail">
          <div className="grid gap-x-1 px-2 pb-[6px] text-colhead uppercase text-ink-muted" style={{ gridTemplateColumns: cols }}>
            <span />
            {f.months.map((m) => (
              <span key={m.key} className="text-right">{m.short}</span>
            ))}
            <span className="text-right">{keys.length === 12 ? "12 mo" : "Total"}</span>
          </div>
          <Section title="Revenue" rows={revenue} cols={cols} />
          <Section title="Cash" rows={cash} cols={cols} />
        </div>
      </div>
      {f.cashOut.expenses && Object.values(f.cashOut.expenses).every((v) => v === 0) ? (
        <p className="px-4 pb-4 text-detail text-ink-muted">
          No expenses or payroll are recorded for these months, so net cash counts only leases and purchase orders. Set
          them per month on{" "}
          <Link href="/dashboard/reports/forecast" className="text-accent-text hover:underline">
            Reports → Forecast
          </Link>{" "}
          and they appear here.
        </p>
      ) : null}
    </Card>
  );
}

function Section({ title, rows, cols }: { title: string; rows: RowSpec[]; cols: string }) {
  return (
    <div className="mt-2">
      <p className="px-2 pb-1 pt-2 text-micro uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="flex flex-col gap-px">
        {rows.map((r) => {
          const total = r.kind === "cum" ? r.values[r.values.length - 1] : r.values.reduce((a, b) => a + b, 0);
          const strong = r.kind === "total" || r.kind === "net";
          return (
            <li
              key={r.label}
              className={`grid items-baseline gap-x-1 rounded-row px-2 py-[6px] ${
                strong ? "bg-sunken font-bold" : "hover:bg-row-hover"
              } ${r.kind === "soft" ? "text-ink-muted" : ""}`}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="truncate" title={r.hint}>
                {r.label}
                {r.hint ? <span className="ml-1 text-ink-faint">ⓘ</span> : null}
              </span>
              {r.values.map((v, i) => (
                <Cell key={i} value={v} kind={r.kind} />
              ))}
              <Cell value={total} kind={r.kind} strong />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cell({ value, kind, strong }: { value: number; kind?: RowSpec["kind"]; strong?: boolean }) {
  const zero = Math.abs(value) < 0.5;
  const negative = value < -0.5 && (kind === "net" || kind === "cum");
  return (
    <span
      className={`text-right tabular-nums ${zero ? "text-ink-faint" : ""} ${negative ? "text-destructive" : ""} ${
        strong ? "font-bold" : ""
      }`}
    >
      {zero ? "—" : money(value)}
    </span>
  );
}

/* ── Booked ─────────────────────────────────────────────────────────────── */

function BookedCard({ orders }: { orders: ForecastOrder[] }) {
  const shown = orders.filter((o) => o.inWindow > 0).sort((a, b) => b.inWindow - a.inWindow);
  return (
    <Card title="Booked" meta={`${shown.length} orders · ${money(shown.reduce((s, o) => s + o.inWindow, 0))} in the window`}>
      {shown.length === 0 ? (
        <CardEmpty>Nothing approved or live bills in the next twelve months.</CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_84px_92px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
            <span>Order</span>
            <span>Term</span>
            <span className="text-right">Monthly</span>
            <span className="text-right">12 months</span>
          </div>
          <ul className="flex max-h-[560px] flex-col gap-px overflow-y-auto px-2 pb-3">
            {shown.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/dashboard/orders/${o.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_84px_92px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{o.client}</span>
                    <span className="block truncate text-ink-muted">
                      {o.number} · {TYPE_LABEL[o.type] ?? o.type}
                      {o.status !== "ACTIVE" ? ` · ${STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status}` : ""}
                    </span>
                  </span>
                  <span className={`truncate ${o.overdue ? "text-accent-text" : "text-ink-muted"}`} title={o.term}>
                    {o.term}
                  </span>
                  <span className="text-right tabular-nums">{o.monthly == null ? "—" : money(o.monthly)}</span>
                  <span className="text-right font-bold tabular-nums">{money(o.inWindow)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-4 text-detail text-ink-muted">
            Monthly is what the gear out now bills in a whole month. Each unit bills until its return date; one past
            its return date and still out rolls month to month.
          </p>
        </>
      )}
    </Card>
  );
}

/* ── In play ────────────────────────────────────────────────────────────── */

function DealsCard({
  counted,
  uncounted,
  versionsHidden,
  leads,
}: {
  counted: ForecastDeal[];
  uncounted: ForecastDeal[];
  versionsHidden: number;
  leads: Forecast["leads"];
}) {
  const weighted = counted.reduce(
    (s, d) => s + d.orders.filter((o) => o.counted).reduce((t, o) => t + o.inWindow * o.weight, 0),
    0,
  );
  const staleValue = uncounted.reduce((s, d) => s + Math.max(...d.orders.map((o) => o.inWindow)), 0);
  return (
    <Card
      title="In play"
      meta={`${counted.length} deals · ${money(weighted)} weighted${versionsHidden ? ` · ${versionsHidden} duplicate versions not counted` : ""}`}
    >
      {counted.length === 0 ? (
        <CardEmpty>No open quote is being counted.</CardEmpty>
      ) : (
        <ul className="flex max-h-[560px] flex-col gap-2 overflow-y-auto px-2 pb-3">
          {counted.map((d) => (
            <Deal key={d.key} deal={d} />
          ))}
        </ul>
      )}

      {uncounted.length > 0 ? (
        <details className="mx-4 mb-3 rounded-well bg-sunken">
          <summary className="cursor-pointer px-3 py-2 text-detail">
            <span className="font-bold">{uncounted.length} stale deals not counted</span>{" "}
            <span className="text-ink-muted">
              · {money(staleValue)}{" "}unweighted · untouched for 90 days. Set one to &ldquo;Count this&rdquo; if it&rsquo;s still alive.
            </span>
          </summary>
          <ul className="flex flex-col gap-2 px-1 pb-2">
            {uncounted.map((d) => (
              <Deal key={d.key} deal={d} />
            ))}
          </ul>
        </details>
      ) : null}

      {leads.length > 0 ? (
        <div className="border-t border-hairline px-4 py-3 text-detail">
          <p className="pb-1 font-bold">
            Leads <span className="font-normal text-ink-muted">· no order yet, spread over three months</span>
          </p>
          <ul className="flex flex-col gap-px">
            {leads.map((l) => (
              <li key={l.id}>
                <Link href={`/dashboard/leads/${l.id}`} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-row py-[3px] hover:bg-row-hover">
                  <span className="truncate">
                    {l.name}
                    {l.company ? <span className="text-ink-muted"> · {l.company}</span> : null}
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {money(l.value)} × {Math.round(l.weight * 100)}%
                  </span>
                  <span className="w-[72px] text-right tabular-nums">{money(l.value * l.weight)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Deal({ deal }: { deal: ForecastDeal }) {
  const versions = deal.orders.length;
  return (
    <li className="rounded-well border border-hairline">
      <p className="flex items-baseline gap-2 px-3 pt-2 text-detail">
        <span className="truncate font-bold">{deal.client}</span>
        {versions > 1 ? <span className="rounded-pill bg-accent-tint px-2 text-pill text-accent-on-tint">{versions} versions</span> : null}
      </p>
      <ul className="flex flex-col gap-px px-1 pb-1">
        {deal.orders.map((o) => (
          <li
            key={o.id}
            className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-row px-2 py-[5px] text-detail ${
              o.counted ? "" : "text-ink-muted"
            }`}
          >
            <Link href={`/dashboard/orders/${o.id}`} className="min-w-0 hover:underline">
              <span className={`block truncate ${o.counted ? "" : "line-through decoration-ink-faint"}`}>
                {o.counted ? "✓ " : ""}
                {o.name || o.number}
              </span>
              <span className="block truncate text-ink-faint">
                {o.number} · {TYPE_LABEL[o.type] ?? o.type} · {STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status}
                {o.monthly ? ` · ${money(o.monthly)}/mo` : ""}
                {o.startShifted ? " · start moved to this month" : ""}
                {o.quoteExpired ? " · quote expired" : ""}
                {o.reason ? ` · ${o.reason}` : ""}
              </span>
            </Link>
            <span className="text-right tabular-nums">
              <span className={o.counted ? "font-bold" : ""}>{money(o.inWindow * o.weight)}</span>
              <span className="block text-micro text-ink-faint">
                {money(o.inWindow)} × {Math.round(o.weight * 100)}%
              </span>
            </span>
            <ChoiceSelect orderId={o.id} value={o.choice} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/* ── Attention ──────────────────────────────────────────────────────────── */

function AttentionCard({ f }: { f: Forecast }) {
  const a = f.attention;
  const items: { key: string; title: string; body: React.ReactNode }[] = [];
  if (a.staleBooked.length)
    items.push({
      key: "stale",
      title: `${a.staleBooked.length} approved orders never went out`,
      body: (
        <>
          Their start date passed before they shipped, so nobody can say when they bill — not counted until re-dated or
          closed: <OrderLinks orders={a.staleBooked} />
        </>
      ),
    });
  if (a.nothingOut.length)
    items.push({
      key: "back",
      title: `${a.nothingOut.length} orders still active with everything back`,
      body: (
        <>
          Every unit has been checked in, so nothing bills — close them out: <OrderLinks orders={a.nothingOut} />
        </>
      ),
    });
  if (a.rolling.length)
    items.push({
      key: "rolling",
      title: `${a.rolling.reduce((s, o) => s + (o.overdue?.units ?? 0), 0)} units past their return date, still out`,
      body: (
        <>
          Counted as rolling month to month, by the rule that a rental past its end keeps billing. If they&rsquo;re
          really coming back, set the return date on the checkout: <OrderLinks orders={a.rolling} />
        </>
      ),
    });
  if (a.neverOut.length)
    items.push({
      key: "never",
      title: `${money(a.neverOut.reduce((s, o) => s + o.neverOut, 0))}/mo of priced lines never went out`,
      body: (
        <>
          Lines on live orders with no unit ever checked out against them, so they bill nothing here — ship them or
          take them off:{" "}
          {a.neverOut.map((o, i) => (
            <span key={o.id}>
              {i ? ", " : ""}
              <Link href={`/dashboard/orders/${o.id}`} className="text-accent-text hover:underline">
                {o.number}
              </Link>{" "}
              ({money(o.neverOut)})
            </span>
          ))}
          .
        </>
      ),
    });
  if (a.noBillableLines.length)
    items.push({
      key: "zero",
      title: `${a.noBillableLines.length} live rentals bill $0 a month`,
      body: (
        <>
          The gear still out sits on $0 lines — comped, or a price never set: <OrderLinks orders={a.noBillableLines} />
        </>
      ),
    });
  if (a.notBilled.length)
    items.push({
      key: "nb",
      title: `${a.notBilled.length} orders are marked not billed`,
      body: <>Evaluations or gifts, left out on purpose: {a.notBilled.map((o) => o.number).join(", ")}.</>,
    });
  if (a.leasesWithoutTerms)
    items.push({
      key: "leases",
      title: `${a.leasesWithoutTerms} active leases have no payment on file`,
      body: (
        <>
          Cash out is understated by whatever they cost each month.{" "}
          <Link href="/dashboard/leases" className="text-accent-text hover:underline">
            Add their terms →
          </Link>
        </>
      ),
    });
  if (a.draftPurchaseOrders.count)
    items.push({
      key: "po",
      title: `${a.draftPurchaseOrders.count} draft purchase orders not counted`,
      body: <>{money(a.draftPurchaseOrders.total)} — only submitted POs count as cash out.</>,
    });

  return (
    <Card title="Check these" meta={items.length ? `${items.length} things the numbers depend on` : "nothing"} className="shrink-0">
      {items.length === 0 ? (
        <CardEmpty>Every live order is priced, dated and counted.</CardEmpty>
      ) : (
        <ul className="grid gap-2 px-4 pb-4 md:grid-cols-2">
          {items.map((i) => (
            <li key={i.key} className="rounded-well bg-sunken p-3 text-detail">
              <p className="font-bold">{i.title}</p>
              <p className="mt-1 text-ink-muted">{i.body}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="px-4 pb-4 text-detail text-ink-muted">
        Invoices aren&rsquo;t used: the ones in the system are v1 drafts nobody sent, so cash is projected from each
        order&rsquo;s schedule and payment terms instead. Weights by stage — quote sent 60%, draft or revision 40%, leads
        10–50% — match{" "}
        <Link href="/dashboard/reports/forecast" className="text-accent-text hover:underline">
          Reports → Forecast
        </Link>
        .
      </p>
    </Card>
  );
}

function OrderLinks({ orders }: { orders: ForecastOrder[] }) {
  return (
    <>
      {orders.map((o, i) => (
        <span key={o.id}>
          {i ? ", " : ""}
          <Link href={`/dashboard/orders/${o.id}`} className="text-accent-text hover:underline">
            {o.number}
          </Link>
        </span>
      ))}
      .
    </>
  );
}

