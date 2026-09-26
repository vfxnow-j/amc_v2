/**
 * One call that prices a Flow order.
 *
 * `quote()` and `buildFlowSchedule()` must see identical items and identical config
 * or an order gets quoted one way and invoiced another — the exact failure
 * ./financials.ts exists to prevent, and one the engine's own review flagged because
 * nothing linked the two calls. Everything that needs both goes through here, so
 * there is one item list and no way for them to drift.
 *
 * Client-safe: no server-only imports.
 */
import {
  quote,
  buildFlowSchedule,
  CONFIG_DEFAULTS,
  type FlowItem,
  type FlowQuote,
  type FlowOrderSchedule,
} from './flow'

export type FlowOrderLine = {
  id?: string
  name?: string
  /** Per-unit pricing basis. Landed cost by default, editable by sales. */
  costBasis: number
  /** Per-unit true cost, snapshotted when the line was added. Defaults to the basis. */
  trueCost?: number | null
  quantity: number
  /** Month of the term this line was co-termed in. Null means from the start. */
  addedAtMonth?: number | null
}

export type FlowOrderConfig = {
  termMonths: number
  marginPct: number
  financePct: number
  /** Tax we would pay buying the gear. NOT the client's sales tax. */
  purchaseTaxPct: number
  taxExempt: boolean
  recoverByMonth: number
  /** From month 13, pay this % of the year-one payment. Null = recoverByMonth shape. */
  stepPct?: number | null
  deprPct: number
  lifeMonths: number
  /** Averaged age of the gear in months, for residual. */
  monthsInService?: number
  /** The note against the gear, when any unit is financed. Null for cash-owned. */
  funding?: { aprPct: number; balance: number; monthsLeft: number } | null
  /** Which month of the term the order is in. Defaults to 1. */
  currentMonth?: number
}

export type FlowOrderResult = {
  quote: FlowQuote
  schedule: FlowOrderSchedule
  /** The rate for a given month — the single number billing reads. */
  rateForMonth: (month: number) => number
  /** The rate for the month the order is currently in. */
  monthlyNow: number
  /** Total payable across the term. */
  contractValue: number
  /** Lines whose basis was floored up to their true cost. */
  flooredLines: number
  /** False when the schedule must not be shown to a client or invoiced. */
  feasible: boolean
}

/**
 * Flow's starting position: cost, +10% to carry the money, +40% mark-up — so a term
 * bills 1.5× what the gear cost. Overridable per order.
 */
export const FLOW_CONFIG_DEFAULTS: FlowOrderConfig = {
  termMonths: 24,
  marginPct: 40,
  financePct: 10,
  purchaseTaxPct: 9.75,
  taxExempt: true,
  recoverByMonth: CONFIG_DEFAULTS.recoverByMonth,
  deprPct: 30,
  lifeMonths: 60,
  monthsInService: 0,
  funding: null,
  currentMonth: 1,
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function flowOrder(lines: FlowOrderLine[], config: FlowOrderConfig): FlowOrderResult {
  let flooredLines = 0

  // The basis may never sit below what the gear cost us. An audit found 34 catalog
  // assets whose old basis was under cost — and since recovery targets the basis,
  // those orders would have recovered half their capital and never got it back.
  const items: FlowItem[] = (lines || []).map((l) => {
    // trueCost is historical spend — purchasePrice + landedCostAdjustment (see
    // prisma/schema.prisma), which already has tax actually paid baked in. It is
    // passed through to the engine untaxed on purpose: the engine's taxPct/exempt
    // model taxes a HYPOTHETICAL new purchase, and applying that to money already
    // spent would double-count tax and overstate what the gear cost us. That is
    // also why, when trueCost is absent, defaulting it to costBasis does not track
    // the engine's own `i.trueCost == null -> trueCapital = landed` fallback once
    // taxExempt is false — landed is taxed, this deliberately is not.
    const trueCost = l.trueCost == null ? num(l.costBasis) : num(l.trueCost)
    const basis = num(l.costBasis)
    const floored = basis < trueCost
    if (floored) flooredLines++
    return {
      name: l.name || 'Item',
      cost: floored ? trueCost : basis,
      trueCost,
      qty: l.quantity,
      addedAtMonth: l.addedAtMonth ?? null,
    }
  })

  const engineConfig = {
    marginPct: config.marginPct,
    financePct: config.financePct,
    taxPct: config.purchaseTaxPct,
    exempt: config.taxExempt,
    recoverByMonth: config.recoverByMonth,
    stepPct: config.stepPct ?? null,
    deprPct: config.deprPct,
    lifeMonths: config.lifeMonths,
  }

  // Flow is owned stock, so procurement is never `new`: nothing is laid out at
  // signing. A unit under a note makes it stock_financed and the note's real terms
  // drive the cash picture.
  const q = quote({
    items,
    termMonths: config.termMonths,
    config: engineConfig,
    funding: { mode: config.funding ? 'loan' : 'cash' },
    procurement: config.funding
      ? {
          mode: 'stock_financed',
          monthsInService: num(config.monthsInService),
          loan: {
            balance: num(config.funding.balance),
            aprPct: num(config.funding.aprPct),
            monthsLeft: Math.round(num(config.funding.monthsLeft)),
          },
        }
      : { mode: 'stock_owned', monthsInService: num(config.monthsInService) },
  })

  const schedule = buildFlowSchedule(items, config.termMonths, engineConfig)
  const currentMonth = Math.max(1, Math.round(num(config.currentMonth ?? 1)))

  return {
    quote: q,
    schedule,
    rateForMonth: schedule.rateForMonth,
    monthlyNow: schedule.rateForMonth(currentMonth),
    contractValue: schedule.contract,
    flooredLines,
    feasible: schedule.feasible,
  }
}
