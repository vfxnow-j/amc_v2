import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { ApplyRatesPanel } from "@/components/revenue/apply-rates-panel";
import { moneyExact } from "@/lib/format";
import {
  getRateCardCoverage,
  getRateCardGap,
} from "@/lib/queries/rate-card-record";
import { RATE_TIER_LABEL } from "@/lib/revenue/labels";

/**
 * The Rate card record's cards.
 *
 * This screen has one awkward truth to carry: nothing in the app prices off a
 * rate card. Order lines are priced from each asset's own rates, and v1's rate
 * card importer writes those asset columns too — it never touches `Rate`. So a
 * rate card states an intention, and the catalog is what is actually charged.
 * These cards are built around the gap between the two, because a card that
 * only showed its own three figures would look correct and mean nothing.
 */

/** Where the catalog disagrees with the card — and the way to close it. */
export async function RateGapCard({ id }: { id: string }) {
  const { rows, matched, uncomparable, assetsCovered } =
    await getRateCardGap(id);
  const assets = new Set(rows.map((row) => row.assetId)).size;

  if (assetsCovered === 0) {
    return (
      <Card title="Against the catalog">
        <CardEmpty>
          This card prices no category that has any asset in it, so there is
          nothing to compare it against. Add a rate for a category that holds
          stock.
        </CardEmpty>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Against the catalog" meta={`${matched} rates agree`}>
        <CardEmpty>
          Every asset in the categories this card prices already carries the
          card&rsquo;s figure. Nothing to change.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Against the catalog"
      meta={`${rows.length} differ · ${matched} agree`}
    >
      <div className="grid grid-cols-[1fr_84px_100px_100px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Asset</span>
        <span>Tier</span>
        <span className="text-right">Charged now</span>
        <span className="text-right">On the card</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {rows.map((row, index) => (
          <li
            key={`${row.assetId}:${row.pricingType}`}
            className={`rounded-row ${index % 2 === 1 ? "bg-row-alt" : ""}`}
          >
            <Link
              href={`/dashboard/assets/${row.assetId}`}
              className="grid grid-cols-[1fr_84px_100px_100px] items-baseline gap-2 rounded-row p-2 text-detail hover:bg-row-hover"
            >
              <span className="truncate">{row.assetName}</span>
              <span className="truncate text-ink-muted">
                {RATE_TIER_LABEL[row.pricingType]}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {row.current === null ? (
                  <Unset>Unpriced</Unset>
                ) : (
                  moneyExact(row.current)
                )}
              </span>
              <span className="text-right tabular-nums">
                {moneyExact(row.card)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="px-4 pt-3 text-detail text-ink-muted">
        &ldquo;Unpriced&rdquo; is not the same as free: an asset with no rate at
        that tier falls through to whichever tier it does carry, so it is being
        charged at something — just not at this.
        {uncomparable > 0 ? (
          <>
            {" "}
            {uncomparable} further {uncomparable === 1 ? "rate" : "rates"} on this
            card {uncomparable === 1 ? "is" : "are"} hourly, project or custom,
            which no asset has a column for — they can be neither compared nor
            applied.
          </>
        ) : null}
      </p>

      <ApplyRatesPanel rateCardId={id} changes={rows.length} assets={assets} />
    </Card>
  );
}

/**
 * What the card doesn't say anything about.
 *
 * A card that prices one category out of thirty looks perfectly fine from its
 * own rates. It is the silence that matters, so the categories it leaves out
 * are listed with their asset counts — an unpriced category holding 60 assets
 * and one holding none are different problems.
 */
export async function CoverageCard({ id }: { id: string }) {
  const categories = await getRateCardCoverage(id);
  const priced = categories.filter((category) => category.priced);
  const missing = categories.filter(
    (category) => !category.priced && category.assets > 0,
  );
  const empty = categories.length - priced.length - missing.length;

  return (
    <Card
      title="Coverage"
      meta={`${priced.length} of ${categories.length} categories priced`}
    >
      {missing.length === 0 ? (
        <CardEmpty>
          Every category that holds stock is priced by this card.
        </CardEmpty>
      ) : (
        <>
          <ul className="flex max-h-[280px] flex-col gap-px overflow-y-auto px-2 pb-2">
            {missing.map((category) => (
              <li
                key={category.id}
                className="grid grid-cols-[1fr_56px] items-baseline gap-2 rounded-row px-2 py-[5px] text-detail"
              >
                <span className="truncate text-ink-muted">{category.name}</span>
                <span className="text-right tabular-nums text-ink-faint">
                  {category.assets}
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-4 text-detail text-ink-muted">
            {missing.length}{" "}
            {missing.length === 1 ? "category holds" : "categories hold"} stock
            this card says nothing about
            {empty > 0
              ? `, and ${empty} more are unpriced but empty.`
              : "."}{" "}
            Those assets keep whatever rates they were catalogd with.
          </p>
        </>
      )}
    </Card>
  );
}
