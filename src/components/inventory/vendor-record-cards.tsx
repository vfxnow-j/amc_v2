import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { Figure, StatusText } from "@/components/inventory/record-cards";
import { dayYear, money } from "@/lib/format";
import {
  getVendorAssets,
  getVendorPurchaseOrders,
  getVendorSupply,
  getVendorUnits,
} from "@/lib/queries/vendor-record";

/** The cards the vendor record is built from. */

const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTIAL: "Part received",
  RECEIVED: "Received",
  CANCELLED: "Canceled",
};

/**
 * What has been bought here, and what it has earned back.
 *
 * Two totals that are deliberately not reconciled: spend sums the units'
 * purchase prices, PO value sums the orders. They differ because a PO carries
 * freight, fees and tax that never land on a unit, and because most units in
 * this database were imported without a PO at all. Showing one number would
 * mean picking a meaning and hiding it.
 */
export async function SupplyCard({ id }: { id: string }) {
  const supply = await getVendorSupply(id);

  if (supply.units === 0 && supply.poCount === 0) {
    return (
      <Card title="Bought here">
        <CardEmpty>
          {supply.assets > 0 ? (
            <>
              {supply.assets === 1
                ? "One asset names"
                : `${supply.assets} assets name`}{" "}
              this vendor as its supplier, but no individual unit does and no
              purchase order has been raised — so there is no spend to total.
              Vendors land on units when a purchase order is received.
            </>
          ) : (
            <>
              Nothing has been bought from this vendor — no asset or unit names
              them and no purchase order has been raised. Raise one and the spend
              appears here.
            </>
          )}
        </CardEmpty>
      </Card>
    );
  }

  const uncosted = supply.units - supply.unitsPriced;

  return (
    <Card title="Bought here">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Figure
          label="Spend on units"
          value={money(supply.spend)}
          note={
            uncosted === 0
              ? `${supply.units} units`
              : `${supply.unitsPriced} of ${supply.units} costed`
          }
          loud
        />
        <Figure
          label="PO value"
          value={money(supply.poTotal)}
          note={`${supply.poCount} ${supply.poCount === 1 ? "order" : "orders"}`}
        />
        <Figure
          label="Still in fleet"
          value={`${supply.inFleet} of ${supply.units}`}
          note="units that can still earn"
        />
        <Figure
          label="Earned back"
          value={money(supply.revenue)}
          note="rentals on those units"
        />
      </div>
      <p className="px-4 pb-4 text-detail text-ink-muted">
        Spend and PO value are different measurements, not a discrepancy: a
        purchase order carries freight, fees and tax that never reach a unit, and
        most units here were imported without one.
      </p>
    </Card>
  );
}

/** The asset types this vendor supplies. Rows open the asset record. */
export async function VendorAssetsCard({ id }: { id: string }) {
  const { rows, total } = await getVendorAssets(id);

  if (total === 0) {
    return (
      <Card title="Assets supplied">
        <CardEmpty>
          No asset names this vendor as its supplier. Set the vendor on an asset
          and it appears here — that is what warranty claims follow.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Assets supplied"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/assets/${row.id}`}
              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold">
                {row.name}
                {row.retired ? (
                  <span className="font-normal text-ink-faint"> · retired</span>
                ) : null}
              </span>
              <span className="truncate text-ink-muted">
                {row.categoryName}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {row.units || <Unset />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
        {/* The column is easy to misread as "units from this vendor". It isn't:
            a unit carries its own vendor and can name a different one from its
            asset, which is how an asset here can show 33 units against a vendor
            who supplied none of them. */}
        The count is the asset&rsquo;s in-fleet units however they were bought —
        a unit carries its own vendor and can differ from its asset&rsquo;s.
      </p>
    </Card>
  );
}

/** Purchase orders, newest first. */
export async function VendorPurchaseOrdersCard({ id }: { id: string }) {
  const { rows, total } = await getVendorPurchaseOrders(id);

  if (total === 0) {
    return (
      <Card title="Purchase orders">
        <CardEmpty>
          No purchase order has been raised with this vendor. Units bought before
          v1 tracked POs won&rsquo;t appear here even though they name the vendor.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Purchase orders"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/purchase-orders?q=${encodeURIComponent(row.poNumber)}`}
              className="grid grid-cols-[minmax(0,1fr)_106px_80px_86px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold tabular-nums">
                {row.poNumber}
              </span>
              <span className="truncate text-ink-muted">
                {PO_STATUS_LABEL[row.status] ?? row.status}
              </span>
              <span className="tabular-nums text-ink-muted">
                {dayYear(row.orderDate)}
              </span>
              <span className="text-right tabular-nums">
                {money(row.total)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The most recent hardware received from here. Rows open the unit record. */
export async function VendorUnitsCard({ id }: { id: string }) {
  const rows = await getVendorUnits(id);

  if (rows.length === 0) {
    return (
      <Card title="Recent units">
        <CardEmpty>
          No serialized unit names this vendor. Units get their vendor when a
          purchase order is received, or by hand on the unit.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card title="Recent units" meta={`${rows.length} newest`}>
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/units/${row.id}`}
              className="grid grid-cols-[92px_minmax(0,1fr)_78px_80px_78px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold tabular-nums">
                {row.barcode}
              </span>
              <span className="truncate">{row.assetName}</span>
              <span className="truncate">
                <StatusText status={row.status} />
              </span>
              <span className="tabular-nums text-ink-muted">
                {dayYear(row.purchaseDate)}
              </span>
              <span className="text-right tabular-nums">
                {row.purchasePrice === null || row.purchasePrice <= 0 ? (
                  <Unset />
                ) : (
                  money(row.purchasePrice)
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
