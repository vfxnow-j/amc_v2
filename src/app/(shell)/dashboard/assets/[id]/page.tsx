import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  AssetUnitsCard,
  DepreciationCard,
  FleetStrip,
  PositionCard,
} from "@/components/inventory/record-cards";
import { dayYear, money } from "@/lib/format";
import { getAssetHeader } from "@/lib/queries/asset-record";
import { depreciationCategoryLabels } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getAssetHeader(id);
  return { title: header?.name ?? "Asset" };
}

/**
 * Inventory → Assets → the record.
 *
 * An asset is a product type, not a thing you can pick up — so the screen leads
 * with the fleet strip, which answers "how many of these are there and can I
 * promise one", and hands off to the unit record for anything physical. The
 * units table is the click path to a barcode; everything else on this screen is
 * about the type.
 *
 * A card per Suspense boundary. The units table of a 141-unit asset is the
 * slowest query here and must never hold up what the asset has earned.
 */
export default async function AssetRecordPage({ params }: Params) {
  const { id } = await params;
  const asset = await getAssetHeader(id);
  if (!asset) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Asset"
        title={asset.name}
        blurb={
          <>
            {asset.category.name}
            {asset.maker ? ` · ${asset.maker}` : ""} ·{" "}
            {asset.units === 1 ? "1 unit" : `${asset.units} units`} registered ·
            on the books since {dayYear(asset.createdAt)}
          </>
        }
        actions={
          <>
            {asset.retiredAt ? (
              <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
                Retired {dayYear(asset.retiredAt)}
              </span>
            ) : null}
            <Link
              href={`/dashboard/units?q=${encodeURIComponent(asset.name)}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Its units
            </Link>
          </>
        }
      />

      <Suspense
        fallback={
          <div className="h-[68px] animate-pulse rounded-card bg-panel shadow-sm" />
        }
      >
        <FleetStrip id={id} />
      </Suspense>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1.3fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense
            fallback={<CardSkeleton title="Revenue to date" rows={3} />}
          >
            <PositionCard id={id} />
          </Suspense>
          <Rates asset={asset} />
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Units" rows={12} />}>
            <AssetUnitsCard id={id} assetName={asset.name} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Details asset={asset} />
          <MarketPrice asset={asset} />
          <Suspense fallback={<CardSkeleton title="Depreciation" rows={4} />}>
            <DepreciationCard
              id={id}
              method={asset.depreciationMethod}
              usefulLifeMonths={asset.usefulLifeMonths}
              salvageValue={asset.salvageValue}
              categoryLabel={
                asset.depreciationCategory
                  ? depreciationCategoryLabels[asset.depreciationCategory]
                  : null
              }
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}

type Asset = NonNullable<Awaited<ReturnType<typeof getAssetHeader>>>;

/**
 * What this asset rents for.
 *
 * Only the rates that are actually stored. v1 derives a weekly rate as five
 * days and a monthly as twenty (`lib/utils/depreciation.ts:calculateRate`) when
 * a line is priced, but the asset carries all three columns independently — so
 * printing a derived figure in an "Asset rates" table would put a number on
 * screen that nobody set and that a rate card can override anyway. Unset says
 * unset, and the card names the gap when the asset can't be priced at all.
 */
function Rates({ asset }: { asset: Asset }) {
  const rates = [
    { label: "Daily", value: asset.dailyRate },
    { label: "Weekly", value: asset.weeklyRate },
    { label: "Monthly", value: asset.monthlyRate },
    { label: "Sale price", value: asset.salePrice },
  ];
  const set = rates.filter((rate) => rate.value !== null && rate.value > 0);

  return (
    <Card
      title="Rates"
      meta={set.length === 0 ? undefined : `${set.length} of 4 set`}
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        {rates.map((rate) => (
          <Field key={rate.label} label={rate.label}>
            {rate.value === null || rate.value === 0 ? (
              <Unset>Not set</Unset>
            ) : (
              <span className="tabular-nums">{money(rate.value)}</span>
            )}
          </Field>
        ))}
      </div>
      {set.length === 0 ? (
        <p className="px-4 pb-4 text-detail text-ink-muted">
          {/* Unpriced assets are a standing report in v1; naming it here is the
              difference between a blank card and a job. */}
          This asset has no rate at all, so it can&rsquo;t be priced onto an
          order without someone typing a figure by hand.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The market figures, stated as observations with a date on them.
 *
 * `marketPrice` is captured by the price-tracking job (`actions/market-prices`)
 * and can be months old, so the card shows the source and how stale it is rather
 * than presenting it as today's value. Nothing is compared against purchase
 * price here — that comparison is an Insight, and duplicating it would give two
 * places to disagree.
 */
function MarketPrice({ asset }: { asset: Asset }) {
  if (asset.marketPrice === null && asset.marketRentalRate === null) {
    return (
      <Card title="Market price">
        <p className="px-4 pb-4 text-body text-balance text-ink-muted">
          No market price has been captured for this asset. The price tracker
          fills this in, or someone can set it by hand — until then there is
          nothing to check the rates against.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Market price">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Resale">
          {asset.marketPrice === null ? (
            <Unset>Not tracked</Unset>
          ) : (
            <span className="tabular-nums">{money(asset.marketPrice)}</span>
          )}
        </Field>
        <Field label="Rental (market)">
          {asset.marketRentalRate === null ? (
            <Unset>Not tracked</Unset>
          ) : (
            <span className="tabular-nums">
              {money(asset.marketRentalRate)}
            </span>
          )}
        </Field>
        <Field label="Source">
          {asset.marketPriceSource ?? <Unset>Unrecorded</Unset>}
        </Field>
        <Field label="Captured">
          {asset.marketPriceUpdatedAt ? (
            dayYear(asset.marketPriceUpdatedAt)
          ) : (
            <Unset>Never</Unset>
          )}
        </Field>
      </div>
      {asset.marketPriceNotes ? (
        <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
          {asset.marketPriceNotes}
        </p>
      ) : null}
    </Card>
  );
}

/** Identity, supplier and the retirement note, if there is one. */
function Details({ asset }: { asset: Asset }) {
  return (
    <Card title="Detail">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Category">{asset.category.name}</Field>
        <Field label="Sub-category">
          {asset.subCategory ?? <Unset>None</Unset>}
        </Field>
        <Field label="Manufacturer">
          {asset.manufacturer ?? <Unset>Unrecorded</Unset>}
        </Field>
        <Field label="Model">{asset.model ?? <Unset>Unrecorded</Unset>}</Field>
        <Field label="Asset number">
          {asset.assetNumber ?? <Unset>None</Unset>}
        </Field>
        <Field label="Vendor">
          {asset.vendor ? (
            <Link
              href={`/dashboard/vendors/${asset.vendor.id}`}
              className="text-accent-text hover:underline"
            >
              {asset.vendor.name}
            </Link>
          ) : (
            <Unset>Unrecorded</Unset>
          )}
        </Field>
      </div>
      {asset.retiredAt ? (
        <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          Retired {dayYear(asset.retiredAt)}
          {asset.retirementReason ? ` · ${asset.retirementReason}` : ""}
          {asset.retirementNotes ? ` — ${asset.retirementNotes}` : ""}. Its units
          keep their records either way.
        </p>
      ) : null}
      {asset.description || asset.notes ? (
        <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
          {asset.description ?? asset.notes}
        </p>
      ) : null}
    </Card>
  );
}
