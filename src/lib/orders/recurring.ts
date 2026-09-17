/**
 * Whether an order recurs — decided by what it is and how it bills, never by a
 * separate switch.
 *
 * Owner, 2026-09-16: "it's a monthly anyways". A rental that bills monthly is a
 * recurring order: it stays out, bills every cycle, and has no return date to be
 * late for. The `isRecurring` column used to be set on its own, and nothing that
 * built an order set it — the builder never sent it, so every rental made in v2
 * came out a monthly order that did not recur — while v1's data holds 22 active
 * monthly rentals flagged non-recurring. Each of those read its first month's
 * end date as a return date and counted up: "170 days late" on gear that was
 * simply still on a running term.
 *
 * So the flag is derived, everywhere it is written:
 * - a sale never recurs: it has no term;
 * - a rent-to-own always does: it is financed in monthly installments;
 * - a rental or cloud order recurs whenever it bills on a cycle — anything but
 *   one time. One time is the fixed term, billed once, with a real end date.
 */
export function recurringFor(type: string, billingCycleType: string): boolean {
  if (type === "SALE") return false;
  if (type === "RENT_TO_OWN") return true;
  return billingCycleType !== "ONE_TIME";
}
