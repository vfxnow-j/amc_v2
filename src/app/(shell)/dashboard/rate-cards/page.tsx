import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear } from "@/lib/format";
import { getRateCards } from "@/lib/queries/revenue";

export const metadata = { title: "Rate cards" };

const COLUMNS: Column[] = [
  { key: "name", label: "Rate card", width: "minmax(0,1.2fr)" },
  { key: "description", label: "Note", width: "minmax(0,1.6fr)" },
  { key: "rates", label: "Rates", width: "70px", align: "right" },
  { key: "categories", label: "Categories", width: "92px", align: "right" },
  { key: "updated", label: "Updated", width: "96px" },
];

async function Table() {
  const cards = await getRateCards();

  return (
    <ListTable
      columns={COLUMNS}
      total={cards.length}
      empty={
        <>
          No rate cards. A rate card sets the daily, weekly and monthly price per
          category — the order builder falls back to each asset&rsquo;s own rates
          without one.
        </>
      }
      rows={cards.map((card) => ({
        id: card.id,
        href: `/dashboard/rate-cards/${card.id}`,
        cells: {
          name: (
            <span className="font-bold">
              {card.name}
              {card.isDefault ? (
                <span className="font-normal text-ink-faint"> · default</span>
              ) : null}
            </span>
          ),
          description: (
            <span className="text-ink-muted">{card.description ?? "—"}</span>
          ),
          rates: card.rateCount || <span className="text-ink-faint">—</span>,
          categories: card.categoryCount || (
            <span className="text-ink-faint">—</span>
          ),
          updated: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(card.updatedAt)}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Revenue → Rate cards.
 *
 * New as a screen: v1 had the `RateCard`/`Rate` models and an importer under
 * settings, but no way to see what cards existed or what was on them. Bulk rate
 * updates move here from Assets, where changing prices never belonged.
 *
 * "Categories" counts the distinct categories a card prices. It can be lower
 * than the rate count, because a rate with no category is the card's catch-all
 * for everything not named.
 */
export default async function RateCardsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Rate cards"
        blurb="What each category is priced at, before per-order adjustment"
      />

      <Suspense fallback={<ListTableSkeleton />}>
        <Table />
      </Suspense>
    </>
  );
}
