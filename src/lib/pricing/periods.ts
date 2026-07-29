/**
 * Term & billing-period math for reservations.
 *
 * This is the single source of truth for "how many periods does this order's date
 * range cover?" — server actions, dashboard tables, the reservation form, the public
 * quote page and every PDF all import from here. It deliberately has no server-only
 * imports so client components can call it directly and land on the exact same
 * numbers the server persisted.
 *
 * The order's term defines the revenue. An item's rate is quoted in its natural unit
 * (usually monthly, straight off the asset catalog), but a term that runs past a whole
 * number of periods is prorated rather than rounded down — so a 6-week rental of a
 * $400/mo item bills 1.36 months, not one flat month.
 *
 * Historically MONTHLY floored to whole calendar months (`differenceInMonths`) and
 * WEEKLY rounded up (`ceil`), which under-billed every term that didn't land on a
 * period boundary. See RES-2026-00089: Jul 27 – Sep 6 (6 weeks) billed as 1 month.
 *
 * Two invariants shape the implementation:
 *
 *  1. **Whole calendar months stay whole.** Prorating purely on day count (days ÷
 *     30.4375) would turn Jan 1 – Jun 30 into 5.95 months and a full year into 11.99,
 *     quietly under-billing every clean contract. So the month count is anchored on
 *     real calendar months and only the leftover days are prorated.
 *  2. **The answer is timezone-independent.** Reservation dates are date-only values
 *     stored at UTC midnight, but this runs on a UTC server, in the customer's browser
 *     and in the PDF renderer. All arithmetic is done on UTC calendar components so
 *     every one of them computes the same dollar figure.
 */

/**
 * Average calendar month — 365.25 / 12. Used only for the sub-month remainder, so a
 * leftover 11 days is worth the same whether it trails a February or a July.
 */
export const DAYS_PER_MONTH = 30.4375

export const DAYS_PER_WEEK = 7

const MS_PER_DAY = 86_400_000

/** Strip a date to its UTC calendar day, so local-time offsets can't shift the term. */
function utcDay(value: Date | string): number {
  const d = new Date(value)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Add months to a UTC day stamp, clamping short months (Jan 31 + 1 month = Feb 28). */
function addUtcMonths(dayStamp: number, months: number): number {
  const d = new Date(dayStamp)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(day, lastDayOfTarget))
}

/**
 * Whole days covered by the term. End date is inclusive — Jan 1 – Jan 31 is 31 days,
 * not 30 — so the exclusive boundary is end + 1.
 */
export function termDays(startDate: Date | string, endDate: Date | string): number {
  const days = (utcDay(endDate) - utcDay(startDate)) / MS_PER_DAY + 1
  return Math.max(1, days)
}

/**
 * Months covered, anchored on whole calendar months with the remainder prorated.
 * Jul 27 – Sep 6 is one full month (Jul 27 → Aug 27) plus 11 days = 1.36 months.
 */
function splitTermMonths(
  startDate: Date | string,
  endDate: Date | string
): { wholeMonths: number; remainderDays: number } {
  const start = utcDay(startDate)
  // Exclusive boundary — the term runs through the end of the end date
  const exclusiveEnd = utcDay(endDate) + MS_PER_DAY
  if (exclusiveEnd <= start) return { wholeMonths: 0, remainderDays: 0 }

  const s = new Date(start)
  const e = new Date(exclusiveEnd)
  let whole = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
  if (addUtcMonths(start, whole) > exclusiveEnd) whole -= 1
  if (whole < 0) whole = 0

  return {
    wholeMonths: whole,
    remainderDays: (exclusiveEnd - addUtcMonths(start, whole)) / MS_PER_DAY,
  }
}

function termMonths(startDate: Date | string, endDate: Date | string): number {
  const { wholeMonths, remainderDays } = splitTermMonths(startDate, endDate)
  return wholeMonths + remainderDays / DAYS_PER_MONTH
}

/**
 * How many billing periods of `pricingType` the term covers. May be fractional.
 *
 * Floored at 1: one period is the minimum charge, so a 2-week order of a monthly-rate
 * item still bills one month. Only terms that run *past* one period are prorated.
 */
export function calculatePeriods(
  startDate: Date | string,
  endDate: Date | string,
  pricingType: string,
  isRecurring?: boolean
): number {
  // Recurring orders bill per cycle — subtotal shows one cycle's worth
  if (isRecurring) return 1

  const days = termDays(startDate, endDate)

  switch (pricingType) {
    case 'HOURLY':
      return Math.max(1, days * 24)
    case 'DAILY':
      return Math.max(1, days)
    case 'WEEKLY':
      return Math.max(1, days / DAYS_PER_WEEK)
    case 'MONTHLY':
      return Math.max(1, termMonths(startDate, endDate))
    case 'PROJECT':
    case 'CUSTOM':
    default:
      return 1
  }
}

/** Round to cents. Fractional periods produce fractional cents, so every money value derived from them goes through this. */
export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

/** Line subtotal for an item: rate × qty × periods, rounded to cents. */
export function computeItemSubtotal(rate: number, quantity: number, periods: number): number {
  return roundMoney(rate * (quantity || 1) * periods)
}

/** What one unit costs across the whole term (rate × periods), rounded to cents. */
export function termTotalPerUnit(rate: number, periods: number): number {
  return roundMoney(rate * periods)
}

/** Singular unit noun for a pricing type — 'month', 'week'… Empty for flat-fee types. */
export function periodUnitLabel(pricingType: string): string {
  switch (pricingType) {
    case 'HOURLY': return 'hour'
    case 'DAILY': return 'day'
    case 'WEEKLY': return 'week'
    case 'MONTHLY': return 'month'
    default: return ''
  }
}

/** Abbreviated unit used in tight rate cells — '/mo', '/wk'. */
export function periodUnitAbbrev(pricingType: string): string {
  switch (pricingType) {
    case 'HOURLY': return 'hr'
    case 'DAILY': return 'day'
    case 'WEEKLY': return 'wk'
    case 'MONTHLY': return 'mo'
    default: return ''
  }
}

/** Trim a fractional period count for display: 1.3613958 → '1.36', 3 → '3'. */
export function formatPeriodCount(periods: number): string {
  const rounded = Math.round(periods * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

/** True when the term is (near enough) exactly one period — no multiplier worth showing. */
export function isSinglePeriod(periods: number): boolean {
  return Math.abs(periods - 1) < 0.005
}

/**
 * Human description of the term itself, independent of any item's pricing unit —
 * '6 weeks', '3 months', '10 days'. This is what makes a 42-day order read as
 * "6 weeks" rather than "1 month".
 */
export function formatTermLength(startDate: Date | string, endDate: Date | string): string {
  const days = termDays(startDate, endDate)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

  if (days < DAYS_PER_WEEK) return plural(days, 'day')

  // Whole calendar months (Jan 1 – Jun 30 is exactly 6) read better than "26 weeks"
  const { wholeMonths, remainderDays } = splitTermMonths(startDate, endDate)
  if (wholeMonths >= 1 && remainderDays === 0) return plural(wholeMonths, 'month')

  if (days % DAYS_PER_WEEK === 0) return plural(days / DAYS_PER_WEEK, 'week')

  // Odd terms past a month: state it exactly ("3 months, 8 days") rather than
  // rounding to a decimal the client would have to reverse-engineer.
  if (wholeMonths >= 1) return `${plural(wholeMonths, 'month')}, ${plural(remainderDays, 'day')}`

  return plural(days, 'day')
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * The rate line shown under a line item's amount on orders, quotes and PDFs:
 *   '$400.00/mo → $544.56 for 6 weeks'
 * collapsing to a plain '$400.00/mo' when the term is exactly one period.
 *
 * Returns '' for one-time / project / custom charges, which aren't term-multiplied —
 * their rate is already the amount shown, so a sub-line would just repeat it.
 */
export function formatRateWithTerm(params: {
  rate: number
  pricingType: string
  periods: number
  termLabel?: string
  isOneTime?: boolean
  /** Defaults to plain USD — pass the caller's own formatter to match its locale/currency. */
  formatMoney?: (value: number) => string
}): string {
  const { rate, pricingType, periods, termLabel, isOneTime, formatMoney = formatUSD } = params
  const abbrev = periodUnitAbbrev(pricingType)

  if (isOneTime || !abbrev) return ''

  const base = `${formatMoney(rate)}/${abbrev}`
  if (isSinglePeriod(periods)) return base

  const forLabel = termLabel || `${formatPeriodCount(periods)} ${periodUnitLabel(pricingType)}s`
  return `${base} → ${formatMoney(termTotalPerUnit(rate, periods))} for ${forLabel}`
}

/**
 * Convenience wrapper over `formatRateWithTerm` for document builders that hold a
 * reservation item and its parent order rather than a pre-computed period count.
 * Returns undefined (not '') so it drops cleanly out of optional PDF data fields.
 */
export function formatTermNote(
  item: { rate: unknown; pricingType: string; isOneTime?: boolean },
  order: { startDate: Date | string; endDate: Date | string; isRecurring?: boolean },
  formatMoney?: (value: number) => string
): string | undefined {
  const periods = item.isOneTime
    ? 1
    : calculatePeriods(order.startDate, order.endDate, item.pricingType, order.isRecurring)
  const note = formatRateWithTerm({
    rate: Number(item.rate) || 0,
    pricingType: item.pricingType,
    periods,
    termLabel: order.isRecurring ? undefined : formatTermLength(order.startDate, order.endDate),
    isOneTime: item.isOneTime,
    formatMoney,
  })
  // A bare "$400.00/mo" repeats the Rate column — only the derivation is worth printing.
  return note && !isSinglePeriod(periods) ? note : undefined
}
