import type { ReservationType } from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";
import { TYPE_LABEL } from "@/lib/reservations/status";

/**
 * The order-type filter, the second axis of Operate → Orders.
 *
 * Orders consolidates what v1 and early v2 split across three screens —
 * Reservations, Sales and Rent-to-own — because they were never three things.
 * `Reservation.reservationType` has carried RENTAL / SALE / RENT_TO_OWN / CLOUD
 * since v1; the screens were the only place the split existed. So this is a
 * filter, not a merge: one list, one record, one builder, and the type decides
 * which fields apply.
 *
 * Leases are deliberately NOT here. A `Lease` is money owed to a *lender* for
 * hardware the business bought — no client, no lines, no window — and folding
 * it in would make it a permanent special case in every column. It keeps its
 * own screen (owner's call, 2026-07-28, see lib/accounting/labels).
 *
 * Prisma-free at runtime so the filter strip, a client component, can import it
 * without dragging the pg driver into the browser bundle.
 */

export const TYPE_FILTERS = [
  "all",
  "rental",
  "sale",
  "rent-to-own",
  "cloud",
] as const;

export type TypeFilter = (typeof TYPE_FILTERS)[number];

export const isTypeFilter = oneOf(TYPE_FILTERS);

/** The enum member behind each filter; `all` has none, which is the point. */
const FILTER_TYPE: Record<Exclude<TypeFilter, "all">, ReservationType> = {
  rental: "RENTAL",
  sale: "SALE",
  "rent-to-own": "RENT_TO_OWN",
  cloud: "CLOUD",
};

export function typeForFilter(filter: TypeFilter): ReservationType | null {
  return filter === "all" ? null : FILTER_TYPE[filter];
}

/**
 * Labels come from `TYPE_LABEL`, not a second list — an order type must never
 * be called one thing in the filter and another in the row beside it.
 */
export const TYPE_FILTER_LABEL: Record<TypeFilter, string> = {
  all: "All types",
  rental: TYPE_LABEL.RENTAL,
  sale: TYPE_LABEL.SALE,
  "rent-to-own": TYPE_LABEL.RENT_TO_OWN,
  cloud: TYPE_LABEL.CLOUD,
};

/** Every type, in the order the strip and the revenue cards lay them out. */
export const ORDER_TYPES: ReservationType[] = [
  "RENTAL",
  "SALE",
  "RENT_TO_OWN",
  "CLOUD",
];
