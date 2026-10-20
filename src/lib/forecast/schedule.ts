/**
 * When an order bills, month by month — the arithmetic under Accounting → Forecast.
 *
 * Every figure is ex-tax: sales tax is collected for the state, not earned, so
 * it is in neither revenue nor cash. Each charge lands in the month it is
 * billed (revenue) and the month its payment terms make it due (cash).
 *
 * Recurring rentals and cloud price stretch by stretch through cycleInvoice(),
 * the same function the quote's monthly payment and the billing run use — so a
 * month here is what the client is invoiced that month: the prorated first stub
 * with delivery on it, the discount, the term's prorated end. Rent-to-own bills
 * its installment; Flow bills its schedule's rate for each term month (it steps
 * down at anniversaries). Everything else bills its total once, on its date.
 *
 * Pure — no prisma, no next.
 */
import {
  addDays, anchorAfter, billedPeriods, calendarDay, daysBetween, intendedDay, isAnchoredCycle, type BillingAnchor,
} from '@/lib/billing/calendar'
import { MINIMUM_DAYS } from '@/lib/billing/earned'
import { cycleInvoice, type CycleLine, type CycleTerms } from '@/lib/billing/cycle-invoice'
import { termEnd } from '@/lib/billing/payment-schedule'
import { addTermMonths } from '@/lib/flow/stored-money'
import { roundMoney } from '@/lib/pricing/periods'

/** 'YYYY-MM' */
export type MonthKey = string

export function monthKey(day: Date): MonthKey {
  const d = intendedDay(day)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The first of the month `day` falls in, `offset` months on. */
export function monthStart(day: Date, offset = 0): Date {
  const d = intendedDay(day)
  return calendarDay(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)
}

/** `count` consecutive month keys starting with the month `from` falls in. */
export function monthKeys(from: Date, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => monthKey(monthStart(from, i)))
}

/**
 * The first of the month a bill is paid in. Terms count in 30-day months from
 * the billing day, so a bill on the 1st at net 30 is next month's cash every
 * month — adding raw days would land it on the 31st in some months and the 1st
 * in others, and the cash row would swing by a whole month's billing.
 */
export function dueMonth(billed: Date, termsDays: number): Date {
  const d = intendedDay(billed)
  const later = Math.floor((d.getUTCDate() - 1 + Math.max(0, termsDays)) / 30)
  return calendarDay(d.getUTCFullYear(), d.getUTCMonth() + later, 1)
}

export type Charge = {
  /** The day it is invoiced. */
  billed: Date
  /** The first of the month it is paid in, by the order's payment terms (see dueMonth). */
  due: Date
  /** Ex-tax. */
  amount: number
}

export type ScheduleOrder = {
  type: string
  isRecurring: boolean
  cycle: string
  /** Days, for CUSTOM cycles. */
  cycleDays: number | null
  start: Date
  termMonths: number | null
  recurrenceEnd: Date | null
  /** The day billing stops (exclusive) — when the gear is due back. Null: it rolls. */
  plannedEnd?: Date | null
  /** total − tax: what a once-billed order is worth ex-tax. */
  netTotal: number
  /** The order's tax as a share of its total, for stripping tax off stored installments. */
  taxShare: number
  rto: { months: number | null; payment: number | null; start: Date | null }
  flow: { months: number; start: Date; rateForMonth: (month: number) => number } | null
}

const DAY_CYCLES: Record<string, number> = { DAILY: 1, BI_WEEKLY: 14 }

/**
 * Every charge the order raises with a billing date in [from, to). A recurring
 * rental bills until its planned end (its term, its recurrence end, or when the
 * gear is due back), the last stretch prorated with a week's minimum and the
 * whole rental never under one period — as lib/billing/earned.ts counts it.
 * With no planned end it rolls to `to`. `termsDays` turns each billing date
 * into a due date.
 */
export function orderCharges(input: {
  order: ScheduleOrder
  lines: CycleLine[]
  terms: CycleTerms
  anchor: BillingAnchor
  from: Date
  to: Date
  termsDays: number
}): Charge[] {
  const { order, from, to } = input
  const out: Charge[] = []
  const push = (billed: Date, amount: number) => {
    if (billed.getTime() < from.getTime() || billed.getTime() >= to.getTime()) return
    const a = roundMoney(amount)
    if (Math.abs(a) < 0.005) return
    out.push({ billed, due: dueMonth(billed, input.termsDays), amount: a })
  }

  if (order.type === 'FLOW' && order.flow) {
    const { months, start, rateForMonth } = order.flow
    for (let m = 1; m <= months; m++) push(intendedDay(addTermMonths(start, m - 1)), rateForMonth(m))
    return out
  }

  if (order.type === 'RENT_TO_OWN') {
    const months = order.rto.months
    if (!months || months <= 0) {
      push(intendedDay(order.start), order.netTotal)
      return out
    }
    const start = order.rto.start ?? order.start
    const installment = order.rto.payment != null
      ? order.rto.payment * (1 - order.taxShare)
      : order.netTotal / months
    for (let m = 1; m <= months; m++) push(intendedDay(addTermMonths(start, m - 1)), installment)
    return out
  }

  const recurring = order.isRecurring && (order.type === 'RENTAL' || order.type === 'CLOUD')
  if (!recurring) {
    push(intendedDay(order.start), order.netTotal)
    return out
  }

  // Where billing stops (exclusive): the committed term, the recurrence end or
  // the planned return, whichever is first. None of them = it rolls to the end
  // of the window, billing whole periods.
  const start = intendedDay(order.start)
  const stops: number[] = []
  if (order.termMonths && order.termMonths > 0) stops.push(termEnd(start, order.termMonths).getTime())
  if (order.recurrenceEnd) stops.push(addDays(intendedDay(order.recurrenceEnd), 1).getTime())
  if (order.plannedEnd) stops.push(order.plannedEnd.getTime())
  const hardEnd = stops.length ? new Date(Math.max(Math.min(...stops), addDays(start, 1).getTime())) : null
  const end = hardEnd && hardEnd.getTime() < to.getTime() ? hardEnd : to
  const price = (share: number, first: boolean) => {
    const inv = cycleInvoice({ lines: input.lines, share, first, terms: input.terms })
    return inv.taxable + inv.oneTimeCharges
  }

  const cycle = order.cycle
  const stretches: { s: Date; share: number }[] = []
  if (isAnchoredCycle(cycle)) {
    let s = start
    for (let i = 0; i < 3000 && s.getTime() < end.getTime(); i++) {
      const next = anchorAfter(s, cycle, input.anchor)
      const e = hardEnd && next.getTime() > hardEnd.getTime() ? hardEnd : next
      let share = billedPeriods(s, e, cycle, input.anchor)
      // A return mid-period is prorated to the day, never under a week (lib/billing/earned.ts).
      if (hardEnd && e === hardEnd && i > 0) {
        const periodDays = daysBetween(s, next)
        if (periodDays > 0) share = Math.max(share, Math.min(MINIMUM_DAYS, periodDays) / periodDays)
      }
      stretches.push({ s, share })
      s = next
    }
  } else {
    // DAILY, BI_WEEKLY, CUSTOM: a whole cycle every N days from the start.
    const step = DAY_CYCLES[cycle] ?? Math.max(1, order.cycleDays || 30)
    let s = start
    for (let i = 0; i < 3000 && s.getTime() < end.getTime(); i++) {
      stretches.push({ s, share: 1 })
      s = addDays(s, step)
    }
  }
  // A rental is invoiced at least one whole period, however short (owner, 2026-09-17).
  if (hardEnd && hardEnd.getTime() <= to.getTime() && stretches.length) {
    const total = stretches.reduce((sum, x) => sum + x.share, 0)
    if (total < 1) stretches[0].share += 1 - total
  }
  stretches.forEach((x, i) => push(x.s, price(x.share, i === 0)))
  return out
}
