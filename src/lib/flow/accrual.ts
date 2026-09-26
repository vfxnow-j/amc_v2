/**
 * What a Flow order has earned inside a window, from its schedule (v1 cb456d2).
 *
 * A Flow order's `total` is the whole contract, and its rate steps down after
 * each 12-month anniversary, so the recurring rule elsewhere (one `total` per
 * elapsed cycle) would overstate it by roughly the term. Instead each elapsed
 * term month accrues that month's scheduled rate.
 *
 * Month k starts k-1 months after the Flow start. A month counts when its start
 * falls inside [from, to) and on or before `effectiveEnd` (now, the recurrence
 * end, or completion, whichever is first). Nothing accrues past the term.
 *
 * Pure, so the rule can be checked on its own.
 */
import { addMonths } from 'date-fns'

export function flowAccrualInWindow(opts: {
  start: Date
  effectiveEnd: Date
  from: Date
  to: Date
  termMonths: number
  rateForMonth: (month: number) => number
}): number {
  const { start, effectiveEnd, from, to, termMonths, rateForMonth } = opts
  let sum = 0
  for (let month = 1; month <= termMonths; month++) {
    const d = addMonths(start, month - 1)
    if (d.getTime() > effectiveEnd.getTime() || d.getTime() >= to.getTime()) break
    if (d.getTime() >= from.getTime()) sum += rateForMonth(month)
  }
  return sum
}
