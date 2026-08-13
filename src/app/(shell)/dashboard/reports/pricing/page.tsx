import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { money } from "@/lib/format";
import { oneOf } from "@/lib/guards";
import { getPricing, type PricingVerdict } from "@/lib/queries/reports";

export const metadata = { title: "Pricing" };

const VIEWS = ["underpriced", "fair", "overpriced", "unrated", "all"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  underpriced: "Underpriced",
  fair: "Fair",
  overpriced: "Overpriced",
  unrated: "Can't tell",
  all: "All",
};

const isView = oneOf(VIEWS);

/** Asset · Category · Units · Avg cost · Market · Rate · Payback · Earned back */
const COLUMNS: Column[] = [
  { key: "asset", label: "Asset", width: "minmax(0,1.6fr)" },
  { key: "category", label: "Category", width: "minmax(0,0.7fr)" },
  { key: "units", label: "Units", width: "56px", align: "right" },
  { key: "cost", label: "Avg cost", width: "92px", align: "right" },
  { key: "market", label: "Market", width: "92px", align: "right" },
  { key: "rate", label: "Rate/mo", width: "84px", align: "right" },
  { key: "payback", label: "Payback", width: "84px", align: "right" },
  { key: "roi", label: "Earned back", width: "96px", align: "right" },
];

/**
 * Reports → Pricing.
 *
 * v1 called this "NowBot Market Insights". NowBot is dropped in v2 and the
 * report never needed it: every figure on this screen comes from the purchase
 * prices, the rates and the revenue already in the database.
 *
 * Payback is read against what the units actually cost, not against the market
 * reference — the question is when this hardware pays for itself, and the money
 * that left the account is the only figure that can answer it. Market price is
 * shown beside it because it is what a *replacement* would cost, which is a
 * different question and the one the suggested rate is built on.
 *
 * The verdict thresholds are v1's, unchanged: over ten months to pay back is
 * underpriced, under three is overpriced. "Can't tell" is v1's `unknown`
 * renamed — there is nothing unknown about it, the asset has no monthly rate or
 * no unit carrying a purchase price, and the row says which.
 *
 * The market price behind the suggestion is not re-derived here. Where it is
 * older than the staleness rule the rest of the app uses, the row says so
 * rather than quietly presenting an old number as current.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const view: View = isView(params.view) ? params.view : "underpriced";

  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Pricing"
        blurb={
          <Suspense fallback="Working out payback…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<BackToReports />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={420} />}>
          <Tabs view={view} />
        </Suspense>
      </div>

      <Suspense key={view} fallback={<ListTableSkeleton />}>
        <Table view={view} />
      </Suspense>
    </>
  );
}

async function HeaderBlurb() {
  const { rows, targetMonths } = await getPricing();
  const rated = rows.filter((row) => row.paybackMonths !== null);
  const unconfirmed = rows.filter((row) => row.marketUnconfirmed).length;

  return (
    <>
      {rated.length} of {rows.length} assets can be judged · target payback{" "}
      {targetMonths} months
      {unconfirmed > 0
        ? ` · ${unconfirmed} market prices nobody has confirmed`
        : ""}
    </>
  );
}

async function Tabs({ view }: { view: View }) {
  const { rows } = await getPricing();
  const count = (verdict: PricingVerdict) =>
    rows.filter((row) => row.verdict === verdict).length;

  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="underpriced"
      label="Pricing verdict"
      options={VIEWS.map((value) => ({
        value,
        label: VIEW_LABEL[value],
        count: value === "all" ? rows.length : count(value),
      }))}
    />
  );
}

async function Table({ view }: { view: View }) {
  const { rows, targetMonths } = await getPricing();
  const shown =
    view === "all" ? rows : rows.filter((row) => row.verdict === view);

  // Worst first inside a verdict: the longest payback is the one to fix.
  const sorted = [...shown].sort(
    (a, b) => (b.paybackMonths ?? -1) - (a.paybackMonths ?? -1),
  );

  // Revenue is attributed to a unit at check-out, and 151 units went out with
  // no rate on them — see the unpriced report. So "0.00×" here is mostly an
  // attribution gap, not an asset that failed to earn, and printing it as a
  // computed figure would read as the second.
  const unearned = sorted.filter((row) => row.revenue === 0).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={sorted.length}
      empty={
        view === "unrated" ? (
          <>
            Every asset with units has a monthly rate and a purchase price on
            it. Nothing is unjudgeable.
          </>
        ) : (
          <>
            No asset lands in {VIEW_LABEL[view].toLowerCase()} at a{" "}
            {targetMonths}-month target. Try another verdict.
          </>
        )
      }
      footerNote={
        <>
          Payback is average unit cost ÷ monthly rate. Market prices nobody has
          confirmed are marked, and are left out of the rate recommendations
          {unearned > 0 ? (
            <>
              {" · "}
              {unearned} have earned nothing back yet
            </>
          ) : null}
        </>
      }
      rows={sorted.map((row) => ({
        id: row.id,
        href: `/dashboard/assets/${row.id}`,
        // Over three years to pay for itself, at the rate it is let at.
        flagged: row.paybackMonths !== null && row.paybackMonths > 36,
        cells: {
          asset: <span className="truncate font-bold">{row.name}</span>,
          category: <span className="truncate text-ink-muted">{row.category}</span>,
          units: <span className="text-ink-muted">{row.units}</span>,
          cost:
            row.avgCost === null ? (
              <span className="text-ink-faint">no cost</span>
            ) : (
              money(row.avgCost)
            ),
          market:
            row.marketPrice === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <span
                className={row.marketUnconfirmed ? "text-ink-faint" : undefined}
                title={
                  row.marketUnconfirmed
                    ? "Collected by v1's price scraper; nobody has checked it"
                    : undefined
                }
              >
                {money(row.marketPrice)}
                {row.marketUnconfirmed ? "·unchecked" : ""}
              </span>
            ),
          rate:
            row.monthlyRate === null ? (
              <span className="text-ink-faint">no rate</span>
            ) : (
              money(row.monthlyRate)
            ),
          payback:
            row.paybackMonths === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <span
                className={
                  row.paybackMonths > targetMonths ? "text-accent-text" : undefined
                }
              >
                {row.paybackMonths}mo
              </span>
            ),
          roi:
            row.roi === null || row.revenue === 0 ? (
              <span className="text-ink-faint">nothing</span>
            ) : (
              `${row.roi.toFixed(2)}×`
            ),
        },
      }))}
    />
  );
}
