import { prisma } from '@/lib/prisma'
import { addDays, addMonths } from 'date-fns'
import { flowConfigFromSettings, priceFlowLines } from '@/lib/pricing/flow-lines'
import { applyFlowDefaults } from '@/lib/flow/defaults'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'
import { flowAccrualInWindow } from '@/lib/flow/accrual'

/**
 * Earned (accrual-basis) revenue for a time window.
 *
 * "Revenue" here is what the business has ECONOMICALLY EARNED, independent of
 * whether an invoice was generated or sent — because recurring billing can
 * stall and invoices sit in DRAFT, an invoice-based figure badly understates
 * reality. It has three components:
 *
 *  - nonRecurringRental: realized checkout charges (rate × periods) for
 *    one-off rentals, attributed to the checkout date.
 *  - recurring: for recurring orders, ONE cycle amount accrues per elapsed
 *    billing period. A monthly order active 6 months has earned 6× its cycle
 *    amount even if only one invoice was ever cut.
 *  - sales: completed SALE orders, recognized at completion.
 *
 * FLOW is recurring too, but its `total` is the WHOLE contract and its rate steps
 * at each anniversary, so it accrues the schedule's rate for each elapsed month of
 * the term (lib/flow/accrual, v1 cb456d2) rather than total × cycles. The
 * schedule is rebuilt from the stored lines and the order's pricing knobs (blank
 * ones filled from the house defaults, as the order page does). It depends on
 * neither the lease funding nor the gear's age, so those are not loaded.
 */
export type ReservationTypeKey = 'RENTAL' | 'SALE' | 'RENT_TO_OWN' | 'FLOW' | 'CLOUD'

type FlowLine = Parameters<typeof priceFlowLines>[0][number]

export type EarnedRevenueBreakdown = {
  total: number
  recurring: number
  nonRecurringRental: number
  sales: number
  /** Earned revenue attributed to each reservation type. */
  byType: Record<ReservationTypeKey, number>
}

// Count recurring billing periods whose period-start date falls inside
// [from, to) and within the order's active life. Each counted period = one
// accrued cycle amount. Period starts are generated from the order start date,
// stepping by the cycle length (so month vs YTD windows both work naturally).
function cyclesInWindow(opts: {
  start: Date
  effectiveEnd: Date
  from: Date
  to: Date
  cycle: string
  customDays?: number | null
}): number {
  const { start, effectiveEnd, from, to, cycle, customDays } = opts
  let count = 0
  let d = new Date(start)
  // Safety cap — no real order has 600+ elapsed cycles; prevents runaway loops.
  for (let i = 0; i < 600; i++) {
    if (d.getTime() > effectiveEnd.getTime() || d.getTime() >= to.getTime()) break
    if (d.getTime() >= from.getTime()) count++
    if (cycle === 'WEEKLY') d = addDays(d, 7)
    else if (cycle === 'CUSTOM') d = addDays(d, Math.max(1, customDays || 30))
    else d = addMonths(d, 1) // MONTHLY (and any monthly-like default)
  }
  return count
}

export async function getEarnedRevenue(from: Date, to: Date): Promise<EarnedRevenueBreakdown> {
  const now = new Date()

  const [nonRecurCheckouts, recurringOrders, salesAgg] = await Promise.all([
    // Non-recurring rentals: realized checkout charges in the window, carrying
    // the order type so we can attribute per type. Sale checkouts carry no
    // charge, so they never double-count against `sales`.
    prisma.checkout.findMany({
      where: {
        status: { in: ['ACTIVE', 'OVERDUE', 'RETURNED'] },
        checkoutDate: { gte: from, lt: to },
        OR: [{ reservation: { is: { isRecurring: false } } }, { reservationId: null }],
      },
      select: { totalCharge: true, reservation: { select: { reservationType: true } } },
    }),
    // Recurring orders — accrue per elapsed cycle within the window.
    prisma.reservation.findMany({
      where: {
        isRecurring: true,
        status: { in: ['ACTIVE', 'COMPLETED'] },
        notBilled: false,
      },
      select: {
        id: true,
        total: true,
        reservationType: true,
        billingCycleType: true,
        billingCycleDays: true,
        startDate: true,
        recurrenceEndDate: true,
        completedAt: true,
        status: true,
        // Flow only — the schedule is rebuilt from these and the lines.
        flowStartDate: true,
        flowMonthlyPayment: true,
        flowTermMonths: true,
        flowStepPct: true,
        flowMarginPct: true,
        flowFinancePct: true,
        flowPurchaseTaxPct: true,
        flowTaxExempt: true,
        flowRecoverByMonth: true,
        flowDeprPct: true,
        flowLifeMonths: true,
        flowPeriodsBilled: true,
      },
    }),
    // Sales recognized at completion.
    prisma.reservation.aggregate({
      where: {
        reservationType: 'SALE',
        status: 'COMPLETED',
        completedAt: { gte: from, lt: to },
      },
      _sum: { total: true },
    }),
  ])

  const byType: Record<ReservationTypeKey, number> = { RENTAL: 0, SALE: 0, RENT_TO_OWN: 0, FLOW: 0, CLOUD: 0 }
  const addType = (type: string | undefined | null, amount: number) => {
    const key = (type ?? 'RENTAL') as ReservationTypeKey
    byType[key] = (byType[key] ?? 0) + amount
  }

  let nonRecurringRental = 0
  for (const c of nonRecurCheckouts) {
    const charge = c.totalCharge != null ? Number(c.totalCharge) : 0
    if (charge === 0) continue
    nonRecurringRental += charge
    addType(c.reservation?.reservationType, charge)
  }

  const sales = Number(salesAgg._sum.total ?? 0)
  addType('SALE', sales)

  // Flow lines (active package only — the one the stored totals are priced off),
  // and the house defaults their blank knobs fall back to.
  const flowIds = recurringOrders.filter((r) => r.reservationType === 'FLOW').map((r) => r.id)
  const flowLinesByOrder = new Map<string, FlowLine[]>()
  const flowDefaults = flowIds.length ? await loadFlowDefaults(prisma) : null
  if (flowIds.length) {
    const flowItems = await prisma.reservationItem.findMany({
      where: {
        reservationId: { in: flowIds },
        parentId: null,
        OR: [{ packageId: null }, { package: { is: { isActive: true } } }],
      },
      select: { reservationId: true, description: true, costBasis: true, trueCost: true, quantity: true, flowAddedAtMonth: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    for (const i of flowItems) {
      const list = flowLinesByOrder.get(i.reservationId) || []
      list.push({ name: i.description, costBasis: i.costBasis, trueCost: i.trueCost, quantity: i.quantity, addedAtMonth: i.flowAddedAtMonth })
      flowLinesByOrder.set(i.reservationId, list)
    }
  }

  let recurring = 0
  for (const r of recurringOrders) {
    // For recurring orders, `endDate` is only the FIRST period's end — the
    // recurrence runs until recurrenceEndDate (if set), completion, or now.
    // Never cap at endDate or accrual collapses to a single cycle.
    const candidates = [now.getTime()]
    if (r.recurrenceEndDate) candidates.push(new Date(r.recurrenceEndDate).getTime())
    if (r.status === 'COMPLETED' && r.completedAt) candidates.push(new Date(r.completedAt).getTime())
    const effectiveEnd = new Date(Math.min(...candidates))

    if (r.reservationType === 'FLOW') {
      const config = flowDefaults ? flowConfigFromSettings(applyFlowDefaults(r, flowDefaults)) : null
      const start = new Date(r.flowStartDate ?? r.startDate)
      let amount = 0
      if (config) {
        const priced = priceFlowLines(flowLinesByOrder.get(r.id) || [], config)
        // A stored Flow order is always priceable (the server refuses to save one
        // that is not); if it somehow is not, fall back to the stored payment.
        const rateForMonth = priced.ok
          ? priced.result.rateForMonth
          : () => Number(r.flowMonthlyPayment ?? 0)
        amount = flowAccrualInWindow({ start, effectiveEnd, from, to, termMonths: config.termMonths, rateForMonth })
      }
      recurring += amount
      addType(r.reservationType, amount)
      continue
    }

    const cycles = cyclesInWindow({
      start: new Date(r.startDate),
      effectiveEnd,
      from,
      to,
      cycle: r.billingCycleType,
      customDays: r.billingCycleDays,
    })
    const amount = Number(r.total) * cycles
    recurring += amount
    addType(r.reservationType, amount)
  }

  const round = (n: number) => Math.round(n * 100) / 100
  return {
    recurring: round(recurring),
    nonRecurringRental: round(nonRecurringRental),
    sales: round(sales),
    total: round(recurring + nonRecurringRental + sales),
    byType: {
      RENTAL: round(byType.RENTAL),
      SALE: round(byType.SALE),
      RENT_TO_OWN: round(byType.RENT_TO_OWN),
      FLOW: round(byType.FLOW),
      CLOUD: round(byType.CLOUD),
    },
  }
}
