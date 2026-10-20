import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { dayYear, money } from "@/lib/format";
import {
  getSaleLifecycleReport,
  type SaleChannelFilter,
} from "@/lib/queries/sale-lifecycle";
import { SALE_CHANNEL_LABEL } from "@/lib/sales/sale-channel";

export const metadata = { title: "Sale lifecycle" };

const PAGE_SIZE = 40;

const CHANNELS: { value: SaleChannelFilter; label: string }[] = [
  { value: "EBAY", label: "eBay" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "OTHER", label: "Other" },
  { value: "UNSET", label: "Not set" },
  { value: "ALL", label: "All" },
];

const WINDOWS = {
  "12m": { label: "12 months", months: 12 },
  "36m": { label: "3 years", months: 36 },
  all: { label: "All", months: 0 },
} as const;
type WindowKey = keyof typeof WINDOWS;

// hasOwn, not `in`: see the Traffic report for why a prototype key must not pass.
const isWindow = (v: unknown): v is WindowKey =>
  typeof v === "string" && Object.hasOwn(WINDOWS, v);
const isChannel = (v: unknown): v is SaleChannelFilter =>
  CHANNELS.some((c) => c.value === v);

/** Unit · Sold · Cost · Rental · Book · Price · Fees · Net · Return */
const COLUMNS: Column[] = [
  { key: "unit", label: "Unit", width: "minmax(0,1.5fr)" },
  { key: "sold", label: "Sold", width: "minmax(0,1fr)" },
  { key: "cost", label: "Cost", width: "84px", align: "right" },
  { key: "rental", label: "Rental", width: "84px", align: "right" },
  { key: "book", label: "Book at sale", width: "92px", align: "right" },
  { key: "price", label: "Price", width: "84px", align: "right" },
  { key: "fees", label: "Fees", width: "72px", align: "right" },
  { key: "net", label: "Net", width: "84px", align: "right" },
  { key: "return", label: "Return", width: "92px", align: "right" },
];

const dash = <span className="text-ink-faint">—</span>;
const orDash = (n: number | null) => (n === null ? dash : money(n));
const signed = (n: number | null) =>
  n === null ? dash : `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

/**
 * Reports → Sale lifecycle.
 *
 * Each sold unit from the day it joined the fleet to the day it left: what it
 * cost, what it earned on rental, what it was worth on the books at the sale,
 * and what the sale netted after fees. Total return is rental revenue plus net
 * sale less cost — did the unit pay for itself.
 *
 * eBay by default, because that is where fees come out of the price and net
 * differs from what was advertised. Units sold before the channel was recorded
 * sit under "Not set" until someone tags them; nothing is guessed here.
 */
export default async function SaleLifecyclePage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; window?: string; page?: string }>;
}) {
  const params = await searchParams;
  const channel: SaleChannelFilter = isChannel(params.channel)
    ? params.channel
    : "EBAY";
  const window: WindowKey = isWindow(params.window) ? params.window : "all";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Sale lifecycle"
        blurb="Each sold unit from acquisition to sale: cost, rental earned, book value, and what the sale netted after fees."
        actions={<BackToReports />}
      />

      <Suspense fallback={<ListTableSkeleton />}>
        <Body channel={channel} window={window} page={page} />
      </Suspense>
    </>
  );
}

async function Body({
  channel,
  window,
  page,
}: {
  channel: SaleChannelFilter;
  window: WindowKey;
  page: number;
}) {
  const months = WINDOWS[window].months;
  let startDate: Date | undefined;
  if (months > 0) {
    startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
  }

  const { rows, summary, channelCounts } = await getSaleLifecycleReport({
    channel,
    startDate,
  });

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hrefFor = (next: number) => {
    const query = new URLSearchParams();
    if (channel !== "EBAY") query.set("channel", channel);
    if (window !== "all") query.set("window", window);
    if (next > 1) query.set("page", String(next));
    const text = query.toString();
    return text
      ? `/dashboard/reports/sale-lifecycle?${text}`
      : "/dashboard/reports/sale-lifecycle";
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={360} />}>
          <FilterTabs
            param="channel"
            value={channel}
            fallback="EBAY"
            label="Sold via"
            options={CHANNELS.map((c) => ({
              value: c.value,
              label: c.label,
              count: channelCounts[c.value],
            }))}
          />
        </Suspense>
        <Suspense fallback={<FilterTabsSkeleton width={220} />}>
          <FilterTabs
            param="window"
            value={window}
            fallback="all"
            label="Sold within"
            options={Object.entries(WINDOWS).map(([value, w]) => ({
              value,
              label: w.label,
            }))}
          />
        </Suspense>
      </div>

      <ListTable
        columns={COLUMNS}
        total={rows.length}
        page={page}
        pageSize={PAGE_SIZE}
        pagination={{ page, pages, hrefFor }}
        empty={<>No sales in this view.</>}
        footerNote={
          <>
            {money(summary.netSales)} net ({money(summary.grossSales)} sold less{" "}
            {money(summary.fees)} fees) on {summary.pricedUnits} priced of{" "}
            {summary.units} · {money(summary.rentalRevenue)} rental earned
            across {summary.unitsWithRentals} units · total return{" "}
            {signed(summary.totalReturn)} on {money(summary.completeCost)} cost
            ({summary.completeUnits} units with both a cost and a price)
            {summary.feesMissing > 0
              ? ` · ${summary.feesMissing} priced with no fees recorded, so their net is the price`
              : ""}
          </>
        }
        rows={pageRows.map((r) => ({
          id: r.unitId,
          href: `/dashboard/units/${r.unitId}`,
          // A gap in the record that changes a figure on the row.
          flagged: r.flags.length > 0 && r.soldPrice === null,
          cells: {
            unit: (
              <span title={r.flags.join("\n") || undefined}>
                <span className="font-bold tabular-nums">{r.barcode}</span>
                <span className="text-ink-muted"> · {r.assetName}</span>
                {r.flags.length > 0 ? (
                  <span className="text-accent-text">
                    {" "}
                    · {r.flags.length} gap{r.flags.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            ),
            sold: (
              <span className="text-ink-muted">
                <span className="tabular-nums">{dayYear(r.soldAt)}</span>
                {" · "}
                {r.soldTo ??
                  (r.saleChannel ? SALE_CHANNEL_LABEL[r.saleChannel] : "—")}
              </span>
            ),
            cost: orDash(r.cost),
            rental: (
              <span title={`${r.rentals} out, ${r.daysOnRent} days`}>
                {money(r.rentalRevenue)}
              </span>
            ),
            book: orDash(r.bookValueAtSale),
            price: orDash(r.soldPrice),
            fees:
              r.saleFees !== null ? (
                money(r.saleFees)
              ) : r.soldPrice !== null ? (
                <span className="text-accent-text">?</span>
              ) : (
                dash
              ),
            net: <span className="font-bold">{orDash(r.net)}</span>,
            return:
              r.totalReturn === null ? (
                dash
              ) : (
                <span
                  title={r.returnPct === null ? undefined : `${r.returnPct}% of cost`}
                >
                  {signed(r.totalReturn)}
                </span>
              ),
          },
        }))}
      />
    </>
  );
}
