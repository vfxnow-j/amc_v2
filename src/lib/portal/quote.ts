/**
 * The portal's quote core: request lines + resolved offers + the account's tier and
 * verification + a capacity signal → a price and a verdict per line.
 *
 * Pure — no prisma, no next/*. It only calls the existing engines:
 *  - Rental and RTO: the asset's own rate ladder (deriveRentalRate, MONTHLY — the
 *    unit pricingTypeForBillingCycle gives a monthly order), prorated over the window
 *    by calculatePeriods and extended by computeItemSubtotal, exactly as
 *    createReservation prices a line. A package template line's own `rate` overrides
 *    the asset's. RTO is the monthly rate across its term (the builder's
 *    total ÷ term = the monthly payment).
 *  - Flow: applyFlowDefaults (house defaults + the tier's margin) →
 *    flowConfigFromSettings → priceFlowLines → flowClientQuote, the chain every Flow
 *    order goes through. `unit_price` is the month-1 payment per unit, `line_total` the
 *    line's contract value. Lease funding is never an input: the client's price does
 *    not depend on it (the Flow schedule is built without it).
 *
 * Money is pre-tax and excludes delivery; the order adds those.
 *
 * `unit_price` is always a per-month figure for one unit; `line_total` is the whole
 * window (rental) or term (RTO, Flow) for the line's quantity.
 */
import { deriveRentalRate, pricingTypeForBillingCycle } from '@/lib/pricing/rates'
import { calculatePeriods, computeItemSubtotal, roundMoney } from '@/lib/pricing/periods'
import { flowConfigFromSettings, priceFlowLines, type FlowOrderSettings } from '@/lib/pricing/flow-lines'
import { flowClientQuote } from '@/lib/pricing/flow-client-quote'
import { applyFlowDefaults, type FlowPricingDefaults } from '@/lib/flow/defaults'
import { flowSnapshotLineCost } from '@/lib/flow/stored-money'
import {
  ALL_TERMS,
  PORTAL_SOLUTIONS,
  verificationMeets,
  type CreditTier,
  type PortalSolution,
} from './tiers'

export const QUOTE_REASONS = [
  'offer_not_visible',
  'solution_not_allowed',
  'term_not_allowed',
  'verification_required',
  'credit_limit',
  'unpriced',
  'insufficient_capacity',
] as const
export type QuoteReason = (typeof QUOTE_REASONS)[number]

export type Demand = 'normal' | 'high'

/** Quote validity (decision 7): 7 days, Flow 72 hours. */
export const QUOTE_VALID_MS = 7 * 24 * 3600_000
export const FLOW_QUOTE_VALID_MS = 72 * 3600_000

export type QuoteWindow = { start: Date; end: Date | null }

export type QuoteRequestLine = {
  offerId: string
  qty: number
  solution: PortalSolution
  /** Months, for RTO and Flow. Ignored for rental. */
  term: number | null
}

type NumLike = number | string | { toString(): string } | null | undefined

/** One priced part of an offer: the asset itself, or one line of a package template. */
export type OfferComponent = {
  assetId: string | null
  name: string
  /** Per one unit of the offer. */
  quantity: number
  /** The asset's rate ladder (null for a service/free-text package line). */
  assetRates: { dailyRate?: NumLike; weeklyRate?: NumLike; monthlyRate?: NumLike } | null
  /** A package line's own rate, in its own pricing type. Overrides the asset's. */
  overrideRate: number | null
  overridePricingType: string | null
  isOneTime: boolean
  /** Landed-cost basis per unit, for Flow only (loadFlowBases). Never funding. */
  flowBasis: { basis: number; incomplete: boolean } | null
}

export type OfferPricing = {
  id: string
  /** Published (isVisible). An unpublished offer quotes as offer_not_visible. */
  visible: boolean
  solutions: string[]
  /** The offer's own term list per solution; null/absent = the tier's. */
  termsBySolution: Partial<Record<string, number[]>> | null
  components: OfferComponent[]
}

export type CapacitySignal = { available: number; demand: Demand } | null

export type QuoteContext = {
  offers: Map<string, OfferPricing>
  tier: CreditTier
  verificationLevel: string
  flowDefaults: FlowPricingDefaults
  window: QuoteWindow
  capacity: (offerId: string) => CapacitySignal
}

/** What the client sees per line. */
export type QuoteLine = {
  offer_id: string
  solution: string
  term_months: number | null
  qty: number
  unit_price: number | null
  line_total: number | null
  demand: Demand
  allowed: boolean
  reason: QuoteReason | null
}

/** What the snapshot keeps per line so an order can reproduce the price. Never returned. */
export type QuoteLineInternal = {
  offerId: string
  solution: string
  term: number | null
  qty: number
  unitPrice: number | null
  lineTotal: number | null
  periods?: number
  components?: { assetId: string | null; name: string; quantity: number; monthlyRate: number; oneTime: number }[]
  flow?: {
    knobs: FlowOrderSettings
    lines: { assetId: string | null; name: string; costBasis: number; trueCost: number; quantity: number }[]
    month1: number
    contractValue: number
  }
}

export type QuoteResult = {
  lines: QuoteLine[]
  internal: QuoteLineInternal[]
  /** Sum of every priced line's total (allowed or not). */
  total: number
  /** Sum over allowed lines only. */
  allowedTotal: number
  /** Shortest validity of the solutions quoted. */
  validForMs: number
}

const MONTHLY = pricingTypeForBillingCycle('MONTHLY')

/** The term list a line's solution may take for this offer at this tier. */
export function allowedTerms(offer: Pick<OfferPricing, 'termsBySolution'>, tier: CreditTier, solution: 'rto' | 'flow'): number[] {
  const tierTerms = tier.terms[solution] ?? []
  const own = offer.termsBySolution?.[solution]
  const offerTerms = Array.isArray(own) && own.length ? own : ALL_TERMS[solution]
  return tierTerms.filter((t) => offerTerms.includes(t))
}

/** The solutions an offer may be quoted in at this tier. */
export function allowedSolutions(offer: Pick<OfferPricing, 'solutions'>, tier: CreditTier): PortalSolution[] {
  return PORTAL_SOLUTIONS.filter((s) => offer.solutions.includes(s) && tier.solutions.includes(s))
}

/** A component's monthly rate (0 = none) and one-time amount, before the tier adjustment. */
function componentRate(c: OfferComponent): { monthly: number; oneTime: number } {
  if (c.overrideRate != null) {
    const type = c.overridePricingType || 'MONTHLY'
    const key = type === 'DAILY' ? 'dailyRate' : type === 'WEEKLY' ? 'weeklyRate' : type === 'MONTHLY' ? 'monthlyRate' : null
    // A flat (one-time, project, custom, hourly) package price is charged once per unit.
    if (c.isOneTime || !key) return { monthly: 0, oneTime: c.overrideRate }
    return { monthly: deriveRentalRate({ [key]: c.overrideRate }, MONTHLY), oneTime: 0 }
  }
  if (!c.assetRates) return { monthly: 0, oneTime: 0 }
  const monthly = deriveRentalRate(c.assetRates, MONTHLY)
  return c.isOneTime ? { monthly: 0, oneTime: monthly } : { monthly, oneTime: 0 }
}

type Priced = { unitPrice: number; lineTotal: number; internal: Omit<QuoteLineInternal, 'offerId' | 'solution' | 'term' | 'qty' | 'unitPrice' | 'lineTotal'> }

function priceTermRental(offer: OfferPricing, qty: number, periods: number, adjustPct: number): Priced | null {
  if (!offer.components.length) return null
  const adj = (n: number) => roundMoney(n * (1 + adjustPct / 100))
  let unitPrice = 0
  let lineTotal = 0
  const components: NonNullable<QuoteLineInternal['components']> = []
  for (const c of offer.components) {
    const r = componentRate(c)
    if (r.monthly <= 0 && r.oneTime <= 0) return null
    const monthly = adj(r.monthly)
    const oneTime = adj(r.oneTime)
    unitPrice += monthly * c.quantity
    lineTotal += computeItemSubtotal(monthly, c.quantity * qty, periods) + computeItemSubtotal(oneTime, c.quantity * qty, 1)
    components.push({ assetId: c.assetId, name: c.name, quantity: c.quantity, monthlyRate: monthly, oneTime })
  }
  if (unitPrice <= 0) return null
  return { unitPrice: roundMoney(unitPrice), lineTotal: roundMoney(lineTotal), internal: { periods, components } }
}

function priceFlow(offer: OfferPricing, qty: number, term: number, tier: CreditTier, defaults: FlowPricingDefaults): Priced | null {
  if (!offer.components.length) return null
  const lines: NonNullable<QuoteLineInternal['flow']>['lines'] = []
  for (const c of offer.components) {
    // A service or one-time line has no owned gear behind it: Flow can't carry it.
    if (!c.assetId || c.isOneTime) return null
    const snap = flowSnapshotLineCost({ trueCost: null, costBasis: null }, c.flowBasis ?? undefined, c.name)
    if (!snap.ok) return null
    lines.push({ assetId: c.assetId, name: c.name, costBasis: snap.cost.costBasis, trueCost: snap.cost.trueCost, quantity: c.quantity * qty })
  }
  // Exactly createReservation's knob seeding: house defaults fill every blank knob;
  // the tier may set the margin. The step stays null (the recoverByMonth shape).
  const knobs = applyFlowDefaults<FlowOrderSettings>(
    { flowTermMonths: term, flowMarginPct: tier.flowMarginPct ?? null, flowStepPct: null },
    defaults,
  )
  const config = flowConfigFromSettings(knobs)
  if (!config) return null
  const priced = priceFlowLines(lines, config)
  if (!priced.ok) return null
  const client = flowClientQuote({
    rates: priced.result.schedule.rows.map((r) => r.rate),
    discountAmount: 0,
    taxRate: 0,
    deliveryCost: 0,
    returnCost: 0,
    feasible: priced.result.feasible,
  })
  if (!client.feasible || !client.rows.length) return null
  const month1 = client.rows[0].payment
  return {
    unitPrice: roundMoney(month1 / qty),
    lineTotal: client.totals.contract,
    internal: { flow: { knobs, lines, month1, contractValue: client.totals.contract } },
  }
}

export function priceQuote(request: QuoteRequestLine[], ctx: QuoteContext): QuoteResult {
  const { tier, window } = ctx
  const out: { line: QuoteLine; internal: QuoteLineInternal }[] = request.map((req) => {
    const offer = ctx.offers.get(req.offerId)
    const term = req.solution === 'rental' ? null : req.term
    const cap = offer ? ctx.capacity(offer.id) : null
    const base: QuoteLine = {
      offer_id: req.offerId,
      solution: req.solution,
      term_months: term,
      qty: req.qty,
      unit_price: null,
      line_total: null,
      demand: cap?.demand ?? 'normal',
      allowed: false,
      reason: null,
    }
    const internal: QuoteLineInternal = { offerId: req.offerId, solution: req.solution, term, qty: req.qty, unitPrice: null, lineTotal: null }
    const refuse = (reason: QuoteReason) => ({ line: { ...base, reason }, internal })

    if (!offer || !offer.visible) return refuse('offer_not_visible')
    if (!allowedSolutions(offer, tier).includes(req.solution)) return refuse('solution_not_allowed')
    if (req.solution !== 'rental' && (term == null || !allowedTerms(offer, tier, req.solution).includes(term))) {
      return refuse('term_not_allowed')
    }

    let priced: Priced | null
    if (req.solution === 'flow') {
      priced = priceFlow(offer, req.qty, term!, tier, ctx.flowDefaults)
    } else if (req.solution === 'rto') {
      priced = priceTermRental(offer, req.qty, term!, tier.priceAdjustPct)
    } else {
      if (!window.end) return refuse('unpriced')
      priced = priceTermRental(offer, req.qty, calculatePeriods(window.start, window.end, MONTHLY), tier.priceAdjustPct)
    }
    if (!priced) return refuse('unpriced')

    const line: QuoteLine = { ...base, unit_price: priced.unitPrice, line_total: priced.lineTotal }
    const full: QuoteLineInternal = { ...internal, ...priced.internal, unitPrice: priced.unitPrice, lineTotal: priced.lineTotal }
    // Priced but not placeable: the client still sees what it would cost.
    if (!verificationMeets(ctx.verificationLevel, tier.requiresVerification[req.solution])) {
      return { line: { ...line, reason: 'verification_required' as const }, internal: full }
    }
    if (cap && req.qty > cap.available) return { line: { ...line, reason: 'insufficient_capacity' as const }, internal: full }
    return { line: { ...line, allowed: true }, internal: full }
  })

  // The credit limit is a whole-quote check: over it, every otherwise-allowed line is refused.
  const allowedSum = roundMoney(out.reduce((s, o) => s + (o.line.allowed ? o.line.line_total ?? 0 : 0), 0))
  if (tier.maxOrderTotal != null && allowedSum > tier.maxOrderTotal) {
    for (const o of out) if (o.line.allowed) o.line = { ...o.line, allowed: false, reason: 'credit_limit' }
  }

  const lines = out.map((o) => o.line)
  return {
    lines,
    internal: out.map((o) => o.internal),
    total: roundMoney(lines.reduce((s, l) => s + (l.line_total ?? 0), 0)),
    allowedTotal: roundMoney(lines.reduce((s, l) => s + (l.allowed ? l.line_total ?? 0 : 0), 0)),
    validForMs: request.some((l) => l.solution === 'flow') ? FLOW_QUOTE_VALID_MS : QUOTE_VALID_MS,
  }
}

// ---------------------------------------------------------------------------
// Input validation — every field arrives from `unknown` and is hostile until checked.
// ---------------------------------------------------------------------------

export const MAX_QUOTE_LINES = 50
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/

export type ParsedQuoteRequest = { accountId: string; window: QuoteWindow; lines: QuoteRequestLine[] }

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = new Date(v.length === 10 ? `${v}T12:00:00.000Z` : v)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  return y >= 2000 && y <= 2100 ? d : null
}

export function isPortalId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

/** Add whole calendar months to a date (UTC), then step back a day: the term's inclusive end. */
export function termEnd(start: Date, months: number): Date {
  const d = new Date(start)
  d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(d.getUTCDate() - 1)
  return d
}

/**
 * Parse POST /rates/quote's body. Returns the first problem as a message the portal
 * can show; `field` names where it is.
 */
export function parseQuoteRequest(body: unknown): { ok: true; value: ParsedQuoteRequest } | { ok: false; field: string; message: string } {
  const fail = (field: string, message: string) => ({ ok: false as const, field, message })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body', 'The body must be a JSON object.')
  const b = body as Record<string, unknown>
  if (!isPortalId(b.account_id)) return fail('account_id', 'account_id must be a string id.')

  const w = b.window
  if (!w || typeof w !== 'object' || Array.isArray(w)) return fail('window', 'window must be an object with start (and end for rental).')
  const start = parseDate((w as Record<string, unknown>).start)
  if (!start) return fail('window.start', 'window.start must be a date (YYYY-MM-DD).')
  const rawEnd = (w as Record<string, unknown>).end
  const end = rawEnd == null ? null : parseDate(rawEnd)
  if (rawEnd != null && !end) return fail('window.end', 'window.end must be a date (YYYY-MM-DD).')
  if (end && end.getTime() < start.getTime()) return fail('window.end', 'window.end must not be before window.start.')
  if (end && end.getTime() - start.getTime() > 5 * 366 * 86_400_000) return fail('window.end', 'The window may not exceed five years.')

  if (!Array.isArray(b.lines) || !b.lines.length) return fail('lines', 'lines must be a non-empty array.')
  if (b.lines.length > MAX_QUOTE_LINES) return fail('lines', `A quote takes at most ${MAX_QUOTE_LINES} lines.`)

  const lines: QuoteRequestLine[] = []
  for (let i = 0; i < b.lines.length; i++) {
    const raw = b.lines[i]
    const at = `lines[${i}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(at, 'Each line must be an object.')
    const l = raw as Record<string, unknown>
    if (!isPortalId(l.offer_id)) return fail(`${at}.offer_id`, 'offer_id must be a string id.')
    if (typeof l.qty !== 'number' || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999) {
      return fail(`${at}.qty`, 'qty must be a whole number from 1 to 999.')
    }
    if (typeof l.solution !== 'string' || !(PORTAL_SOLUTIONS as readonly string[]).includes(l.solution)) {
      return fail(`${at}.solution`, `solution must be one of ${PORTAL_SOLUTIONS.join(', ')}.`)
    }
    const solution = l.solution as PortalSolution
    let term: number | null = null
    if (solution !== 'rental') {
      const all = ALL_TERMS[solution]
      if (typeof l.term_months !== 'number' || !all.includes(l.term_months)) {
        return fail(`${at}.term_months`, `term_months for ${solution} must be one of ${all.join(', ')}.`)
      }
      term = l.term_months
    } else if (!end) {
      return fail('window.end', 'A rental line needs window.end.')
    }
    lines.push({ offerId: l.offer_id, qty: l.qty, solution, term })
  }
  return { ok: true, value: { accountId: b.account_id, window: { start, end }, lines } }
}
