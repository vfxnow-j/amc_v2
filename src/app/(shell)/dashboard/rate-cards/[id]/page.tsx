import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { CoverageCard, RateGapCard } from "@/components/accounting/rate-card-cards";
import { dayYear, moneyExact } from "@/lib/format";
import { getRateCard } from "@/lib/queries/rate-card-record";
import {
  PRICED_RATE_TIERS,
  RATE_TIER_LABEL,
  isPricedRateType,
} from "@/lib/accounting/labels";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const card = await getRateCard(id);
  return { title: card?.name ?? "Rate card" };
}

/**
 * Revenue → Rate cards → the record.
 *
 * Built around a fact the screen has to be honest about rather than decorate:
 * **nothing in this app prices off a rate card.** Every order line takes its
 * rate from the asset's own `dailyRate`/`weeklyRate`/`monthlyRate` through
 * `lib/pricing/rates`, and v1's rate-card importer under settings writes those
 * same asset columns — it has never touched a `Rate` row. A rate card is a
 * stated intention; the catalog is what is charged.
 *
 * So the record leads with the card's figures and then, at width, with the gap
 * between them and what the assets actually carry. A screen that showed three
 * rates and stopped would look correct and mean nothing.
 *
 * This is also where the bulk rate update lands, moved off Assets where
 * changing prices never belonged. It writes the card's figures onto the assets
 * it has just listed, one by one, and it is armed in two steps: `Asset` keeps
 * no rate history, so there is nothing to undo from. It cannot reach an order
 * that already exists — `ReservationItem.rate` is stored per line — which is
 * the difference between repricing the catalog and repricing a contract.
 */
export default async function RateCardRecordPage({ params }: Params) {
  const { id } = await params;
  const card = await getRateCard(id);
  if (!card) notFound();

  // One row per category, its tiers across the columns — the shape somebody
  // reading a rate card expects, rather than one row per rate.
  const byCategory = new Map<
    string,
    { name: string; tiers: Map<string, number> }
  >();
  for (const rate of card.rates) {
    const key = rate.categoryId ?? "*";
    const entry = byCategory.get(key) ?? {
      name: rate.categoryName,
      tiers: new Map<string, number>(),
    };
    entry.tiers.set(rate.pricingType, rate.rate);
    byCategory.set(key, entry);
  }

  return (
    <>
      <PageHeader
        eyebrow="Accounting · Rate card"
        title={card.name}
        blurb={
          <>
            {card.description ? `${card.description} · ` : ""}
            {card.rates.length}{" "}
            {card.rates.length === 1 ? "rate" : "rates"} across{" "}
            {card.categoryCount}{" "}
            {card.categoryCount === 1 ? "category" : "categories"} · last
            changed {dayYear(card.updatedAt)}
          </>
        }
        actions={
          card.isDefault ? (
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              Default
            </span>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Suspense
          fallback={<CardSkeleton title="Against the catalog" rows={10} />}
        >
          <RateGapCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Rates" meta={`${byCategory.size} priced`}>
            {byCategory.size === 0 ? (
              <CardEmpty>
                This card sets no rates. Add one per category and tier, and the
                catalog can be measured against it below.
              </CardEmpty>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_78px_78px_78px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
                  <span>Category</span>
                  {PRICED_RATE_TIERS.map((tier) => (
                    <span key={tier} className="text-right">
                      {RATE_TIER_LABEL[tier]}
                    </span>
                  ))}
                </div>
                <ul className="flex flex-col gap-px px-2 pb-3">
                  {[...byCategory].map(([key, entry]) => (
                    <li
                      key={key}
                      className="grid grid-cols-[1fr_78px_78px_78px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
                    >
                      <span className="truncate">{entry.name}</span>
                      {PRICED_RATE_TIERS.map((tier) => {
                        const rate = entry.tiers.get(tier);
                        return (
                          <span
                            key={tier}
                            className="text-right tabular-nums text-ink-muted"
                          >
                            {rate === undefined ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              moneyExact(rate)
                            )}
                          </span>
                        );
                      })}
                    </li>
                  ))}
                </ul>
                {/* A tier the card leaves blank is not "free": the order builder
                    falls through to whichever tier the asset does carry. */}
                <p className="px-4 pb-4 text-detail text-ink-muted">
                  A blank tier is one this card doesn&rsquo;t set. Pricing falls
                  through to whichever tier the asset itself carries, treating a
                  month as four weeks or thirty days.
                </p>
              </>
            )}
          </Card>

          {card.rates.some((rate) => !isPricedRateType(rate.pricingType)) ? (
            <Card title="Rates with nowhere to go">
              <CardEmpty>
                This card carries hourly, project or custom rates. An order line
                can be priced that way, but an asset has no column for it, so
                those rates can be neither compared against the catalog nor
                applied to it.
              </CardEmpty>
            </Card>
          ) : null}

          <Suspense fallback={<CardSkeleton title="Coverage" rows={8} />}>
            <CoverageCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
