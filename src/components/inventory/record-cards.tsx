import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { money } from "@/lib/format";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import type { AssetStatus } from "@/generated/prisma/client";
import {
  UNITS_SHOWN,
  getAssetDepreciation,
  getAssetEarnings,
  getAssetFleet,
  getAssetUnits,
} from "@/lib/queries/asset-record";

/**
 * The cards the Inventory records are built from.
 *
 * Each composes `components/record/record-card` rather than inventing chrome,
 * so an asset in Inventory and an account in Clients read as the same screen.
 * Every one is an async server component taking an id, which is what lets the
 * pages give each its own Suspense boundary — the units table of a 141-unit
 * asset must never hold up the figure that says what it earned.
 */

/* ── Shared pieces ──────────────────────────────────────────────────────── */

/** A number with its name over it. `loud` for the one figure a card is about. */
export function Figure({
  label,
  value,
  note,
  loud,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  loud?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"}`}
      >
        {value}
      </span>
      {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
    </div>
  );
}

/** Status as a word, muted, with the one status worth noticing in accent. */
export function StatusText({ status }: { status: string }) {
  const label = UNIT_STATUS_LABEL[status as AssetStatus] ?? status;
  return status === "MAINTENANCE" ? (
    <span className="text-accent-text">{label}</span>
  ) : (
    <span className="text-ink-muted">{label}</span>
  );
}

/* ── Asset record ───────────────────────────────────────────────────────── */

/**
 * The fleet, broken down by what each state means for booking.
 *
 * Free is AVAILABLE only — the one bookable definition, from
 * `lib/inventory/availability` — and reads in accent when it is zero, the same
 * way the Assets list does. A strip rather than a card, because it is the first
 * thing anyone opening an asset wants and it must not wait on a Suspense
 * boundary belonging to something slower.
 */
export async function FleetStrip({ id }: { id: string }) {
  const fleet = await getAssetFleet(id);

  return (
    <section className="flex items-center gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
      <Tally label="In fleet" value={fleet.inFleet} />
      <Tally label="Free" value={fleet.free} accent={fleet.free === 0} />
      <Tally label="Out" value={fleet.out} />
      <Tally label="Reserved" value={fleet.reserved} />
      <Tally label="Service" value={fleet.service} />
      <p className="ml-auto max-w-xs text-right text-detail text-balance text-ink-muted">
        {fleet.total === 0
          ? "No units registered against this asset yet"
          : fleet.inFleet === 0
            ? `All ${fleet.total} units have left the fleet — ${fleet.retired} retired, ${fleet.sold} sold`
            : `${fleet.inFleet} of ${fleet.total} registered ${fleet.total === 1 ? "unit" : "units"} can still earn · ${fleet.retired} retired, ${fleet.sold} sold`}
      </p>
    </section>
  );
}

function Tally({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <span className="flex min-w-[76px] flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`text-[20px] font-bold tabular-nums tracking-[-0.02em] ${
          accent ? "text-accent-text" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Revenue to date, and what the hardware cost to get there.
 *
 * Revenue counts every unit ever registered, retired and sold included: money a
 * unit earned before it left is still money this asset earned. Spend is the same
 * population. Book value is not — it counts only units still in the fleet, which
 * is why it sits on the Depreciation card with its own denominator rather than
 * being subtracted from anything here.
 */
export async function PositionCard({ id }: { id: string }) {
  const position = await getAssetEarnings(id);

  if (position.unitsEver === 0) {
    return (
      <Card title="Revenue to date">
        <CardEmpty>
          No units are registered against this asset, so it has never earned
          anything. Add a unit and its rentals accumulate here.
        </CardEmpty>
      </Card>
    );
  }

  const unpriced = position.unitsEver - position.unitsPriced;

  return (
    <Card
      title="Revenue to date"
      meta={`across ${position.unitsEver === 1 ? "1 unit" : `${position.unitsEver} units`}`}
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Figure label="Rental revenue" value={money(position.revenue)} loud />
        <Figure
          label="Purchase cost"
          value={money(position.spend)}
          note={
            unpriced === 0
              ? "every unit ever bought"
              : `${position.unitsPriced} of ${position.unitsEver} costed`
          }
        />
        <Figure
          label="Sale proceeds"
          value={money(position.soldProceeds)}
          note={
            position.soldCount === 0
              ? "none sold"
              : `${position.soldCount} sold`
          }
        />
        <Figure
          label="Maintenance"
          value={money(position.maintenance)}
          note="charged against units"
        />
      </div>
      <p className="px-4 pb-4 text-detail text-ink-muted">
        {/* Stated plainly because "revenue" against "cost" invites a profit
            subtraction, and these two do not net: the cost is a one-off and the
            revenue accrues, and neither is discounted. */}
        Revenue is what the units have accumulated on their own records, not a
        margin. Nothing here is netted off against the purchase cost.
        {unpriced > 0 ? (
          <>
            {" "}
            {unpriced === position.unitsEver
              ? "No unit carries a purchase price, so the cost reads $0 because it is unknown, not because it was free."
              : `${unpriced} ${unpriced === 1 ? "unit has" : "units have"} no purchase price and ${unpriced === 1 ? "is" : "are"} not in that cost.`}
          </>
        ) : null}
      </p>
    </Card>
  );
}

/**
 * Book value across the units still owned.
 *
 * The schedule is the ported `lib/utils/depreciation`, guarded by
 * `lib/inventory/depreciation` so a method it can't run reads as "no schedule"
 * rather than as a unit that hasn't depreciated. Units with no purchase price
 * are counted separately for the same reason — a unit worth an unknown amount is
 * not a unit worth nothing, and burying it in a total would make the figure
 * quietly wrong.
 */
export async function DepreciationCard({
  id,
  method,
  usefulLifeMonths,
  salvageValue,
  categoryLabel,
}: {
  id: string;
  method: string;
  usefulLifeMonths: number;
  salvageValue: number | null;
  categoryLabel: string | null;
}) {
  const { depreciation, fleetCount } = await getAssetDepreciation(id);

  const terms = (
    <div className="grid grid-cols-2 gap-3 px-4 pb-4">
      <Figure label="Method" value={method.replace(/_/g, " ").toLowerCase()} />
      <Figure label="Useful life" value={`${usefulLifeMonths} months`} />
      <Figure
        label="Tax class"
        value={categoryLabel ?? "—"}
        note={categoryLabel ? undefined : "not classified"}
      />
      <Figure
        label="Salvage"
        value={salvageValue === null ? "—" : money(salvageValue)}
        note={salvageValue === null ? "assumed $0" : undefined}
      />
    </div>
  );

  if (!depreciation || depreciation.valued === 0) {
    return (
      <Card title="Depreciation">
        {terms}
        <p className="px-4 pb-4 text-body text-balance text-ink-muted">
          {fleetCount === 0
            ? "No units are in the fleet, so there is nothing left to depreciate."
            : `No book value can be computed: ${fleetCount === 1 ? "the unit carries no purchase price" : `none of the ${fleetCount} in-fleet units carry a purchase price`}. Cost one of them and the schedule runs from its purchase date.`}
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Depreciation"
      meta={
        depreciation.unvalued > 0
          ? `${depreciation.valued} of ${fleetCount} units valued`
          : `all ${fleetCount} in-fleet units`
      }
    >
      {terms}
      <div className="grid grid-cols-2 gap-3 border-t border-hairline px-4 pt-3 pb-4">
        <Figure label="Book value" value={money(depreciation.book)} loud />
        <Figure
          label="Cost basis"
          value={money(depreciation.cost)}
          note="in-fleet units only"
        />
        <Figure
          label="Written off"
          value={money(depreciation.accumulated)}
          note={`${Math.round((depreciation.accumulated / depreciation.cost) * 100)}% of cost`}
        />
        <Figure
          label="Fully depreciated"
          value={`${depreciation.fullyDepreciated} of ${depreciation.valued}`}
          note="past useful life"
        />
      </div>
      {depreciation.unvalued > 0 ? (
        <p className="px-4 pb-4 text-detail text-ink-muted">
          {depreciation.unvalued} in-fleet{" "}
          {depreciation.unvalued === 1 ? "unit has" : "units have"} no purchase
          price and {depreciation.unvalued === 1 ? "is" : "are"} not in these
          figures — they are not counted as worth nothing.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The physical units. Rows open the unit record — the answer to "which one, and
 * where is it" is one level down, not on this card.
 */
export async function AssetUnitsCard({
  id,
  assetName,
}: {
  id: string;
  assetName: string;
}) {
  const { rows, total, gone } = await getAssetUnits(id);

  if (total === 0) {
    return (
      <Card title="Units">
        <CardEmpty>
          No serialized units are registered against this asset. Units are what
          get booked, scanned and shipped — add one before this can go on an
          order.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Units"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
      action={
        total > rows.length ? (
          <Link
            href={`/dashboard/units?q=${encodeURIComponent(assetName)}`}
            className="text-detail text-accent-text hover:underline"
          >
            All in Units →
          </Link>
        ) : null
      }
      className="min-h-0"
    >
      <div className="grid grid-cols-[92px_minmax(0,1fr)_84px_minmax(0,1fr)_74px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Unit</span>
        <span>Serial</span>
        <span>Status</span>
        <span>Where / with</span>
        <span className="text-right">Revenue</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/units/${row.id}`}
              className="grid grid-cols-[92px_minmax(0,1fr)_84px_minmax(0,1fr)_74px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold tabular-nums">
                {row.barcode}
              </span>
              <span className="truncate tabular-nums text-ink-muted">
                {row.serialNumber ?? <Unset />}
              </span>
              <span className="truncate">
                <StatusText status={row.status} />
              </span>
              <span className="truncate text-ink-muted">
                {row.holder ?? row.locationName ?? <Unset>Unlocated</Unset>}
              </span>
              <span className="text-right tabular-nums">
                {row.revenue ? money(row.revenue) : <Unset />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-detail text-ink-muted">
        {/* The list leads with what can still earn, so say when the tail is
            hidden rather than letting a fleet of 40 look like a fleet of 141. */}
        {gone > 0
          ? `In-fleet units first · ${gone} retired or sold`
          : "Nothing retired or sold"}
        {total > UNITS_SHOWN ? " · search by barcode in Units" : ""}
      </p>
    </Card>
  );
}
