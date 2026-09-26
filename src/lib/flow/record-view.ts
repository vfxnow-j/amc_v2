/**
 * What the Flow cards on an order's record page show, derived from one priced
 * result — the terms, the month-by-month schedule, and the internal deal against
 * the gear's leases.
 *
 * The cards render these and nothing else, so every figure on them can be checked
 * here without a database or a browser. The priced result comes from
 * priceFlowLines() over flowInputsForOrder() — the same inputs the repricer
 * stores from — so what the record shows and what the order stores agree.
 *
 * Pure and client-safe: no prisma, no 'use server', no next/*.
 */
import type { FlowOrderResult } from '@/lib/pricing/flow-order'
import type { Assumption } from '@/lib/pricing/lease-funding'
import type { RenderedFlowTerms } from '@/lib/pricing/flow-terms'
import type { OrderFunding } from './funding'
import { addTermMonths } from './stored-money'

const CLOSED = ['COMPLETED', 'CANCELLED', 'LOST']

/**
 * Why a Flow order's terms (term, knobs, step, extension, line basis) can no
 * longer be edited — null while they can. The same rules the server enforces
 * (assertFlowTermsOpen, updateFlowExtensionPct), said to the person looking at
 * the disabled control.
 */
export function flowTermsLock(order: {
  status: string
  flowPeriodsBilled: number | null
  flowTermsSnapshot: unknown
}): string | null {
  if (CLOSED.includes(order.status)) return 'This order is closed, so its terms no longer change.'
  const billed = order.flowPeriodsBilled ?? 0
  if (billed > 0) {
    return `${billed} ${billed === 1 ? 'period has' : 'periods have'} been billed, so the terms are locked.`
  }
  if (order.flowTermsSnapshot != null) {
    return 'The client agreed to these terms — request a revision to change them.'
  }
  return null
}

export type FlowTermsView = {
  termMonths: number
  start: Date
  end: Date
  /** The month of the term the order is in: periods billed + 1, within the term. */
  currentMonth: number
  currentRate: number
  /** The next change of rate after the current month, if the schedule has one. */
  next: { month: number; rate: number; date: Date } | null
  /** Months after month 1 at which the rate changes. */
  stepMonths: number[]
  contractValue: number
  periodsBilled: number
  feasible: boolean
  /** The extension rate in force: the order's override, else the settings default. */
  extensionPct: number
  extensionIsDefault: boolean
  /** Extension per month, from the rendered terms — null when they could not render. */
  extensionMonthly: number | null
  /** What the month-13 step is set to, or null when the schedule follows recover-by. */
  stepPct: number | null
  /** What month 13 pays today as a % of month 1, when the term runs past a year. */
  impliedStepPct: number | null
}

export function flowTermsView(
  result: FlowOrderResult,
  input: {
    termMonths: number
    start: Date
    periodsBilled: number
    stepPct: number | null
    extensionPct: number | null
    defaultExtensionPct: number
    terms: RenderedFlowTerms | null
  },
): FlowTermsView {
  const { rows, steps } = result.schedule
  const T = input.termMonths
  const periodsBilled = Math.max(0, input.periodsBilled)
  const currentMonth = Math.min(Math.max(1, periodsBilled + 1), Math.max(1, T))
  const nextMonth = steps.find((m) => m > currentMonth)
  const next =
    nextMonth != null && rows[nextMonth - 1]
      ? { month: nextMonth, rate: rows[nextMonth - 1].rate, date: addTermMonths(input.start, nextMonth - 1) }
      : null
  const impliedStepPct =
    T > 12 && rows[0]?.rate > 0 && rows[12] ? Math.round((rows[12].rate / rows[0].rate) * 1000) / 10 : null

  return {
    termMonths: T,
    start: input.start,
    end: addTermMonths(input.start, T),
    currentMonth,
    currentRate: result.rateForMonth(currentMonth),
    next,
    stepMonths: steps.filter((m) => m > 1),
    contractValue: result.contractValue,
    periodsBilled,
    feasible: result.feasible,
    extensionPct: input.extensionPct ?? input.defaultExtensionPct,
    extensionIsDefault: input.extensionPct == null,
    extensionMonthly: input.terms ? input.terms.extension.monthly : null,
    stepPct: input.stepPct,
    impliedStepPct,
  }
}

export type FlowAgreementView = {
  version: number | null
  acceptedAt: Date | null
  signer: string | null
  autopayLabel: string
  autopaySetupAt: Date | null
  /** The amber to-do: approved, not closed, and nobody has set up the charge yet. */
  autopayTodo: boolean
}

const COMMITTED = ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE']

export function flowAgreementView(order: {
  status: string
  flowTermsVersion: number | null
  flowTermsSnapshot: unknown
  flowAutopayAuthorizedBy: string | null
  flowAutopayMethod: string | null
  flowAutopaySetupAt: Date | null
}): FlowAgreementView {
  const snap = order.flowTermsSnapshot as { acceptedAt?: string; version?: number } | null
  const acceptedAt = snap?.acceptedAt ? new Date(snap.acceptedAt) : null
  return {
    version: order.flowTermsVersion ?? snap?.version ?? null,
    acceptedAt: acceptedAt && !Number.isNaN(acceptedAt.getTime()) ? acceptedAt : null,
    signer: order.flowAutopayAuthorizedBy,
    autopayLabel: order.flowAutopayMethod
      ? `Authorized: ${order.flowAutopayMethod === 'ACH' ? 'bank (ACH)' : 'card'}`
      : 'No autopay authorization on file',
    autopaySetupAt: order.flowAutopaySetupAt,
    autopayTodo: order.flowAutopaySetupAt == null && COMMITTED.includes(order.status),
  }
}

export type FlowScheduleRowView = {
  month: number
  date: Date
  rate: number
  cumulative: number
  remaining: number
  /** The rate changes here (never month 1). */
  step: boolean
  billed: boolean
  current: boolean
}

/**
 * The schedule to show. An infeasible schedule has nothing billable in it — its
 * rows can be $0 months — so it yields no rows at all (v1 ffd0c77).
 */
export function flowScheduleRows(
  result: FlowOrderResult,
  start: Date,
  periodsBilled: number,
): { feasible: boolean; rows: FlowScheduleRowView[] } {
  if (!result.feasible) return { feasible: false, rows: [] }
  const current = periodsBilled + 1
  return {
    feasible: true,
    rows: result.schedule.rows.map((r) => ({
      month: r.month,
      date: addTermMonths(start, r.month - 1),
      rate: r.rate,
      cumulative: r.cumulative,
      remaining: r.remaining,
      step: r.isStep && r.month > 1,
      billed: r.month <= periodsBilled,
      current: r.month === current,
    })),
  }
}

export type FlowHardwareRow = {
  itemId: string
  name: string
  units: number
  /** What one unit cost us — the snapshotted true cost. Null when never costed. */
  trueCostEach: number | null
  trueCost: number
  leaseBalance: number
  leasePayment: number
  interestOverTerm: number
  leases: { label: string; assumed: boolean }[]
  assumed: boolean
}

export type FlowDealView = {
  contract: number
  hardware: number
  financeAllowance: number
  financeActual: number
  /** Allowance − actual: positive means the money cost less than we charged for it. */
  financeGap: number
  profit: number
  profitPerMonth: number
  marginOnContract: number
  notePayment: number
  monthOneNet: number
  thinnestNet: number
  /** The first month the thinnest net falls in. */
  thinnestMonth: number
  stillOwedAtTermEnd: number
  gearValueAtTermEnd: number
}

export type FlowEconomicsView = {
  hardware: FlowHardwareRow[]
  totals: { units: number; trueCost: number; leaseBalance: number; leasePayment: number; interestOverTerm: number }
  deal: FlowDealView
  /** "assumed 8% / 60 mo" — what a lease with no terms is priced as. */
  assumption: string
  assumedLines: number
  flooredLines: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function flowEconomicsView(
  lines: { itemId: string; name?: string | null; quantity: number; trueCost?: number | string | { toString(): string } | null; parentId?: string | null }[],
  funding: OrderFunding,
  result: FlowOrderResult,
  assumption: Assumption,
): FlowEconomicsView {
  const byItem = new Map(funding.lines.map((f) => [f.itemId, f]))
  const hardware: FlowHardwareRow[] = lines
    .filter((l) => !l.parentId)
    .map((l) => {
      const f = byItem.get(l.itemId)
      const each = l.trueCost == null || l.trueCost === '' ? null : Number(l.trueCost.toString())
      const trueCostEach = each != null && Number.isFinite(each) ? each : null
      const leases = (f?.leases ?? []).map((x) => ({ label: x.label, assumed: x.assumed }))
      return {
        itemId: l.itemId,
        name: l.name || 'Item',
        units: l.quantity,
        trueCostEach,
        trueCost: round2((trueCostEach ?? 0) * l.quantity),
        leaseBalance: f?.balance ?? 0,
        leasePayment: f?.payment ?? 0,
        interestOverTerm: f?.interestOverTerm ?? 0,
        leases,
        assumed: leases.some((x) => x.assumed),
      }
    })

  const sum = (pick: (r: FlowHardwareRow) => number) => round2(hardware.reduce((s, r) => s + pick(r), 0))
  const { economics: e, cash, tail } = result.quote
  const net = cash.netByMonth
  const thinnestIndex = net.length ? net.indexOf(Math.min(...net)) : 0

  return {
    hardware,
    totals: {
      units: hardware.reduce((s, r) => s + r.units, 0),
      trueCost: sum((r) => r.trueCost),
      leaseBalance: sum((r) => r.leaseBalance),
      leasePayment: sum((r) => r.leasePayment),
      interestOverTerm: sum((r) => r.interestOverTerm),
    },
    deal: {
      contract: e.contract,
      hardware: e.hardware,
      financeAllowance: e.financeAllowance,
      financeActual: e.financeActual,
      financeGap: e.financeGap,
      profit: e.profit,
      profitPerMonth: e.profitPerMonth,
      marginOnContract: e.marginOnContract,
      notePayment: cash.notePayment,
      monthOneNet: cash.firstYearNet,
      thinnestNet: cash.thinnestMonth,
      thinnestMonth: thinnestIndex + 1,
      stillOwedAtTermEnd: tail.balanceAtTermEnd,
      gearValueAtTermEnd: tail.gearValueAtTermEnd,
    },
    assumption: `assumed ${round2(assumption.aprPct)}% / ${assumption.noteMonths} mo`,
    assumedLines: hardware.filter((r) => r.assumed).length,
    flooredLines: result.flooredLines,
  }
}
