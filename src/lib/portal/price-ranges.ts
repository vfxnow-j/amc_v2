/**
 * The public price band: what the public site and the catalog may say about price
 * without saying the price.
 *
 * Rule (decision 7): a band is at least ±10% around its midpoint (so min = max is
 * widened by 10% each way), then rounded OUTWARD to $25 — strictly outward: the low
 * end is always below the cheapest real price and the high end always above the
 * dearest, so neither end can ever be an exact price, even when a price happens to
 * be a multiple of $25. The low end never goes below $0.
 *
 * Pure.
 *
 * TODO(owner decision: band coarseness) — the ±10% floor and the $25 step are
 * provisional; the owner has been asked how coarse a public band should be. Do not
 * change them until that answer lands.
 */

export const RANGE_STEP = 25
export const RANGE_MIN_BAND_PCT = 10

export type PriceRange = { low: number; high: number }

/** The band over a set of real prices, or null when there is none to describe. */
export function publicRange(prices: number[]): PriceRange | null {
  const real = prices.filter((p) => Number.isFinite(p) && p > 0)
  if (!real.length) return null
  const min = Math.min(...real)
  const max = Math.max(...real)
  const mid = (min + max) / 2
  const half = Math.max((max - min) / 2, (mid * RANGE_MIN_BAND_PCT) / 100)
  const lowRaw = Math.min(min, mid - half)
  const highRaw = Math.max(max, mid + half)
  // Strictly outward: a raw end that already sits on a $25 step moves one step out.
  let low = Math.floor(lowRaw / RANGE_STEP) * RANGE_STEP
  if (low >= min) low -= RANGE_STEP
  let high = Math.ceil(highRaw / RANGE_STEP) * RANGE_STEP
  if (high <= max) high += RANGE_STEP
  return { low: Math.max(0, low), high }
}
