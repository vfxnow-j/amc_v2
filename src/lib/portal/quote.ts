/**
 * The portal's quote core: request lines + resolved offers + the account's tier and
 * verification + a capacity signal → a price and a verdict per line.
 *
 * Pure — no prisma, no next/*. It only calls the existing engines:
 *  - Rental: every component is priced the way an order built from it would price
 *    it, over the requested window, with the order's own period functions
 *    (calculatePeriods + computeItemSubtotal; a one-time line is one period):
 *     · an ASSET offer's asset: its rate ladder at MONTHLY (deriveRentalRate — the
 *       unit pricingTypeForBillingCycle gives a monthly order), as createReservation
 *       prices a line;
 *     · a package template line: its OWN rate and pricing type, exactly as
 *       loadTemplateIntoOrder adds it — the line's rate and type if set, else the
 *       asset's pickRate (monthly, else weekly, else daily); a service line
 *       (service, no asset) is one-time at its rate or the service's defaultRate,
 *       as addServiceItemToReservation adds it. Nothing is converted to monthly for
 *       pricing, so a WEEKLY line over a 6-week window is 6 weeks, not 1.5 × 4 weeks.
 *  - Flow: applyFlowDefaults (house defaults + the tier's margin) →
 *    flowConfigFromSettings → priceFlowLines → flowClientQuote, the chain every Flow
 *    order goes through. `unit_price` is the month-1 payment per unit, `line_total` the
 *    line's contract value. Lease funding is never an input: the client's price does
 *    not depend on it (the Flow schedule is built without it).
 *  - RTO is never priced — see QUOTABLE_SOLUTIONS in ./tiers (owner decision pending).
 *
 * Money is pre-tax and excludes delivery; the order adds those.
 *
 * `line_total` is the whole window (rental) or term (Flow) for the line's quantity,
 * one-time charges included; `one_time` is the one-time part of it. `unit_price` is
 * DISPLAY ONLY: for rental, the recurring part of one unit expressed per month —
 * the recurring window total ÷ the window's months (calculatePeriods at MONTHLY,
 * floored at one). For a monthly-only offer that is exactly the monthly rate; for a
 * weekly or daily line it is that line's window charge spread per month. Nothing
 * should re-derive a total from unit_price; the order reproduces the snapshot's
 * per-component rate and pricing type instead.
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
  QUOTABLE_SOLUTIONS,
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
  /** Months, for Flow (and RTO, which is refused). Ignored for rental. */
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
  /**
   * A package template line (priced as loadTemplateIntoOrder adds it). Absent/false
   * = an ASSET offer's own asset (priced at the monthly ladder).
   */
  templateLine?: boolean
  /** A template line's service; with no asset it is a one-time service line. */
  serviceId?: string | null
  /** The service's defaultRate, used when the template line sets no rate. */
  serviceDefaultRate?: number | null
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

/**
 * Units of an offer free over the window, and its demand. `null` = unknown — a
 * physical asset behind the offer whose capacity could not be read. Unknown fails
 * CLOSED: the line is priced but refused as insufficient_capacity, since the portal
 * must not promise gear it can't see. An offer with no physical asset component at
 * all (a services-only package, or any offer whose components carry no asset) has
 * nothing to check capacity against: `available: Infinity` — never null — so it is
 * never refused for capacity it doesn't need.
 */
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
  /** The one-time charges inside line_total (0 when none; null when unpriced). */
  one_time: number | null
  demand: Demand
  allowed: boolean
  reason: QuoteReason | null
}

/**
 * One component as the snapshot keeps it. BINDING for Phase 2 orders: an order made
 * from a rate_id copies `rate` and `pricingType` (and isOneTime) onto its line —
 * it never re-derives them from the asset or the template, which may have changed.
 */
export type SnapshotComponent = {
  assetId: string | null
  serviceId: string | null
  name: string
  /** Per one unit of the offer. */
  quantity: number
  rate: number
  pricingType: string
  isOneTime: boolean
  periods: number
  /** rate × quantity × qty × periods, as computeItemSubtotal gives it. */
  subtotal: number
}

/** What the snapshot keeps per line so an order can reproduce the price. Never returned. */
export type QuoteLineInternal = {
  offerId: string
  solution: string
  term: number | null
  qty: number
  unitPrice: number | null
  lineTotal: number | null
  oneTime?: number
  /** The window's months (display basis of unit_price). */
  months?: number
  components?: SnapshotComponent[]
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
  /** Sum over ALLOWED lines only — what the account can actually order. */
  total: number
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

/** The solutions an offer may be quoted in at this tier. Never RTO (QUOTABLE_SOLUTIONS). */
export function allowedSolutions(offer: Pick<OfferPricing, 'solutions'>, tier: CreditTier): PortalSolution[] {
  return QUOTABLE_SOLUTIONS.filter((s) => offer.solutions.includes(s) && tier.solutions.includes(s))
}

/** The same precedence as the order builder's pickRate (queries/order-builder.ts). */
function pickRateOf(r: NonNullable<OfferComponent['assetRates']>): { rate: number; pricingType: string } {
  const n = (v: NumLike) => {
    const x = Number(v ?? 0)
    return Number.isFinite(x) ? x : 0
  }
  if (n(r.monthlyRate) > 0) return { rate: n(r.monthlyRate), pricingType: 'MONTHLY' }
  if (n(r.weeklyRate) > 0) return { rate: n(r.weeklyRate), pricingType: 'WEEKLY' }
  return { rate: n(r.dailyRate), pricingType: 'DAILY' }
}

/**
 * The rate, pricing type and one-time flag an order line made from this component
 * would carry. Null when it has no price (a zero rate) — the offer is then unpriced.
 */
export function resolveComponent(c: OfferComponent): { rate: number; pricingType: string; isOneTime: boolean } | null {
  let out: { rate: number; pricingType: string; isOneTime: boolean }
  if (!c.templateLine) {
    // An ASSET offer: the asset's ladder at the monthly order's pricing type.
    out = { rate: c.assetRates ? deriveRentalRate(c.assetRates, MONTHLY) : 0, pricingType: MONTHLY, isOneTime: c.isOneTime }
  } else if (c.serviceId && !c.assetId) {
    // addServiceItemToReservation: always PROJECT, one-time, rate × qty.
    out = { rate: c.overrideRate ?? c.serviceDefaultRate ?? 0, pricingType: 'PROJECT', isOneTime: true }
  } else {
    // loadTemplateIntoOrder: the line's rate/type, else the asset's pickRate, else 0/MONTHLY.
    const current = c.assetRates ? pickRateOf(c.assetRates) : null
    out = {
      rate: c.overrideRate ?? current?.rate ?? 0,
      pricingType: c.overridePricingType ?? current?.pricingType ?? 'MONTHLY',
      isOneTime: c.isOneTime,
    }
  }
  return Number.isFinite(out.rate) && out.rate > 0 ? out : null
}

type Priced = {
  unitPrice: number
  lineTotal: number
  oneTime: number
  internal: Pick<QuoteLineInternal, 'months' | 'components' | 'flow' | 'oneTime'>
}

function priceRental(offer: OfferPricing, qty: number, start: Date, end: Date, adjustPct: number): Priced | null {
  if (!offer.components.length) return null
  const adj = (n: number) => roundMoney(n * (1 + adjustPct / 100))
  const months = calculatePeriods(start, end, MONTHLY)
  let recurringPerUnit = 0
  let lineTotal = 0
  let oneTime = 0
  const components: SnapshotComponent[] = []
  for (const c of offer.components) {
    const r = resolveComponent(c)
    if (!r) return null
    const rate = adj(r.rate)
    // The order's rule: a one-time line is one period; every other line is priced
    // in its own type over the window (reservations.ts, `isOneTime ? 1 : calculatePeriods`).
    const periods = r.isOneTime ? 1 : calculatePeriods(start, end, r.pricingType)
    const subtotal = computeItemSubtotal(rate, c.quantity * qty, periods)
    lineTotal += subtotal
    if (r.isOneTime) oneTime += subtotal
    else recurringPerUnit += rate * c.quantity * periods
    components.push({
      assetId: c.assetId,
      serviceId: c.serviceId ?? null,
      name: c.name,
      quantity: c.quantity,
      rate,
      pricingType: r.pricingType,
      isOneTime: r.isOneTime,
      periods,
      subtotal,
    })
  }
  // A rental with nothing recurring in it is not a rental.
  if (recurringPerUnit <= 0) return null
  return {
    unitPrice: roundMoney(recurringPerUnit / months),
    lineTotal: roundMoney(lineTotal),
    oneTime: roundMoney(oneTime),
    internal: { months, components, oneTime: roundMoney(oneTime) },
  }
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
    oneTime: 0,
    internal: { flow: { knobs, lines, month1, contractValue: client.totals.contract } },
  }
}

export function priceQuote(request: QuoteRequestLine[], ctx: QuoteContext): QuoteResult {
  const { tier, window } = ctx
  // Capacity is read only for an offer that passed the visibility check, so a
  // hidden or retired offer leaks no demand. Cached: one read per offer.
  const capCache = new Map<string, CapacitySignal>()
  const capacityOf = (offerId: string): CapacitySignal => {
    if (!capCache.has(offerId)) capCache.set(offerId, ctx.capacity(offerId))
    return capCache.get(offerId)!
  }

  const out: { line: QuoteLine; internal: QuoteLineInternal }[] = request.map((req) => {
    const offer = ctx.offers.get(req.offerId)
    const term = req.solution === 'rental' ? null : req.term
    const base: QuoteLine = {
      offer_id: req.offerId,
      solution: req.solution,
      term_months: term,
      qty: req.qty,
      unit_price: null,
      line_total: null,
      one_time: null,
      demand: 'normal',
      allowed: false,
      reason: null,
    }
    const internal: QuoteLineInternal = { offerId: req.offerId, solution: req.solution, term, qty: req.qty, unitPrice: null, lineTotal: null }

    if (!offer || !offer.visible) return { line: { ...base, reason: 'offer_not_visible' as const }, internal }
    base.demand = capacityOf(offer.id)?.demand ?? 'normal'
    const refuse = (reason: QuoteReason) => ({ line: { ...base, reason }, internal })

    // RTO is refused here too (allowedSolutions never includes it) — owner decision pending.
    if (!allowedSolutions(offer, tier).includes(req.solution)) return refuse('solution_not_allowed')

    let priced: Priced | null
    if (req.solution === 'flow') {
      if (term == null || !allowedTerms(offer, tier, 'flow').includes(term)) return refuse('term_not_allowed')
      priced = priceFlow(offer, req.qty, term, tier, ctx.flowDefaults)
    } else if (req.solution === 'rental') {
      if (!window.end) return refuse('unpriced')
      priced = priceRental(offer, req.qty, window.start, window.end, tier.priceAdjustPct)
    } else {
      return refuse('solution_not_allowed')
    }
    if (!priced) return refuse('unpriced')

    const line: QuoteLine = { ...base, unit_price: priced.unitPrice, line_total: priced.lineTotal, one_time: priced.oneTime }
    const full: QuoteLineInternal = { ...internal, ...priced.internal, unitPrice: priced.unitPrice, lineTotal: priced.lineTotal }
    // Priced but not placeable: the client still sees what it would cost.
    if (!verificationMeets(ctx.verificationLevel, tier.requiresVerification[req.solution])) {
      return { line: { ...line, reason: 'verification_required' as const }, internal: full }
    }
    return { line: { ...line, allowed: true }, internal: full }
  })

  // Capacity is per OFFER across the whole quote: two lines of the same offer draw
  // on the same units. Unknown capacity fails closed (see CapacitySignal).
  const wanted = new Map<string, number>()
  for (const o of out) if (o.line.allowed) wanted.set(o.line.offer_id, (wanted.get(o.line.offer_id) ?? 0) + o.line.qty)
  for (const o of out) {
    if (!o.line.allowed) continue
    const cap = capacityOf(o.line.offer_id)
    if (!cap || wanted.get(o.line.offer_id)! > cap.available) o.line = { ...o.line, allowed: false, reason: 'insufficient_capacity' }
  }

  // The credit limit is a whole-quote check: over it, every otherwise-allowed line is refused.
  const allowedSum = roundMoney(out.reduce((s, o) => s + (o.line.allowed ? o.line.line_total ?? 0 : 0), 0))
  if (tier.maxOrderTotal != null && allowedSum > tier.maxOrderTotal) {
    for (const o of out) if (o.line.allowed) o.line = { ...o.line, allowed: false, reason: 'credit_limit' }
  }

  const lines = out.map((o) => o.line)
  return {
    lines,
    internal: out.map((o) => o.internal),
    // Allowed lines only; a refused line keeps its own line_total so the client
    // still sees what it would cost, but it is not in what can be ordered.
    total: roundMoney(lines.reduce((s, l) => s + (l.allowed ? l.line_total ?? 0 : 0), 0)),
    validForMs: request.some((l) => l.solution === 'flow') ? FLOW_QUOTE_VALID_MS : QUOTE_VALID_MS,
  }
}

// ---------------------------------------------------------------------------
// The quote route's pure parts — the handler only loads and stores around these.
// ---------------------------------------------------------------------------

/** The end of the capacity window: the rental end, or the longest Flow term's end. */
export function capacityWindowEnd(window: QuoteWindow, lines: QuoteRequestLine[]): Date {
  let to = window.end ?? window.start
  for (const l of lines) {
    if (l.solution === 'flow' && l.term != null) {
      const end = termEnd(window.start, l.term)
      if (end > to) to = end
    }
  }
  return to
}

/**
 * An offer's capacity is its scarcest physical part: whole offers the units allow.
 * No physical asset component (a services-only package, a free-text package line,
 * or any offer whose components carry no asset) means capacity does not apply —
 * available is unbounded, not unknown. Unknown (null) is reserved for an offer that
 * DOES have a physical asset whose capacity could not be read.
 */
export function offerCapacity(
  parts: { assetId: string; quantity: number }[] | undefined,
  perAsset: Map<string, { available: number; demand: Demand }>,
): CapacitySignal {
  if (!parts?.length) return { available: Infinity, demand: 'normal' }
  let available = Infinity
  let demand: Demand = 'normal'
  for (const p of parts) {
    const c = perAsset.get(p.assetId)
    if (!c) return null
    available = Math.min(available, Math.floor(c.available / p.quantity))
    if (c.demand === 'high') demand = 'high'
  }
  return { available, demand }
}

/** The response body of POST /v1/rates/quote. Client lines only; `internal` never. */
export function quoteResponseBody(rateId: string, validUntil: Date, result: QuoteResult) {
  return { rate_id: rateId, valid_until: validUntil.toISOString(), total: result.total, lines: result.lines }
}

/** What portal_rate_quotes.lines stores: the tier, the client lines and the internal part. */
export function quoteSnapshotLines(tierId: string, result: QuoteResult) {
  return { tier: tierId, client: result.lines, internal: result.internal }
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

/** Today's date (YYYY-MM-DD) in Los Angeles, where the business runs. */
export function businessToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
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
 * can show; `field` names where it is. `now` sets "today" (Los Angeles business day)
 * for the no-past-start rule.
 */
export function parseQuoteRequest(body: unknown, now: Date = new Date()): { ok: true; value: ParsedQuoteRequest } | { ok: false; field: string; message: string } {
  const fail = (field: string, message: string) => ({ ok: false as const, field, message })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body', 'The body must be a JSON object.')
  const b = body as Record<string, unknown>
  if (!isPortalId(b.account_id)) return fail('account_id', 'account_id must be a string id.')

  const w = b.window
  if (!w || typeof w !== 'object' || Array.isArray(w)) return fail('window', 'window must be an object with start (and end for rental).')
  const start = parseDate((w as Record<string, unknown>).start)
  if (!start) return fail('window.start', 'window.start must be a date (YYYY-MM-DD).')
  // Today is allowed; yesterday is not. The day compared is the Los Angeles business day.
  if (start.toISOString().slice(0, 10) < businessToday(now)) return fail('window.start', 'window.start may not be in the past.')
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
    if (solution === 'rto') {
      // Accepted so the line comes back refused (solution_not_allowed), not as a 422:
      // RTO has no portal price until the owner defines its basis.
      term = typeof l.term_months === 'number' && ALL_TERMS.rto.includes(l.term_months) ? l.term_months : null
    } else if (solution !== 'rental') {
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
