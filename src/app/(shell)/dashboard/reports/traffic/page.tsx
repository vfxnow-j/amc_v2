import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { dayYear, money } from "@/lib/format";
import { getTrafficReport } from "@/lib/actions/reports";

export const metadata = { title: "Traffic" };

/**
 * How far back the movement log is read.
 *
 * A window, not a pair of date pickers. Every question this report answers —
 * what has been moving, what is out too long, what came back broken — is asked
 * of a period, and three named periods cover them without anyone typing a
 * date. `getTrafficReport` takes real bounds, so "all" is simply a start date
 * older than the business.
 */
const WINDOWS = {
  "3m": { label: "3 months", months: 3 },
  "12m": { label: "12 months", months: 12 },
  all: { label: "All", months: 600 },
} as const;

type WindowKey = keyof typeof WINDOWS;

/**
 * `hasOwn` rather than `in`: `in` walks the prototype chain, so `?window=toString`
 * would have passed as a key and then read a function off Object.prototype,
 * leaving `months` undefined and the range query holding an Invalid Date.
 */
function isWindow(value: unknown): value is WindowKey {
  return typeof value === "string" && Object.hasOwn(WINDOWS, value);
}

/** Unit · Asset · Client · Out · Back · Days · Charge */
const COLUMNS: Column[] = [
  { key: "unit", label: "Unit", width: "116px" },
  { key: "asset", label: "Asset", width: "minmax(0,1.4fr)" },
  { key: "client", label: "Client", width: "minmax(0,1fr)" },
  { key: "out", label: "Out", width: "88px" },
  { key: "back", label: "Back", width: "88px" },
  { key: "days", label: "Days", width: "60px", align: "right" },
  { key: "charge", label: "Charge", width: "92px", align: "right" },
];

/**
 * Reports → Traffic.
 *
 * One row per movement of one unit — `Checkout` is append-only, so this is the
 * physical record of where the hardware has been, and the only report that can
 * answer "who had this serial in March".
 *
 * Damage is the flag, not lateness. A late return is already the Overview's
 * job and the Today queue's; a unit that came back damaged is a fact recorded
 * once, at check-in, and never surfaced anywhere else in the app.
 */
export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; q?: string }>;
}) {
  const params = await searchParams;
  const window: WindowKey = isWindow(params.window) ? params.window : "3m";
  const search = params.q?.trim() ?? "";

  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Traffic"
        blurb="Every check-out and return, one row per unit per movement."
        actions={
          <>
            <ListSearch placeholder="Search unit, serial, asset or client" />
            <BackToReports />
          </>
        }
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={220} />}>
          <FilterTabs
            param="window"
            value={window}
            fallback="3m"
            label="How far back"
            options={Object.entries(WINDOWS).map(([value, option]) => ({
              value,
              label: option.label,
            }))}
          />
        </Suspense>
      </div>

      <Suspense key={`${window}:${search}`} fallback={<ListTableSkeleton />}>
        <Table window={window} search={search} />
      </Suspense>
    </>
  );
}

async function Table({
  window,
  search,
}: {
  window: WindowKey;
  search: string;
}) {
  const start = new Date();
  start.setMonth(start.getMonth() - WINDOWS[window].months);

  const { items, summary } = await getTrafficReport({
    startDate: start,
    endDate: new Date(),
    search: search || undefined,
  });

  return (
    <ListTable
      columns={COLUMNS}
      total={items.length}
      empty={
        search ? (
          <>
            Nothing in the last {WINDOWS[window].label.toLowerCase()} matches
            &ldquo;{search}&rdquo;. Try a wider window, or search by barcode.
          </>
        ) : (
          <>
            No unit moved in this window. Check something out from an order and
            the movement lands here.
          </>
        )
      }
      footerNote={
        <>
          {summary.currentlyOut} still out · {summary.avgDurationDays} days out
          on average · {money(summary.totalRevenue)} charged
          {summary.damagedCount > 0 ? (
            <>
              {" · "}
              <span className="text-accent-text">
                {summary.damagedCount} came back damaged
              </span>
            </>
          ) : null}
        </>
      }
      rows={items.map((item) => ({
        id: item.checkoutId,
        href: `/dashboard/units?q=${item.barcode}`,
        // Damage is recorded once, at check-in, and shown nowhere else.
        flagged: item.damageFlag,
        cells: {
          unit: (
            <span className="font-bold tabular-nums">{item.barcode}</span>
          ),
          asset: <span className="truncate">{item.assetName}</span>,
          client: (
            <span className="truncate text-ink-muted">
              {item.clientCompany ?? item.clientName}
            </span>
          ),
          out: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(new Date(item.checkoutDate))}
            </span>
          ),
          back: item.actualReturn ? (
            <span className="tabular-nums text-ink-muted">
              {dayYear(new Date(item.actualReturn))}
            </span>
          ) : (
            <span className="text-ink-faint">still out</span>
          ),
          days:
            item.durationDays === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              item.durationDays
            ),
          charge:
            item.totalCharge === null || item.totalCharge === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(item.totalCharge)
            ),
        },
      }))}
    />
  );
}
