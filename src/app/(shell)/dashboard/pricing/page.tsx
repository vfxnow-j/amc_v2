import { Suspense } from "react";
import Link from "next/link";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { PricingFeedback } from "@/components/pricing/pricing-feedback";
import { RateCell } from "@/components/pricing/rate-cell";
import {
  getPricingHeaderStats,
  getPricingList,
  RATE_TIERS,
  RATE_TIER_LABEL,
} from "@/lib/queries/pricing";

export const metadata = { title: "Pricing" };

/** Model · Category · Fleet · Daily · Weekly · Monthly · Sale */
const COLUMNS: Column[] = [
  { key: "name", label: "Model", width: "minmax(0,1.6fr)" },
  { key: "category", label: "Category", width: "148px" },
  { key: "fleet", label: "Fleet", width: "56px", align: "right" },
  { key: "dailyRate", label: "Daily", width: "84px", align: "right" },
  { key: "weeklyRate", label: "Weekly", width: "84px", align: "right" },
  { key: "monthlyRate", label: "Monthly", width: "92px", align: "right" },
  { key: "salePrice", label: "Sale", width: "92px", align: "right" },
];

async function HeaderBlurb() {
  const { active, unpriced } = await getPricingHeaderStats();
  return (
    <>
      {active} active {active === 1 ? "model" : "models"}
      {unpriced > 0 ? (
        <>
          {" · "}
          <span className="text-accent-text">
            {unpriced} with no rental rate at all
          </span>
        </>
      ) : null}
    </>
  );
}

async function Table({ search, page }: { search: string; page: number }) {
  const { rows, total, pageSize } = await getPricingList({ search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/pricing?${query}` : "/dashboard/pricing";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        search ? (
          <>
            No active model matches &ldquo;{search}&rdquo; — by name,
            manufacturer, or category.
          </>
        ) : (
          <>There are no models to price yet.</>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        // No row href: every cell to the right of Category is an input, and a
        // row that navigates on click cannot hold one.
        cells: {
          name: (
            <span className="truncate">
              <Link
                href={`/dashboard/assets/${row.id}`}
                className="font-bold hover:text-accent-text"
              >
                {row.name}
              </Link>
              {row.maker ? (
                <span className="text-ink-faint"> · {row.maker}</span>
              ) : null}
            </span>
          ),
          category: (
            <span className="truncate text-ink-muted">{row.categoryName}</span>
          ),
          fleet: (
            <span className="text-ink-muted">
              {row.fleet || <span className="text-ink-faint">—</span>}
            </span>
          ),
          ...Object.fromEntries(
            RATE_TIERS.map((tier) => [
              tier,
              <RateCell
                key={tier}
                assetId={row.id}
                tier={tier}
                value={row.rates[tier]}
                label={`${RATE_TIER_LABEL[tier]} rate, ${row.name}`}
              />,
            ]),
          ),
        },
      }))}
    />
  );
}

/**
 * Operate → Pricing.
 *
 * New in v2, and the first screen anywhere in the app that can change what the
 * catalogue charges. Until now a rate could only be edited on the order it was
 * quoted on: `setLineRate` writes `ReservationItem.rate`, which fixes one line
 * of one order and leaves the model still priced the way it was for the next
 * quote. The four rate columns on `Asset` were readable on the asset record and
 * writable nowhere.
 *
 * It sits in Operate rather than Accounting because pricing is something the
 * business decides, not something the books record — the same call that put
 * Cloud and Services here. Rate cards move in alongside it.
 *
 * **Changing a price here does not reprice anything already quoted.** A
 * `ReservationItem` carries the rate it was added at and `deriveItemAmount`
 * reads that, so an agreed price stays agreed and this only moves what gets
 * quoted next. That is why nothing here asks "are you sure": there is no open
 * order it can reach.
 *
 * Empty is not zero. A blank tier means the order builder's `pickRate` falls
 * through to the next one down; a zero means the model genuinely quotes at
 * nothing. Clearing a field writes null and the placeholder shows a dash.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Pricing"
        blurb={
          <Suspense fallback="Reading the catalogue…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search models, makers, categories" />}
      />

      <PricingFeedback>
        <Suspense key={`${search}:${page}`} fallback={<ListTableSkeleton />}>
          <Table search={search} page={page} />
        </Suspense>
      </PricingFeedback>
    </>
  );
}
