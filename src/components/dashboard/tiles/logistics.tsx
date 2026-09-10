import Link from "next/link";
import { MoveArrow } from "@/components/move-arrow";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Empty,
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { day, money } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/orders/shipping";
import {
  getDeliveryMix,
  getShippingMargin,
  getUntrackedShipments,
} from "@/lib/queries/logistics";

/**
 * The Logistics tiles.
 *
 * **The ceiling is in the copy, not only in the comments, and that is
 * deliberate.** There is no `Shipment` model here: no per-parcel record, no
 * weight, no dimensions, no carrier rate, no label. An order holds one method,
 * one courier, one tracking number and one cost per direction, and every figure
 * below is a reading of those columns. Somebody who glances at "6 courier legs"
 * and assumes it means six parcels will be wrong the first time an order ships
 * in two boxes — so the tiles say legs, and say what a leg is.
 *
 * Freight labels and rate comparison are a separate feature, and they need the
 * model these tiles pointedly do not add.
 */

/**
 * The one operational fault nothing else in the app counts.
 *
 * An order has shipped by courier, a third party has the hardware, and there is
 * no tracking number on the record. The client will ask where their kit is and
 * the only honest answer the business has is "somewhere". It is provable from
 * two columns and it has never been on a screen.
 *
 * The empty state matters as much as the count: "nothing untracked" and "we
 * courier nothing" are different facts, and a tile that rendered the same words
 * for both would be lying by omission the day it starts mattering.
 */
export async function UntrackedShipmentsTile() {
  const {
    legs,
    total,
    orders,
    courierLegs,
    courierless,
    notYetShipped,
  } = await getUntrackedShipments();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Untracked shipments"
        meta={
          courierLegs === 0
            ? "nothing with a courier"
            : `${total} of ${countLabel(courierLegs, "courier leg")}`
        }
        badge={
          total > 0 ? (
            <span className="rounded-pill bg-accent-tint-strong px-2 py-px text-pill text-accent-on-tint">
              needs a number
            </span>
          ) : undefined
        }
        href="/dashboard/orders?view=out-now"
        hrefLabel="Orders →"
      />

      {courierLegs === 0 ? (
        <Empty>
          Nothing shipped is travelling by small package or freight. Kit going
          out in our own van or collected by the client needs no tracking
          number, so this stays empty until an order books a courier.
        </Empty>
      ) : total === 0 ? (
        <Empty>
          Every courier leg on a shipped order carries a tracking number. New
          ones appear here the moment an order ships without one.
        </Empty>
      ) : (
        <>
          <ul className="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
            {legs.map((leg, index) => (
              <li key={leg.key}>
                <Link
                  href={`/dashboard/orders/${leg.reservationId}`}
                  title={
                    leg.dueAt
                      ? `${leg.reservationNumber} · ${
                          leg.direction === "out" ? "shipped" : "due back"
                        } ${day(leg.dueAt)}`
                      : `${leg.reservationNumber} · no date on the leg`
                  }
                  className={`grid grid-cols-[minmax(0,1fr)_52px_84px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {leg.clientName}
                    <span className="text-ink-faint">
                      {" "}
                      · {METHOD_LABEL[leg.method]}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-detail text-ink-muted">
                    <MoveArrow
                      direction={leg.direction === "out" ? "out" : "back"}
                      labelled={false}
                    />
                    {leg.direction === "out" ? "out" : "back"}
                  </span>
                  <span
                    className={`text-right text-detail tabular-nums ${
                      (leg.daysSince ?? 0) >= 14
                        ? "font-bold text-accent-text"
                        : "text-ink-muted"
                    }`}
                  >
                    {leg.daysSince === null
                      ? "undated"
                      : `${leg.daysSince}d`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <Excludes>
            {total === 1 ? "One leg" : `${total} legs`} across{" "}
            {countLabel(orders, "order")}, counted per direction — the schema
            holds one tracking number each way per order, never one per parcel,
            so an order shipped in three boxes is still one leg here.{" "}
            {courierless > 0
              ? `${courierless} of them name no courier either. `
              : ""}
            {notYetShipped > 0
              ? `${countLabel(notYetShipped, "courier order")} approved or being picked ${
                  notYetShipped === 1 ? "is" : "are"
                } outside this — nothing has been handed over yet.`
              : ""}
          </Excludes>
        </>
      )}
    </Tile>
  );
}

/**
 * How the live book actually moves, in both directions.
 *
 * The reading that earns the tile is not the mix — it is the count of live
 * orders that name no method at all. Nobody asks for that number, nothing else
 * shows it, and in this data it is half the book: an order with no delivery
 * method is one where whoever packs it has to ask.
 */
export async function DeliveryMixTile() {
  const { methods, orders, noDeliveryMethod, noReturnMethod } =
    await getDeliveryMix();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="How the kit moves"
        meta={orders === 0 ? undefined : `${countLabel(orders, "live order")}`}
        href="/dashboard/orders?view=open"
        hrefLabel="Orders →"
      />

      {orders === 0 ? (
        <Empty>
          No order is live. Approve one and how it travels — our van, a courier,
          or the client&rsquo;s own hands — shows up here.
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_44px_44px] gap-2 px-2 pb-[2px] text-colhead uppercase text-ink-muted">
            <span>Method</span>
            <span className="text-right">Out</span>
            <span className="text-right">Back</span>
          </div>

          <ul className="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
            {methods.map((row, index) => (
              <li
                key={row.method}
                className={`grid grid-cols-[minmax(0,1fr)_44px_44px] items-center gap-2 rounded-row px-2 py-[6px] ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  {METHOD_LABEL[row.method]}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {row.out === 0 ? "—" : row.out}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {row.back === 0 ? "—" : row.back}
                </span>
              </li>
            ))}
            <li className="grid grid-cols-[minmax(0,1fr)_44px_44px] items-center gap-2 rounded-row px-2 py-[6px]">
              <span className="min-w-0 truncate text-ink-muted">Not set</span>
              <span
                className={`text-right tabular-nums ${
                  noDeliveryMethod > 0 ? "font-bold text-accent-text" : "text-ink-muted"
                }`}
              >
                {noDeliveryMethod === 0 ? "—" : noDeliveryMethod}
              </span>
              <span
                className={`text-right tabular-nums ${
                  noReturnMethod > 0 ? "font-bold text-accent-text" : "text-ink-muted"
                }`}
              >
                {noReturnMethod === 0 ? "—" : noReturnMethod}
              </span>
            </li>
          </ul>

          <Excludes>
            Counted per direction, one method each way per order — the two
            disagree more often than you would expect, because they are set at
            different moments by different people.{" "}
            {noDeliveryMethod > 0
              ? `${noDeliveryMethod} of ${orders} live orders say nothing about how the kit gets there.`
              : "Every live order says how the kit gets there."}
          </Excludes>
        </>
      )}
    </Tile>
  );
}

/**
 * What shipping is charged against what it costs.
 *
 * Not a rate comparison and it cannot become one: there are no carrier rates in
 * this schema, so the only two numbers that exist are what somebody typed as
 * the cost and what the order's margin rule makes of it. `applyShippingMargin`
 * does that arithmetic — the same function `computeReservationFinancials` uses
 * to build the order total, so this tile and the quote can never disagree.
 */
export async function ShippingMarginTile() {
  const {
    priced,
    withMargin,
    cost,
    charged,
    margin,
    internalCost,
    uncommitted,
    incompleteRules,
  } = await getShippingMargin();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="What shipping makes"
        meta={
          priced === 0
            ? undefined
            : `${countLabel(priced, "committed order")} with a shipping cost`
        }
        href="/dashboard/orders?view=open"
        hrefLabel="Orders →"
      />

      {priced === 0 ? (
        <Empty>
          No committed order carries a shipping cost. Enter one on the order&rsquo;s
          shipping card and what the client is charged for it appears here.
        </Empty>
      ) : (
        <>
          <Figures>
            <Figure label="Costs" value={money(cost)} detail="what we paid" />
            <Figure
              label="Charged"
              value={money(charged)}
              detail="after each order's margin"
            />
            <Figure
              label="Margin"
              value={money(margin)}
              tone={margin <= 0 ? "alert" : "plain"}
              detail={
                margin <= 0
                  ? "shipping bills at cost"
                  : `${((margin / cost) * 100).toFixed(0)}% on cost`
              }
            />
          </Figures>

          <Excludes>
            {withMargin} of {priced} carry a margin rule; the rest bill the cost
            straight through.{" "}
            {incompleteRules > 0
              ? `${countLabel(incompleteRules, "order")} names a margin type with no amount behind it, so it bills at cost too. `
              : ""}
            {internalCost > 0
              ? `${money(internalCost)} more is carried internally and billed to nobody. `
              : ""}
            {uncommitted > 0
              ? `${countLabel(uncommitted, "quote or cancelled order")} with a shipping cost sits outside every figure here — a margin on a quote is a proposal, not revenue.`
              : ""}
          </Excludes>

          <p className="mt-1 text-detail text-ink-faint">
            One cost per direction per order. There is no parcel record, no
            weight and no carrier rate in this schema, so this says what was
            typed and what was billed — never whether it was the right price.
          </p>
        </>
      )}
    </Tile>
  );
}
