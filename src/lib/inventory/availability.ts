import type { AssetStatus, CheckoutStatus } from "@/generated/prisma/client";

/**
 * What a unit's status means for booking. One definition, because "is this
 * bookable" gets asked by the order builder, the availability check, the
 * utilisation figure and the rail counts — and they have to agree, or the
 * platform will cheerfully promise a client something that is already gone.
 *
 * The rule the owner stated, 2026-07-30: **if it's out, it's not available.**
 * `Checkout` is the truth per order; `AssetUnit.status` is how inventory
 * reflects that, and the two must never contradict each other.
 *
 * Note the invariant is *not* "an open checkout means CHECKED_OUT". A sale
 * legitimately leaves an open checkout on a unit whose status is SOLD, and a
 * unit can be retired while still physically out. What must hold is the weaker,
 * truer statement: **a unit with an open checkout is not bookable.**
 */

/** Free to promise to a client. RESERVED is earmarked, so it isn't. */
export const BOOKABLE: AssetStatus[] = ["AVAILABLE"];

/** Countable as fleet — capacity that could earn. Excludes what's gone. */
export const IN_FLEET: AssetStatus[] = [
  "AVAILABLE",
  "CHECKED_OUT",
  "MAINTENANCE",
  "RESERVED",
];

/** Left the business. Never capacity, never bookable. */
export const OUT_OF_FLEET: AssetStatus[] = ["RETIRED", "SOLD"];

/**
 * Statuses that must not carry an open checkout. A unit here is being offered
 * to someone while it is already with someone else — the one failure this
 * check exists to prevent.
 */
export const MUST_NOT_BE_OUT: AssetStatus[] = ["AVAILABLE", "RESERVED"];

/**
 * What "still out" means on a `Checkout` row, as a reusable `where` fragment.
 *
 * A returned row is stamped with `actualReturn`, but a cancelled one never is —
 * so the date alone would count cancellations as custody forever. Both halves
 * are required. Named here rather than retyped per query because this is the
 * same "if it's out, it's not available" rule, asked of the movement log
 * instead of the unit.
 *
 * A plain object literal, not a `Prisma.CheckoutWhereInput`: keeping this module
 * free of value imports from the client is what lets client components import
 * from it. It is assignable to the Prisma type at every call site.
 */
export const OPEN_CHECKOUT: {
  actualReturn: null;
  status: { notIn: CheckoutStatus[] };
} = {
  actualReturn: null,
  status: { notIn: ["CANCELLED", "RETURNED"] },
};

export function isBookable(status: AssetStatus): boolean {
  return BOOKABLE.includes(status);
}

export function isInFleet(status: AssetStatus): boolean {
  return IN_FLEET.includes(status);
}
