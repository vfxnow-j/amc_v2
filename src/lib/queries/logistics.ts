import { cache } from "react";
import type {
  DeliveryMethod,
  Prisma,
  ReservationStatus,
} from "@/generated/prisma/client";
import { CARRIED } from "@/lib/orders/shipping";
import { prisma } from "@/lib/prisma";
import { applyShippingMargin } from "@/lib/pricing/financials";
import { OPEN_STATUSES } from "@/lib/reservations/status";

/**
 * Getting the kit there and back — read off the columns that already exist.
 *
 * **The ceiling, stated once here and repeated in the tile copy.** There is no
 * `Shipment` model in this schema. There is no per-parcel record, no weight, no
 * dimensions, no carrier rate and no label. What an order holds is exactly
 * this, per direction:
 *
 *   one method · one courier · one tracking number · one cost
 *
 * That is a bookkeeping note about a shipment, not a shipment. Every question
 * this file can answer is a question about *those fourteen columns*, and the
 * moment a question needs two parcels, a box size or a quoted rate the answer
 * is a new feature and not a better query. Freight labels and rate comparison
 * are that feature. Nothing in dashboard work adds a `Shipment` model to reach
 * them.
 *
 * Within the ceiling there is still one thing worth counting, and nothing in
 * v1 or v2 counts it: **an order that has shipped by courier and carries no
 * tracking number.** The kit is with a third party, the client will ask where
 * it is, and the only honest answer the business has is "somewhere". That is an
 * operational fault, it is provable from two columns, and it is the tile.
 *
 * Everything here reads. Nothing writes — the shipping card on the order record
 * is where these fields are set.
 */

/* ── What counts as a courier ────────────────────────────────────────────── */

/**
 * The two methods where a third party has the kit and a tracking number is the
 * only way to know where it is.
 *
 * Local delivery and local pickup are our own van, and customer pickup and
 * dropoff are the client's own hands: nobody is waiting on a number for those,
 * and counting them as untracked would drown the real four in twenty-seven.
 *
 * Taken from `lib/orders/shipping`, which is where the shipping card already
 * decides whether to show a tracking field. Retyping the pair here would mean
 * the tile could flag a leg the record offers nowhere to fix.
 */
const COURIER_METHODS: DeliveryMethod[] = CARRIED;

/**
 * Gone: the kit has left the building.
 *
 * APPROVED and PREPARING are excluded deliberately and the tile says so. An
 * order being picked has no tracking number because nothing has been handed to
 * a courier yet — flagging it would be flagging the future, and a queue that
 * cries wolf about work not yet done is a queue people stop reading.
 */
const SHIPPED_STATUSES: ReservationStatus[] = ["SHIPPED", "ACTIVE"];

export type ShipmentDirection = "out" | "back";

export type UntrackedLeg = {
  /** Stable per leg: one order can be untracked in both directions. */
  key: string;
  reservationId: string;
  reservationNumber: string;
  clientName: string;
  direction: ShipmentDirection;
  method: DeliveryMethod;
  /** Null far more often than not — see `courierless` below. */
  courier: string | null;
  /** When the leg was due to move. Null when nothing dates it. */
  dueAt: Date | null;
  /** Days since `dueAt`, or null when undated. Never negative. */
  daysSince: number | null;
};

export type UntrackedShipments = {
  legs: UntrackedLeg[];
  /** Untracked legs in total — can exceed `orders`, since an order has two. */
  total: number;
  /** Distinct orders behind those legs. */
  orders: number;
  /** Courier legs on shipped orders, tracked or not. The denominator. */
  courierLegs: number;
  /** Of the untracked legs, how many name no courier either. */
  courierless: number;
  /**
   * Courier legs on orders that have not shipped yet — approved and being
   * picked. Not a fault, but the tile has to say the number is not the whole
   * courier book.
   */
  notYetShipped: number;
};

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Orders out with a courier that nobody can locate.
 *
 * Two directions, and they are not symmetrical:
 *
 * - **Out.** The order has shipped, so the delivery leg has happened. No
 *   tracking number is a fault the moment the status moves.
 * - **Back.** The return leg has not happened yet while the order is running,
 *   so a missing number is only a fault once the kit was *due* back. `returnDate`
 *   dates it where it is set; otherwise `endDate` does — but **only on
 *   non-recurring orders**, because a recurring order's `endDate` is the end of
 *   the current billing period and not a return date. Treating it as one is the
 *   mistake that once read 214 units overdue instead of 35, and it would read
 *   every rolling monthly contract here as a missing return shipment forever.
 *
 * Wrapped in React `cache()`: the dashboard is a grid of independently
 * suspended tiles and more than one of them can ask about shipping.
 */
export const getUntrackedShipments = cache(async function getUntrackedShipments(
  now = new Date(),
  take = 8,
): Promise<UntrackedShipments> {
  const courierLeg: Prisma.ReservationWhereInput = {
    OR: [
      { deliveryMethod: { in: COURIER_METHODS } },
      { returnMethod: { in: COURIER_METHODS } },
    ],
  };

  const [orders, notYetShipped] = await Promise.all([
    // Bounded by construction: courier legs on orders that are out. A business
    // only ever has so many parcels in the air, and reading the rows lets the
    // return leg be dated against two columns without a second query.
    prisma.reservation.findMany({
      where: { AND: [{ status: { in: SHIPPED_STATUSES } }, courierLeg] },
      select: {
        id: true,
        reservationNumber: true,
        isRecurring: true,
        endDate: true,
        deliveryMethod: true,
        deliveryDate: true,
        deliveryCourier: true,
        deliveryTrackingNumber: true,
        returnMethod: true,
        returnDate: true,
        returnCourier: true,
        returnTrackingNumber: true,
        client: { select: { name: true } },
      },
    }),
    prisma.reservation.count({
      where: {
        AND: [{ status: { in: ["APPROVED", "PREPARING"] } }, courierLeg],
      },
    }),
  ]);

  const isCourier = (method: DeliveryMethod | null) =>
    method !== null && COURIER_METHODS.includes(method);

  const legs: UntrackedLeg[] = [];
  let courierLegs = 0;

  for (const order of orders) {
    const common = {
      reservationId: order.id,
      reservationNumber: order.reservationNumber,
      clientName: order.client.name,
    };

    if (isCourier(order.deliveryMethod)) {
      courierLegs += 1;
      if (!order.deliveryTrackingNumber) {
        const dueAt = order.deliveryDate;
        legs.push({
          ...common,
          key: `${order.id}:out`,
          direction: "out",
          method: order.deliveryMethod as DeliveryMethod,
          courier: order.deliveryCourier,
          dueAt,
          daysSince: dueAt ? Math.max(0, daysBetween(dueAt, now)) : null,
        });
      }
    }

    if (isCourier(order.returnMethod)) {
      courierLegs += 1;
      // `endDate` only stands in for a return date when the order is not
      // recurring. See the note above: on a rolling contract it is a billing
      // boundary, and every one of them would read as a lost parcel.
      const dueAt =
        order.returnDate ?? (order.isRecurring ? null : order.endDate);
      const due = dueAt !== null && dueAt <= now;

      if (!order.returnTrackingNumber && due) {
        legs.push({
          ...common,
          key: `${order.id}:back`,
          direction: "back",
          method: order.returnMethod as DeliveryMethod,
          courier: order.returnCourier,
          dueAt,
          daysSince: Math.max(0, daysBetween(dueAt, now)),
        });
      }
    }
  }

  // Longest untraced first: a parcel nobody has looked at for three weeks is
  // the one to chase. Undated legs sort last — they are a gap in the record
  // rather than a clock running.
  legs.sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1));

  return {
    legs: legs.slice(0, take),
    total: legs.length,
    orders: new Set(legs.map((leg) => leg.reservationId)).size,
    courierLegs,
    courierless: legs.filter((leg) => leg.courier === null).length,
    notYetShipped,
  };
});

/* ── How the kit moves ───────────────────────────────────────────────────── */

export type MethodCount = { method: DeliveryMethod; out: number; back: number };

export type DeliveryMix = {
  methods: MethodCount[];
  /** Live orders in total. */
  orders: number;
  /** Live orders that say nothing about how the kit gets there. */
  noDeliveryMethod: number;
  /** Live orders that say nothing about how it comes back. */
  noReturnMethod: number;
};

/**
 * How the live book moves, per direction.
 *
 * Both directions in one reading because they disagree more often than anyone
 * expects: an order can be couriered out and picked up by the client, and the
 * two columns are set at different moments by different people.
 *
 * The figure that earns the tile is the one nobody asks for — how many live
 * orders name **no** method at all. It is not a rounding error in this data;
 * it is half the book.
 */
export const getDeliveryMix = cache(async function getDeliveryMix(): Promise<DeliveryMix> {
  const live: Prisma.ReservationWhereInput = { status: { in: OPEN_STATUSES } };

  const [outbound, inbound, orders] = await Promise.all([
    prisma.reservation.groupBy({
      by: ["deliveryMethod"],
      where: live,
      _count: { _all: true },
    }),
    prisma.reservation.groupBy({
      by: ["returnMethod"],
      where: live,
      _count: { _all: true },
    }),
    prisma.reservation.count({ where: live }),
  ]);

  const byMethod = new Map<DeliveryMethod, MethodCount>();
  const bump = (
    method: DeliveryMethod | null,
    direction: "out" | "back",
    count: number,
  ) => {
    if (method === null) return;
    const row = byMethod.get(method) ?? { method, out: 0, back: 0 };
    row[direction] += count;
    byMethod.set(method, row);
  };

  for (const row of outbound) bump(row.deliveryMethod, "out", row._count._all);
  for (const row of inbound) bump(row.returnMethod, "back", row._count._all);

  // `groupBy` returns the nulls as their own row rather than omitting them,
  // which is the whole reason this reads the groups instead of running two
  // more counts.
  const unset = (count: number | undefined) => count ?? 0;

  return {
    methods: [...byMethod.values()].sort(
      (a, b) => b.out + b.back - (a.out + a.back),
    ),
    orders,
    noDeliveryMethod: unset(
      outbound.find((row) => row.deliveryMethod === null)?._count._all,
    ),
    noReturnMethod: unset(
      inbound.find((row) => row.returnMethod === null)?._count._all,
    ),
  };
});

/* ── What shipping makes ─────────────────────────────────────────────────── */

export type ShippingMargin = {
  /** Committed orders carrying a shipping cost in either direction. */
  priced: number;
  /** Of those, how many carry a margin rule. */
  withMargin: number;
  /** What the legs cost the business. */
  cost: number;
  /** What the client is charged, after each order's own margin rule. */
  charged: number;
  /** The difference. Zero when everything is billed at cost. */
  margin: number;
  /** Cost the business carries and never bills on. */
  internalCost: number;
  /**
   * Orders with a shipping cost that are still quotes, drafts or cancelled —
   * outside every figure above, and named because they are most of them.
   */
  uncommitted: number;
  /** A margin rule with no percentage or amount behind it. A broken row. */
  incompleteRules: number;
};

/**
 * What the business charges for shipping against what shipping costs it.
 *
 * `applyShippingMargin` does the arithmetic rather than this file, because that
 * function is what `computeReservationFinancials` uses to build the order total
 * — a second implementation here would eventually disagree with the number
 * printed on the quote.
 *
 * Scoped to the committed book (approved through completed). A margin on a
 * quote is a proposal, not revenue, and mixing the two would let a cancelled
 * order's 10% flatter the reading. The count of those is returned so the tile
 * can say how much it is leaving out.
 */
export const getShippingMargin = cache(async function getShippingMargin(): Promise<ShippingMargin> {
  const hasCost: Prisma.ReservationWhereInput = {
    OR: [{ deliveryCost: { gt: 0 } }, { returnCost: { gt: 0 } }],
  };
  const committed: ReservationStatus[] = [...OPEN_STATUSES, "COMPLETED"];

  const [orders, uncommitted] = await Promise.all([
    prisma.reservation.findMany({
      where: { AND: [{ status: { in: committed } }, hasCost] },
      select: {
        deliveryCost: true,
        returnCost: true,
        shippingMarginType: true,
        shippingMargin: true,
        internalShippingCost: true,
      },
    }),
    prisma.reservation.count({
      where: { AND: [{ status: { notIn: committed } }, hasCost] },
    }),
  ]);

  let cost = 0;
  let charged = 0;
  let internalCost = 0;
  let withMargin = 0;
  let incompleteRules = 0;

  for (const order of orders) {
    const marginType =
      order.shippingMarginType === "FIXED" ||
      order.shippingMarginType === "PERCENTAGE"
        ? order.shippingMarginType
        : null;
    const margin = Number(order.shippingMargin) || 0;

    // A margin type with nothing behind it bills at cost — `applyShippingMargin`
    // returns the cost unchanged. Counted rather than corrected: somebody chose
    // FIXED and never typed the amount, and only they know what it should be.
    if (marginType !== null && margin <= 0) incompleteRules += 1;
    if (marginType !== null && margin > 0) withMargin += 1;

    const delivery = Number(order.deliveryCost) || 0;
    const returned = Number(order.returnCost) || 0;

    cost += delivery + returned;
    charged +=
      applyShippingMargin(delivery, marginType, margin) +
      applyShippingMargin(returned, marginType, margin);
    internalCost += Number(order.internalShippingCost) || 0;
  }

  return {
    priced: orders.length,
    withMargin,
    cost: Math.round(cost * 100) / 100,
    charged: Math.round(charged * 100) / 100,
    margin: Math.round((charged - cost) * 100) / 100,
    internalCost: Math.round(internalCost * 100) / 100,
    uncommitted,
    incompleteRules,
  };
});
