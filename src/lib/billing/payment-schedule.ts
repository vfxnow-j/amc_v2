/**
 * What a recurring rental costs the client each cycle, over its committed term.
 *
 * v1 (a0cd5ff, 2026-09-25) added this behind a `billsFromSchedule` flag,
 * because v1 billed a fixed-term rental once for the whole term. v2 already
 * treats every rental that bills on a cycle as recurring and keeps the
 * committed term in `termMonths`, so no flag: the schedule is the anchored
 * calendar (a prorated first stub, whole periods, a prorated last stretch)
 * priced stretch by stretch through cycleInvoice(), which is also what the
 * billing run invoices. Pure.
 */
import {
  addDays, anchorAfter, billedPeriods, calendarDay, intendedDay, isAnchoredCycle, stretchLabel,
  type BillingAnchor,
} from './calendar'
import { cycleInvoice, type CycleLine, type CycleTerms } from './cycle-invoice'
import { roundMoney } from '@/lib/pricing/periods'

export type ScheduleRow = { start: Date; end: Date; share: number; total: number }

export type PaymentSchedule = {
  cycle: 'MONTHLY' | 'WEEKLY'
  /** One whole period, after discount: what the client pays each cycle. */
  regular: { subtotal: number; tax: number; total: number }
  months: number | null
  rows: ScheduleRow[] | null
  /** The first invoice, when it differs from a regular one (a stub, delivery, a fixed discount). */
  first: ScheduleRow | null
  /** A prorated last stretch, when the term doesn't end on an anchor. */
  final: ScheduleRow | null
  termTotal: number | null
}

/** Where a term of `termMonths` ends, exclusive: the same day N months on, clamped to the month's end. */
export function termEnd(start: Date, termMonths: number): Date {
  const d = intendedDay(start)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + termMonths
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return calendarDay(y, m, Math.min(d.getUTCDate(), last))
}

export function paymentSchedule(input: {
  type: string
  isRecurring: boolean
  cycle: string
  start: Date
  termMonths: number | null
  anchor: BillingAnchor
  lines: CycleLine[]
  terms: CycleTerms
}): PaymentSchedule | null {
  if (input.type !== 'RENTAL' && input.type !== 'CLOUD') return null
  if (!input.isRecurring || !isAnchoredCycle(input.cycle)) return null
  const cycle = input.cycle

  const whole = cycleInvoice({ lines: input.lines, share: 1, first: false, terms: input.terms })
  const regular = { subtotal: whole.taxable, tax: whole.taxAmount, total: whole.total }
  const rowFor = (s: Date, e: Date, isFirst: boolean): ScheduleRow => {
    const share = billedPeriods(s, e, cycle, input.anchor)
    const inv = cycleInvoice({ lines: input.lines, share, first: isFirst, terms: input.terms })
    return { start: s, end: addDays(e, -1), share, total: inv.total }
  }
  const differs = (r: ScheduleRow) => Math.abs(r.total - regular.total) >= 0.005

  const start = intendedDay(input.start)
  const months = input.termMonths && input.termMonths > 0 ? input.termMonths : null
  if (!months) {
    const first = rowFor(start, anchorAfter(start, cycle, input.anchor), true)
    return { cycle, regular, months: null, rows: null, first: differs(first) ? first : null, final: null, termTotal: null }
  }

  const end = termEnd(start, months)
  const rows: ScheduleRow[] = []
  let s = start
  for (let guard = 0; guard < 2000 && s.getTime() < end.getTime(); guard++) {
    const next = anchorAfter(s, cycle, input.anchor)
    const e = next.getTime() < end.getTime() ? next : end
    rows.push(rowFor(s, e, rows.length === 0))
    s = e
  }
  const last = rows.length > 1 ? rows[rows.length - 1] : null
  return {
    cycle,
    regular,
    months,
    rows,
    first: rows[0] && differs(rows[0]) ? rows[0] : null,
    final: last && differs(last) ? last : null,
    termTotal: roundMoney(rows.reduce((sum, r) => sum + r.total, 0)),
  }
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const usd = (n: number) => USD.format(n)

export type PaymentLine = { headline: string; notes: string[] }

/** The sentence every surface prints: order page, quote PDF, online quote. */
export function paymentLine(s: PaymentSchedule): PaymentLine {
  const unit = s.cycle === 'MONTHLY' ? 'month' : 'week'
  const label = s.cycle === 'MONTHLY' ? 'Monthly' : 'Weekly'
  const amount = s.regular.tax > 0
    ? `${usd(s.regular.subtotal)} + tax = ${usd(s.regular.total)}`
    : usd(s.regular.total)
  let headline = `${label} payment: ${amount}`
  if (s.months && s.termTotal !== null) {
    headline += s.cycle === 'MONTHLY'
      ? ` × ${s.months} ${s.months === 1 ? 'month' : 'months'} · Term total ${usd(s.termTotal)}`
      : ` · ${s.months}-month term · Term total ${usd(s.termTotal)}`
  } else {
    headline += `, billed each ${unit} until cancelled`
  }
  const notes: string[] = []
  if (s.first) notes.push(`First invoice (${stretchLabel(s.first.start, s.first.end)}): ${usd(s.first.total)}`)
  if (s.final) notes.push(`Final invoice (${stretchLabel(s.final.start, s.final.end)}): ${usd(s.final.total)}`)
  return { headline, notes }
}
