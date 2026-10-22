/**
 * Turning a sale price into a rental rate: what one unit cost us, recovered over
 * a number of months. Cost only — the margin is whatever the rental earns after
 * the gear has paid for itself, so none is added here (owner, 2026-10-21).
 * Rentals are always priced from a monthly rate; discounts start from there.
 */
/** The step a monthly rate is rounded to: finer for small rates, coarser for large ones. */
export function rateStep(rate: number): number {
  if (rate < 1000) return 25;
  if (rate < 5000) return 50;
  return 100;
}

/**
 * Cost over the recovery months, rounded UP to a clean flat rate (25 under
 * $1,000, 50 under $5,000, 100 above), so the gear never takes longer than the
 * period asked for to pay back and quotes show numbers like 125 or 750.
 */
export function monthlyFromCost(cost: number, months: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(months) || months <= 0) return null;
  const exact = cost / months;
  const step = rateStep(exact);
  return Math.ceil(Math.round(exact * 100) / 100 / step) * step;
}
