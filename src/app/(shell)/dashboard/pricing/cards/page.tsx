import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { PricingTabs } from "@/components/pricing/pricing-tabs";
import { dayYear } from "@/lib/format";
import { getRateCards } from "@/lib/queries/accounting";

export const metadata = { title: "Rate cards" };

/** Rate card · Note · Rates · Categories · Updated */
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
          No rate cards. A card states what a whole category ought to cost, and
          its record compares that against what the models in that category
          actually charge — nothing quotes off a card on its own.
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
 * Operate → Pricing → Rate cards. Moved from Accounting, 2026-09-09.
 *
 * A card was never an accounting artefact. It states what a category ought to
 * cost; the books record what was actually charged. Under Revenue, the one
 * screen that sets prices sat among the screens that read them back.
 *
 * It stays a separate surface from the catalogue rather than merging into it,
 * because the two answer different questions. A card is per category and
 * aspirational; the catalogue is per model and is what actually quotes. The
 * card's own record is where they meet — it lists every model whose rate
 * disagrees with the card, and `applyRateCard` writes the card's figures onto
 * those models. After that, the models are what quote. Nothing consults a card
 * at quote time, which is worth stating on the empty view: "rate card" reads
 * like something the order builder looks at, and it never has.
 *
 * The record keeps its own URL under /dashboard/rate-cards/[id] — only the list
 * moved, so every link into a specific card still lands.
 */
export default async function RateCardsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operate · Pricing"
        title="Rate cards"
        blurb="What each category ought to cost, and which models disagree"
      />

      <PricingTabs current="cards" />

      <Suspense fallback={<ListTableSkeleton />}>
        <Table />
      </Suspense>
    </>
  );
}
