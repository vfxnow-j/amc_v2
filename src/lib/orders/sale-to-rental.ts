/**
 * Turning a sale price into a rental rate: what one unit cost us, recovered over
 * a number of months. Cost only — the margin is whatever the rental earns after
 * the gear has paid for itself, so none is added here (owner, 2026-10-21).
 * Rentals are always priced from a monthly rate; discounts start from there.
 */
export function monthlyFromCost(cost: number, months: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(months) || months <= 0) return null;
  return Math.round((cost / months) * 100) / 100;
}
