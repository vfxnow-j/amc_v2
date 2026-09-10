import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { StatusText } from "@/components/inventory/record-cards";
import { dayYear, money } from "@/lib/format";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import {
  getLocationAssets,
  getLocationPurchaseOrders,
  getLocationTransfers,
  getLocationUnits,
} from "@/lib/queries/location-record";

/**
 * The cards the location record is built from.
 *
 * A location is answered in the order somebody standing in the doorway asks:
 * what is on the shelf, what kinds of thing are they, what has moved in and out,
 * and what is still on its way. Every row leads somewhere — the unit, the asset,
 * the client holding it, the purchase order bringing more — because the whole
 * point of promoting locations out of settings was that a shelf is a place you
 * navigate from.
 */

/* ── What is here ───────────────────────────────────────────────────────── */

/**
 * The units on this shelf, in-fleet only.
 *
 * Fourteen rows of a 684-unit warehouse is a sample, not an inventory, so the
 * card says so and hands off to the Units list carrying this location's id — not
 * its name. A filter by name would quietly mean "any location whose name
 * contains this text", which is a different set the day a second shelf is called
 * "LA Office (annex)".
 */
export async function LocationUnitsCard({
  id,
  gone,
}: {
  id: string;
  /** Retired and sold units still filed here; they are deliberately not listed. */
  gone: number;
}) {
  const { rows, total } = await getLocationUnits(id);

  if (total === 0) {
    return (
      <Card title="On the shelf">
        <CardEmpty>
          {gone > 0 ? (
            <>
              Nothing in the fleet is filed here — only{" "}
              {gone === 1 ? "one unit that has been" : `${gone} units that have been`}{" "}
              retired or sold and kept the location they were last at. Transfer a
              unit in, or receive a purchase order against this location, and it
              appears here.
            </>
          ) : (
            <>
              No unit is filed at this location. A unit gets one when it is
              received against a purchase order or transferred in — until then
              this location is a label with nothing behind it.
            </>
          )}
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="On the shelf"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
      action={
        total > rows.length ? (
          <Link
            href={`/dashboard/units?location=${id}`}
            className="text-detail text-accent-text hover:underline"
          >
            All in Units →
          </Link>
        ) : null
      }
      className="min-h-0"
    >
      <div className="grid grid-cols-[92px_minmax(0,1.2fr)_84px_minmax(0,1fr)] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Unit</span>
        <span>Asset</span>
        <span>Status</span>
        <span>With</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[92px_minmax(0,1.2fr)_84px_minmax(0,1fr)] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
          >
            {/* Three links in one row rather than one link over the whole row:
                the unit, what it is, and who has it are three different records
                and a reader wants a different one of them each time. */}
            <Link
              href={`/dashboard/units/${row.id}`}
              className="truncate font-bold tabular-nums hover:underline"
            >
              {row.barcode}
            </Link>
            <Link
              href={`/dashboard/assets/${row.asset.id}`}
              className="truncate hover:underline"
            >
              {row.asset.name}
            </Link>
            <span className="truncate">
              <StatusText status={row.status} />
            </span>
            {row.holder ? (
              <Link
                href={`/dashboard/clients/${row.holder.id}`}
                className="truncate text-accent-text hover:underline"
              >
                {row.holder.name}
              </Link>
            ) : (
              <Unset>On the shelf</Unset>
            )}
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
        {/* A unit that is out is still filed here — this is where it lives, not
            where it is tonight — and a shelf count read as "things I could walk
            up to" would be wrong by however many are with clients. */}
        In-fleet units only, whether or not they are physically here: a unit out
        with a client keeps the location it goes back to.
        {gone > 0
          ? ` ${gone} retired or sold ${gone === 1 ? "unit is" : "units are"} filed here and not listed.`
          : ""}
      </p>
    </Card>
  );
}

/**
 * What kinds of thing are here, biggest holding first.
 *
 * "Have we got a Venice in Burbank and is one free" is the question a shelf gets
 * asked, and 684 unit rows cannot answer it. Free is AVAILABLE only, the one
 * bookable definition, and reads in accent at zero exactly as it does on the
 * Assets list — a full shelf with nothing free is the case worth seeing.
 */
export async function LocationAssetsCard({ id }: { id: string }) {
  const { rows, total } = await getLocationAssets(id);

  if (total === 0) {
    return (
      <Card title="What is here">
        <CardEmpty>
          Nothing in the fleet is filed at this location, so there is no
          breakdown to give. It fills in as units are transferred in.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="What is here"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} assets shown`
          : `all ${total} ${total === 1 ? "asset" : "assets"} shown`
      }
      className="min-h-0"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Asset</span>
        <span className="text-right">Here</span>
        <span className="text-right">Free</span>
        <span className="text-right">Out</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            {/* To the units, not to the asset record: this row is a statement
                about what is on *this* shelf, and the asset record is about the
                asset everywhere. Both ids ride along, so the list shows the
                same set the row counted. */}
            <Link
              href={`/dashboard/units?asset=${row.id}&location=${id}`}
              className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold">{row.name}</span>
              <span className="text-right tabular-nums">{row.inFleet}</span>
              <span
                className={`text-right tabular-nums ${
                  row.free === 0 ? "font-bold text-accent-text" : ""
                }`}
              >
                {row.free}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {row.out || "—"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-detail text-ink-muted">
        Ordered by how many are here. Free is AVAILABLE only — reserved and
        out-of-service units are here but cannot be promised.
      </p>
    </Card>
  );
}

/* ── How things got here ────────────────────────────────────────────────── */

/**
 * Moves in and out, as a log.
 *
 * `AssetTransfer` has no status column, so a row is a move that already
 * happened; calling this a queue would promise an approval step the schema does
 * not have. The arrow reads from this location's point of view — in or out —
 * because "LA → LA" tells a reader nothing about which of the two shelves they
 * are standing on.
 */
export async function LocationTransfersCard({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const { rows, total } = await getLocationTransfers(id);

  if (total === 0) {
    return (
      <Card title="Moves">
        <CardEmpty>
          Nothing has moved in or out of {name}. A transfer is written when a
          unit physically moves between locations — it is a log of what happened,
          not a request waiting for approval.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Moves"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[84px_86px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
          >
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.date)}
            </span>
            <Link
              href={`/dashboard/units/${row.unit.id}`}
              className="truncate font-bold tabular-nums hover:underline"
            >
              {row.unit.barcode}
            </Link>
            <Link
              href={`/dashboard/assets/${row.asset.id}`}
              className="truncate hover:underline"
            >
              {row.asset.name}
            </Link>
            <span className="truncate text-ink-muted">
              {row.inbound ? "in from " : "out to "}
              <Link
                href={`/dashboard/locations/${
                  row.inbound ? row.from.id : row.to.id
                }`}
                className="text-accent-text hover:underline"
              >
                {row.inbound ? row.from.name : row.to.name}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Purchase orders shipping here.
 *
 * The one thing on this screen that is about hardware which is *not* on the
 * shelf yet, which is why it is worth its own card: a location with nothing free
 * and three POs inbound is a different problem from one with nothing free and
 * nothing coming.
 */
export async function LocationInboundCard({ id }: { id: string }) {
  const { rows, total, onOrder } = await getLocationPurchaseOrders(id);

  if (total === 0) {
    return (
      <Card title="Shipping here">
        <CardEmpty>
          No purchase order names this location as its ship-to. Set one when
          raising a PO and the hardware lands on this shelf when it is received.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Shipping here"
      meta={
        onOrder === 0
          ? `${total} raised, none still on order`
          : `${onOrder} still on order of ${total} raised`
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/purchase-orders/${row.id}`}
              className="grid grid-cols-[minmax(0,1fr)_106px_78px_84px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
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
      <p className="px-4 pb-3 text-detail text-ink-muted">
        {/* Same definition as the Purchase orders list's On order tab. A draft
            has not been placed with anybody and is not arriving. */}
        On order means submitted or part received — a draft is not on its way.
        {total > rows.length ? ` The ${rows.length} newest are listed.` : ""}
      </p>
    </Card>
  );
}
