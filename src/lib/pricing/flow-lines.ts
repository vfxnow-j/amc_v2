/**
 * What a Flow order STORES, derived from its lines — the one place the order form,
 * the detail page and the server all turn lines + settings into money.
 *
 * `item.rate` on a Flow line holds the line's per-unit CONTRACT value (basis →
 * +purchase tax → +financing → +margin), and each line's subtotal is its contract
 * value, so the order total agrees with the Flow summary to the cent. `flowMonthlyPayment` is the rate of the period
 * the order is in, never contract ÷ term — the schedule steps at the anniversary.
 *
 * Everything goes through flowOrder(), so the stored numbers, the quote and the
 * schedule come from one call and cannot drift.
 *
 * Client-safe: no server-only imports.
 */
import {
  flowOrder,
  FLOW_CONFIG_DEFAULTS,
  type FlowOrderConfig,
  type FlowOrderLine,
  type FlowOrderResult,
} from './flow-order'

/** A number, a numeric string, or a Prisma Decimal. */
type NumLike = number | string | { toString(): string } | null | undefined

export type FlowLineInput = {
  name?: string | null
  costBasis?: NumLike
  trueCost?: NumLike
  quantity?: number | null
  addedAtMonth?: number | null
}

/** The order columns a Flow config is read from. Prisma rows fit this as-is. */
export type FlowOrderSettings = {
  flowTermMonths?: number | null
  flowMarginPct?: NumLike
  flowFinancePct?: NumLike
  flowPurchaseTaxPct?: NumLike
  flowTaxExempt?: boolean | null
  flowRecoverByMonth?: number | null
  flowDeprPct?: NumLike
  flowLifeMonths?: number | null
  flowPeriodsBilled?: number | null
  flowStepPct?: NumLike
}

export type FlowPricedLines = {
  /** True only when every line is priced AND the schedule is feasible. */
  ok: boolean
  /** Why the order cannot be saved, when it cannot. */
  problem: string | null
  /** Indexes of lines with no usable cost basis (missing or zero). */
  unpriced: number[]
  feasible: boolean
  /** Per-unit contract value per input line, to cents. 0 for an unpriced line. */
  rates: number[]
  /**
   * Each line's contract value, to cents, with any rounding residual placed on the
   * last priced line so they sum EXACTLY to contractValue. Equal to rates[i] × qty
   * whenever the per-unit value is a whole cent; otherwise within qty × half a cent.
   */
  subtotals: number[]
  /** The schedule's contract value. */
  contractValue: number
  /** The rate for the period the order is in. */
  monthlyNow: number
  /** Lines whose basis was floored up to their true cost. */
  flooredLines: number
  /** The full result, for the summary, terms, economics and schedule panels. */
  result: FlowOrderResult
}

const toNum = (v: NumLike): number | null => {
  if (v == null || v === '') return null
  const n = Number(typeof v === 'object' ? v.toString() : v)
  return Number.isFinite(n) ? n : null
}

/**
 * Half-up to cents. Scaling first and trimming to 12 significant digits drops the
 * float noise that would otherwise round 149.985 (stored as 149.98499999…) down.
 */
const round2 = (n: number): number => Math.round(Number((n * 100).toPrecision(12))) / 100

/**
 * The pricing config stored on an order. A knob left null falls back to
 * FLOW_CONFIG_DEFAULTS; null when the order has no term, since nothing can be
 * priced without one.
 */
export function flowConfigFromSettings(s: FlowOrderSettings): FlowOrderConfig | null {
  const term = toNum(s.flowTermMonths)
  if (!term || term <= 0) return null
  const pick = (v: NumLike, d: number) => toNum(v) ?? d
  return {
    ...FLOW_CONFIG_DEFAULTS,
    termMonths: Math.round(term),
    marginPct: pick(s.flowMarginPct, FLOW_CONFIG_DEFAULTS.marginPct),
    financePct: pick(s.flowFinancePct, FLOW_CONFIG_DEFAULTS.financePct),
    purchaseTaxPct: pick(s.flowPurchaseTaxPct, FLOW_CONFIG_DEFAULTS.purchaseTaxPct),
    taxExempt: s.flowTaxExempt ?? FLOW_CONFIG_DEFAULTS.taxExempt,
    recoverByMonth: pick(s.flowRecoverByMonth, FLOW_CONFIG_DEFAULTS.recoverByMonth),
    stepPct: toNum(s.flowStepPct) ?? null,
    deprPct: pick(s.flowDeprPct, FLOW_CONFIG_DEFAULTS.deprPct),
    lifeMonths: pick(s.flowLifeMonths, FLOW_CONFIG_DEFAULTS.lifeMonths),
    currentMonth: Math.max(0, Math.round(toNum(s.flowPeriodsBilled) ?? 0)) + 1,
  }
}

/**
 * Price a Flow order's lines. An unpriced line (no basis, or zero) is carried at a
 * zero basis so the rest of the order still renders, but it blocks the order: a
 * Flow line with no cost would quote free hardware.
 */
export function priceFlowLines(lines: FlowLineInput[], config: FlowOrderConfig): FlowPricedLines {
  const unpriced: number[] = []
  const orderLines: FlowOrderLine[] = (lines || []).map((l, i) => {
    const basis = toNum(l.costBasis)
    if (basis == null || basis <= 0) unpriced.push(i)
    const trueCost = toNum(l.trueCost)
    return {
      name: l.name || 'Item',
      costBasis: basis != null && basis > 0 ? basis : 0,
      // An unpriced line must not be floored up by a stray true cost into a price
      // nobody entered; it stays at zero until it gets a basis.
      trueCost: basis != null && basis > 0 ? trueCost : null,
      quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
      addedAtMonth: l.addedAtMonth ?? null,
    }
  })

  const result = flowOrder(orderLines, config)
  const chainLines = result.quote.chain.lines
  const rates = orderLines.map((l, i) => {
    const line = chainLines[i]
    return line && line.qty > 0 ? round2(line.contract / line.qty) : 0
  })
  // Line subtotals come from each line's extended contract, not rate × qty, so
  // per-unit rounding cannot make the order total drift from the schedule's
  // contract; whatever cent is left over lands on the last priced line.
  const subtotals = orderLines.map((_, i) => (chainLines[i] ? round2(chainLines[i].contract) : 0))
  const residual = round2(result.contractValue - subtotals.reduce((s, x) => s + x, 0))
  if (residual !== 0) {
    for (let i = subtotals.length - 1; i >= 0; i--) {
      if (subtotals[i] > 0) {
        subtotals[i] = round2(subtotals[i] + residual)
        break
      }
    }
  }

  let problem: string | null = null
  if (!orderLines.length) {
    problem = 'A Flow order needs at least one line.'
  } else if (unpriced.length) {
    problem = `${unpriced.length} line${unpriced.length === 1 ? ' has' : 's have'} no cost basis — a Flow line cannot be priced at $0.`
  } else if (!result.feasible) {
    problem = 'This Flow schedule is not feasible — adjust the term or pricing settings.'
  }

  return {
    ok: problem == null,
    problem,
    unpriced,
    feasible: result.feasible,
    rates,
    subtotals,
    contractValue: result.contractValue,
    monthlyNow: result.monthlyNow,
    flooredLines: result.flooredLines,
    result,
  }
}
