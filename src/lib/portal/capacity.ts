import type {
  AssetStatus,
  BillingCycleType,
  DeliveryMethod,
  ReservationStatus,
  ReservationType,
} from "@/generated/prisma/client";
import { holidayOn } from "@/lib/calendar/holidays";
import { termEnd } from "@/lib/billing/payment-schedule";
import { HOLDS_STOCK_STATUSES } from "@/lib/inventory/availability";

/**
 * Capacity for the portal: what we can promise, per asset and summed over a
 * pool. Pure — no Prisma, no clock — so the rules are tested exactly as the
 * route runs them. `capacity-load.ts` reads the rows; this decides what they
 * mean. The contract is `docs/portal-api.md` §2, the rules
 * `docs/portal-api-plan.md` §3.
 *
 * Every figure is a count of units, over a window that is "today" unless the
 * caller asks for a range:
 *
 * - **total**: units in the fleet (not RETIRED or SOLD).
 * - **reserved**: order quantities on orders that hold stock (HOLDS_STOCK)
 *   and occupy the window, plus units in MAINTENANCE, plus units out on a
 *   checkout with no order behind it.
 * - **tentative**: portal holds, plus QUOTE_SENT orders overlapping the window.
 * - **available_now**: `max(0, total − reserved − tentative)`.
 * - **next_available**: when enough units are next ready — see below.
 * - **demand**: `high` when `(reserved + tentative) / total ≥ 0.8`.
 *
 * **An order occupies its units until they are ready again**, not until its end
 * date: from `startDate` to (expected return + return transit + the category's
 * refurb buffer). That is what makes `available_now` and `next_available` agree
 * — a unit whose rental ended yesterday but is still in a truck is neither
 * "available now" nor a promise for today.
 *
 * **Overdue returns are never promised.** An order that is out (SHIPPED or
 * ACTIVE) whose expected return is before today has not come back: its units
 * stay reserved and it contributes no date. The same holds for a loose checkout
 * or a maintenance job whose date has passed. An APPROVED/PREPARING order whose
 * end has passed never went out and is stale; it holds nothing.
 *
 * What this does not model (Phase 1): a unit returned next week may already be
 * promised to an order starting the week after — future bookings are counted
 * only when they overlap the requested window.
 */

/**
 * Orders that hold stock — the same list the order builder's `HOLDS_STOCK`
 * wraps in a `Prisma.ReservationWhereInput`. Both read from
 * `lib/inventory/availability.ts`, which has no Prisma value import, so this
 * module stays testable with no database.
 */
export const CAPACITY_HOLDS_STOCK: ReservationStatus[] = HOLDS_STOCK_STATUSES;
/** Out with the client: their units can be overdue. */
const OUT_WITH_CLIENT: ReservationStatus[] = ["SHIPPED", "ACTIVE"];
const OUT_OF_FLEET: AssetStatus[] = ["RETIRED", "SOLD"];

export const DEMAND_HIGH_AT = 0.8;
export const DEFAULT_REFURB_BUFFER_DAYS = 2;

/**
 * Return transit, in business days, by how the kit comes back. The same working
 * assumptions as the outbound `SPEED` table in `lib/orders/shipping.ts`:
 * a pickup is next day, a parcel is planned as ground (5), freight as standard
 * (7), and a client dropping it at our door is there the same day. The two
 * outbound-only methods are mapped for completeness should one be stored on a
 * return. Unknown (no method recorded) is planned as ground — never optimistic.
 */
export const RETURN_TRANSIT_DAYS: Record<DeliveryMethod, number> = {
  CUSTOMER_DROPOFF: 0,
  CUSTOMER_PICKUP: 0,
  LOCAL_PICKUP: 1,
  LOCAL_DELIVERY: 1,
  SMALL_PACKAGE: 5,
  FREIGHT: 7,
};
export const UNKNOWN_RETURN_TRANSIT_DAYS = 5;

export type CapacityOrder = {
  status: ReservationStatus;
  quantity: number;
  startDate: Date;
  endDate: Date;
  /** A scheduled return date — firmer than the end date. */
  returnDate: Date | null;
  returnMethod: DeliveryMethod | null;
  returnTrackingNumber: string | null;
  /** Units already checked back in. Only read once the order is out. */
  checkedInCount?: number;
  /**
   * Units ever checked out on this item. A unit swap
   * (`swapReservationItemUnit`) increments both this and `checkedInCount`
   * together — the old unit checks in, the new one checks out — so neither
   * count alone says how many are still with the client; see the reduction in
   * `assetFigures`. Only read once the order is out. Defaults to `quantity`
   * when absent (older callers/tests), matching pre-swap behavior.
   */
  checkedOutCount?: number;
  /**
   * What kind of order this is, and how it bills — together they say whether
   * `endDate` is a real end (a one-time rental) or only a billing-period
   * boundary (a recurring rental/cloud order, which stays out until its
   * committed term ends, or forever if it has none). See `expectedReturnOf`.
   */
  reservationType: ReservationType;
  billingCycleType: BillingCycleType;
  isRecurring: boolean;
  /** The committed term, in months, of a recurring RENTAL/CLOUD order. */
  termMonths: number | null;
  /** The committed term, in months, of a FLOW order — its `endDate` is already `startDate + flowTermMonths`. */
  flowTermMonths: number | null;
};

export type CapacityUnit = {
  status: AssetStatus;
  /** An open checkout with no order behind it; its expected return, if any. */
  looseCheckout: { expectedReturn: Date | null } | null;
  /**
   * The open maintenance job's ready date (its returnDate ?? completionDate),
   * or null when none is set. Only read when the unit is in MAINTENANCE.
   */
  maintenanceReady: Date | null;
  /** What the unit may be offered as (AssetUnit.offeredAs). Absent = the column default. */
  offeredAs?: readonly string[];
};

/** AssetUnit.offeredAs's database default, for units read without it. */
export const DEFAULT_OFFERED_AS: readonly string[] = ["RENTAL", "FLOW"];

export type CapacityHold = { quantity: number; from: Date; to: Date };

export type CapacityAsset = {
  assetId: string;
  name: string;
  refurbBufferDays: number;
  units: CapacityUnit[];
  orders: CapacityOrder[];
  holds?: CapacityHold[];
};

export type NextAvailable = {
  /** YYYY-MM-DD, or null when status is `none`. */
  date: string | null;
  status: "expected" | "confirmed" | "none";
};

export type CapacityFigures = {
  total: number;
  reserved: number;
  tentative: number;
  available_now: number;
  next_available: NextAvailable;
  demand: "normal" | "high";
};

export type CapacityOptions = {
  /** Window start; defaults to today. */
  from?: Date;
  /** Window end; defaults to `from`. */
  to?: Date;
  /** Units wanted; next_available is when this many are ready. Default 1. */
  qty?: number;
};

type ReadyEvent = { day: string; units: number; status: "expected" | "confirmed" };

/* ── Days ─────────────────────────────────────────────────────────────────── */

/** A date's UTC calendar day. Stored days are noon UTC, so this is stable. */
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWorkingDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && !holidayOn(date)?.carrierClosed;
}

/** Step forward `days` working days (weekends and carrier holidays skipped). */
export function addBusinessDays(from: Date, days: number): Date {
  let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  for (let left = days; left > 0; ) {
    day = new Date(day.getTime() + 86_400_000);
    if (isWorkingDay(day)) left--;
  }
  return day;
}

/**
 * When an order's units are due back, or `null` when none will ever be
 * promised. The type is checked first:
 *
 * - RENT_TO_OWN and SALE: the gear does not come back to the fleet — no
 *   candidate, ever, regardless of `returnDate`. A rental converted to RTO (or
 *   sold outright) can still carry a `returnDate` left over from when it was a
 *   rental; trusting that stale date would promise back gear that was never
 *   coming back.
 * - Every other type: a scheduled `returnDate` is firmer than a computed one
 *   and wins immediately. This is deliberate for FLOW/RENTAL/CLOUD — it lets
 *   an early return (a client sending gear back ahead of its term) pre-empt
 *   the term math below, unlike RTO/SALE where no returnDate is ever honored.
 * - FLOW: `endDate` is already `startDate + flowTermMonths` (the builder sets
 *   it with the same month-stepping arithmetic as `termEnd`), so it is used
 *   directly once that agrees; a mismatch (stale data) falls back to the
 *   recomputed term end rather than trust a wrong stored date.
 * - RENTAL/CLOUD, not recurring (billingCycleType ONE_TIME): `endDate` is a
 *   real end date, same as always.
 * - RENTAL/CLOUD, recurring: `endDate` is only a billing-period boundary, not
 *   a return — using it is the bug this fixes (an active monthly rental read
 *   as "170 days overdue" once it rolled past its first period end). The real
 *   promise is the end of the committed term (`termMonths`), if the order has
 *   one; an open-ended recurring order (no term, no scheduled return) is
 *   never promised back.
 */
function expectedReturnOf(order: CapacityOrder): Date | null {
  if (order.reservationType === "SALE" || order.reservationType === "RENT_TO_OWN") return null;
  if (order.returnDate) return order.returnDate;
  if (order.reservationType === "FLOW") {
    const computed = order.flowTermMonths ? termEnd(order.startDate, order.flowTermMonths) : null;
    if (computed && dayOf(computed) === dayOf(order.endDate)) return order.endDate;
    return computed ?? order.endDate;
  }
  // RENTAL / CLOUD.
  if (!order.isRecurring) return order.endDate;
  return order.termMonths ? termEnd(order.startDate, order.termMonths) : null;
}

/* ── The calculation ─────────────────────────────────────────────────────── */

export type CapacityResult = {
  pool: CapacityFigures;
  assets: (CapacityFigures & { assetId: string; name: string })[];
};

export function computeCapacity(
  assets: CapacityAsset[],
  today: Date,
  options: CapacityOptions = {},
): CapacityResult {
  const todayDay = dayOf(today);
  const fromDay = dayOf(options.from ?? today) < todayDay ? todayDay : dayOf(options.from ?? today);
  const toDay = options.to && dayOf(options.to) > fromDay ? dayOf(options.to) : fromDay;
  const qty = Math.max(1, Math.floor(options.qty ?? 1));

  const perAsset = assets.map((asset) => {
    const figures = assetFigures(asset, todayDay, fromDay, toDay);
    return { asset, ...figures };
  });

  const results = perAsset.map(({ asset, counts, events }) => ({
    assetId: asset.assetId,
    name: asset.name,
    ...finish(counts, events, fromDay, qty),
  }));

  const poolCounts = perAsset.reduce(
    (sum, { counts }) => ({
      total: sum.total + counts.total,
      reserved: sum.reserved + counts.reserved,
      tentative: sum.tentative + counts.tentative,
      available: sum.available + counts.available,
    }),
    { total: 0, reserved: 0, tentative: 0, available: 0 },
  );
  const poolEvents = perAsset.flatMap(({ events }) => events);

  return { pool: finish(poolCounts, poolEvents, fromDay, qty), assets: results };
}

type Counts = { total: number; reserved: number; tentative: number; available: number };

function assetFigures(
  asset: CapacityAsset,
  todayDay: string,
  fromDay: string,
  toDay: string,
): { counts: Counts; events: ReadyEvent[] } {
  const buffer = Math.max(0, asset.refurbBufferDays);
  const fleet = asset.units.filter((unit) => !OUT_OF_FLEET.includes(unit.status));
  const events: ReadyEvent[] = [];
  let reserved = 0;
  let tentative = 0;

  for (const order of asset.orders) {
    // Once an order is out, only units still with the client count. A unit
    // swap bumps checkedOutCount and checkedInCount together (the old unit
    // checks in, the new one checks out), so `quantity - checkedInCount`
    // alone reads a swap as a partial return. What is still held is: whatever
    // of the committed quantity hasn't been checked out yet (still-promised,
    // not yet shipped) plus whatever has been checked out but not checked
    // back in (physically out now).
    const quantity = OUT_WITH_CLIENT.includes(order.status)
      ? (() => {
          const checkedOut = order.checkedOutCount ?? order.quantity;
          const notYetShipped = Math.max(0, order.quantity - checkedOut);
          const outNow = Math.max(0, checkedOut - (order.checkedInCount ?? 0));
          return notYetShipped + outNow;
        })()
      : order.quantity;
    if (quantity <= 0) continue;
    const startDay = dayOf(order.startDate);

    if (order.status === "QUOTE_SENT") {
      if (startDay <= toDay && dayOf(order.endDate) >= fromDay) tentative += quantity;
      continue;
    }
    if (!CAPACITY_HOLDS_STOCK.includes(order.status)) continue;
    if (startDay > toDay) continue;

    const expectedReturn = expectedReturnOf(order);
    if (expectedReturn === null) {
      // Never promised back (financed RTO/SALE, or an open-ended recurring
      // order with no committed term): the units stay reserved, no event.
      reserved += quantity;
      continue;
    }
    if (dayOf(expectedReturn) < todayDay) {
      // Overdue if it is out: reserved, and never promised back.
      if (OUT_WITH_CLIENT.includes(order.status)) reserved += quantity;
      continue;
    }

    const transit = order.returnMethod
      ? RETURN_TRANSIT_DAYS[order.returnMethod]
      : UNKNOWN_RETURN_TRANSIT_DAYS;
    const readyDay = dayOf(addBusinessDays(expectedReturn, transit + buffer));
    if (readyDay <= fromDay) continue; // back and refurbished before the window opens

    reserved += quantity;
    const confirmed = Boolean(order.returnTrackingNumber?.trim()) || order.returnDate !== null;
    events.push({ day: readyDay, units: quantity, status: confirmed ? "confirmed" : "expected" });
  }

  for (const unit of fleet) {
    if (unit.status === "MAINTENANCE") {
      // The job's own date is when it is ready — no transit, no second buffer.
      const ready = unit.maintenanceReady ? dayOf(unit.maintenanceReady) : null;
      if (ready !== null && ready >= todayDay && ready <= fromDay) continue;
      reserved += 1;
      if (ready !== null && ready >= todayDay) events.push({ day: ready, units: 1, status: "expected" });
      continue;
    }
    if (unit.looseCheckout) {
      const back = unit.looseCheckout.expectedReturn;
      const ready = back && dayOf(back) >= todayDay ? dayOf(addBusinessDays(back, buffer)) : null;
      if (ready !== null && ready <= fromDay) continue;
      reserved += 1;
      if (ready !== null) events.push({ day: ready, units: 1, status: "expected" });
    }
  }

  for (const hold of asset.holds ?? []) {
    if (hold.quantity > 0 && dayOf(hold.from) <= toDay && dayOf(hold.to) >= fromDay) {
      tentative += hold.quantity;
    }
  }

  const total = fleet.length;
  return {
    counts: { total, reserved, tentative, available: Math.max(0, total - reserved - tentative) },
    events,
  };
}

function finish(counts: Counts, events: ReadyEvent[], fromDay: string, qty: number): CapacityFigures {
  const committed = counts.reserved + counts.tentative;
  // Orders can promise more than the fleet holds (stale or mis-keyed data). The
  // portal sees parts of the fleet, so each figure is capped at what is left;
  // next_available still works from the raw shortfall.
  const reserved = Math.min(counts.reserved, counts.total);
  return {
    total: counts.total,
    reserved,
    tentative: Math.min(counts.tentative, counts.total - reserved),
    available_now: counts.available,
    next_available: nextAvailable(counts, events, fromDay, qty),
    demand: counts.total > 0 && committed / counts.total >= DEMAND_HIGH_AT ? "high" : "normal",
  };
}

/**
 * When `qty` units are next ready. Enough free in the window already → the
 * window's first day, confirmed. Otherwise walk the ready events in date order
 * until enough have come back; the date is the one that crosses the line, and
 * the status is `expected` if any event relied on is only an end date (a chain
 * is as firm as its weakest link). Not enough ever comes back → `none`.
 *
 * Units can only come back to a fleet that has them, so the free count is
 * capped at `total − tentative`: a returned unit someone holds is not free.
 */
function nextAvailable(counts: Counts, events: ReadyEvent[], fromDay: string, qty: number): NextAvailable {
  if (counts.total === 0) return { date: null, status: "none" };
  if (counts.available >= qty) return { date: fromDay, status: "confirmed" };

  // Starts negative when overbooked: returns repay the shortfall first.
  let free = counts.total - counts.reserved - counts.tentative;
  let firm = true;
  const ceiling = counts.total - counts.tentative;
  const sorted = [...events].sort((a, b) =>
    a.day === b.day ? (a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1) : a.day < b.day ? -1 : 1,
  );
  for (const event of sorted) {
    free = Math.min(ceiling, free + event.units);
    if (event.status === "expected") firm = false;
    if (free >= qty) return { date: event.day, status: firm ? "confirmed" : "expected" };
  }
  return { date: null, status: "none" };
}

/**
 * The asset's figures narrowed to the units ticked for one offering (RENTAL,
 * SALE, FLOW). Orders book a quantity of the asset, not particular units — a
 * unit is only picked at checkout — so this is a ceiling, never a guess: no
 * more can be offered than the asset has free overall, nor than it has units
 * ticked for the offering. Staff can still put rentals on the other units.
 */
export function figuresForOffering(
  asset: Pick<CapacityAsset, "units">,
  figures: CapacityFigures,
  offering: string,
  qty = 1,
): CapacityFigures {
  const eligible = asset.units.filter((unit) => (unit.offeredAs ?? DEFAULT_OFFERED_AS).includes(offering)).length;
  if (eligible === 0) {
    return { total: 0, reserved: 0, tentative: 0, available_now: 0, next_available: { date: null, status: "none" }, demand: "normal" };
  }
  const reserved = Math.min(figures.reserved, eligible);
  return {
    total: eligible,
    reserved,
    tentative: Math.min(figures.tentative, eligible - reserved),
    available_now: Math.min(figures.available_now, eligible),
    // Never enough ticked units for the ask: nothing coming back changes that.
    next_available: eligible < qty ? { date: null, status: "none" } : figures.next_available,
    demand: figures.demand,
  };
}
