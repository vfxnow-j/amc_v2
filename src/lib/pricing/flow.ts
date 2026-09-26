/**
 * FLOW pricing — a fixed-term hardware subscription on gear we already own.
 *
 * THE MODEL IN ONE LINE
 *   cost → + purchase tax if we pay it → + financing % → + margin % = contract value
 *
 * Contract value spread across the term is what the client pays. Everything else in
 * here is either a restatement of that number (cycle shaping, per-item split) or a
 * check on whether it holds up (what the money really costs, cash, the tail).
 *
 * The one rule worth knowing before wiring this in: most of what the client pays is
 * not revenue. On a typical deal two thirds of the monthly is hardware being
 * reimbursed. Only the margin, plus or minus how the financing allowance landed, is
 * profit. `economics.profit` is the number to report; `client.totalPayable` is not.
 *
 * Ported from import_tmp/flow-pricing/flow-pricing/flow-pricing.js, whose figures
 * were checked by hand against real deals. Its 65 assertions are the regression
 * floor in ./flow.test.ts — if one breaks, the change is doing something unintended.
 *
 * Client-safe: no server-only imports, so the order form, the detail page, the PDF
 * renderer and the server actions all resolve identical numbers. Same discipline
 * ./periods.ts and ./financials.ts enforce, and for the same reason — a document
 * must never quote a figure the order page does not show.
 *
 * FOUR ENTRY POINTS, IN THE ORDER A NEW READER MEETS THEM:
 *   buildChain       cost → contract value. Everything else is built on this.
 *   buildSchedule    the ported shaping (flat year one, rolls on the anniversary).
 *                    Still what quote() reports — see its own doc comment for the
 *                    known gap against buildFlowSchedule on 13–17-month terms.
 *   buildFlowSchedule  the anniversary-anchored schedule — THE ONE THE APP BILLS FROM.
 *   coTermAddition   ported mid-term addition, superseded — kept for fidelity only.
 *   quoteAddition    THE ONE THE ADD-GEAR DIALOG CALLS — prices a mid-term addition
 *                    against buildFlowSchedule, not coTermAddition.
 */

/* ───────────────────────── types ───────────────────────── */

export type FlowItem = {
  name?: string
  /**
   * The PRICING BASIS, per unit — what margin and financing are applied to.
   * For owned stock this is market value, not what we happened to pay.
   */
  cost: number
  qty?: number
  /**
   * What we ACTUALLY paid, per unit. Feeds profit, return on capital and residual
   * only — never the contract, and never the schedule. Defaults to the basis, so an
   * order that does not distinguish the two reproduces the engine's figures exactly.
   */
  trueCost?: number
  /**
   * The month of the term at which this line was co-termed in. Null or absent means
   * it was on the order from the start. Only ./flow.ts's anniversary scheduling
   * reads it; the ported chain ignores it.
   */
  addedAtMonth?: number | null
}

export type FlowConfig = {
  /** Added to cost. The headline mark-up. */
  marginPct: number
  /** Added to cost to carry the money. */
  financePct: number
  /** PURCHASE tax — what we would pay buying the gear. Not the client's sales tax. */
  taxPct: number
  /** True if bought for resale, so no tax on the buy. */
  exempt: boolean
  /** Month within each 12-month cycle by which capital is fully billed back, 1–12. */
  recoverByMonth: number
  /**
   * From month 13 on, the monthly payment as a % of the year-one payment (0 < p <= 100).
   * When set it replaces the recoverByMonth shape: the contract is split so that
   * front×12 + (p/100)×front×(T−12) = contract. Null/unset = recoverByMonth.
   */
  stepPct?: number | null
  /** Declining-balance depreciation, % per year. */
  deprPct: number
  /** How long the gear stays lettable, in months. */
  lifeMonths: number
}

export type FlowFundingMode = 'cash' | 'loan' | 'lease' | 'revolver' | 'cc'

export type FlowFunding = {
  mode: FlowFundingMode
  /** Rate on the facility. Null falls back to DEFAULT_APR for the mode. */
  aprPct: number | null
  /** Note length. 0 means "size it to the contract". */
  termMonths: number
  /** Origination fee, % of principal. */
  feePct: number
  prepay: 'free' | 'penalty'
  penaltyPct: number
}

/** v2: one note against some of an order's gear — typically one lease. */
export type FlowLoan = { balance: number; aprPct: number; monthsLeft: number; label?: string }

export type FlowProcurement = {
  mode: 'new' | 'stock_owned' | 'stock_financed'
  /** Age of the gear if it is already ours. */
  monthsInService: number
  /** The note already against it, when mode is stock_financed. */
  loan: { balance: number; aprPct: number; monthsLeft: number }
  /**
   * v2: several notes at once — gear on one order can sit on different leases
   * (and some of it on none). When present and non-empty it replaces `loan`; each
   * note is costed on its own terms and the results summed. One entry prices
   * exactly like `loan`.
   */
  loans?: FlowLoan[]
}

export type FlowChainLine = {
  name: string
  unitCost: number
  qty: number
  cost: number
  tax: number
  landed: number
  /** Extended true cost — what this line actually cost us. */
  trueCapital: number
  finance: number
  margin: number
  contract: number
  addedAtMonth: number | null
}

export type FlowChain = {
  lines: FlowChainLine[]
  units: number
  cost: number
  tax: number
  landed: number
  trueCapital: number
  finance: number
  margin: number
  contract: number
}

/* ───────────────────────── defaults ───────────────────────── */

export const CONFIG_DEFAULTS: FlowConfig = {
  marginPct: 40,
  financePct: 10,
  taxPct: 9.75,
  exempt: true,
  recoverByMonth: 12,
  deprPct: 30,
  lifeMonths: 60,
}

export const FUNDING_DEFAULTS: FlowFunding = {
  mode: 'cash', aprPct: null, termMonths: 0, feePct: 0, prepay: 'free', penaltyPct: 0,
}

export const PROCUREMENT_DEFAULTS: FlowProcurement = {
  mode: 'new', monthsInService: 0, loan: { balance: 0, aprPct: 0, monthsLeft: 0 },
}

export const DEFAULT_APR: Record<FlowFundingMode, number> = {
  cash: 0, loan: 8, lease: 12, revolver: 10, cc: 24,
}

/* ───────────────────────── money helpers ───────────────────────── */

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Level payment on an amortising note. */
export function payment(principal: number, aprPct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0
  const r = aprPct / 100 / 12
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months))
}

/** Interest actually paid across the first `over` months of a note. */
export function interestOver(principal: number, aprPct: number, months: number, over: number): number {
  if (principal <= 0 || months <= 0) return 0
  const r = aprPct / 100 / 12
  const pmt = payment(principal, aprPct, months)
  let bal = principal
  let int = 0
  const n = Math.min(months, over)
  for (let m = 1; m <= n; m++) {
    const i = bal * r
    int += i
    bal -= pmt - i
    if (bal < 0) bal = 0
  }
  return int
}

/** Balance outstanding after `over` months of a note. */
export function balanceAfter(principal: number, aprPct: number, months: number, over: number): number {
  if (principal <= 0 || months <= 0) return 0
  const r = aprPct / 100 / 12
  const pmt = payment(principal, aprPct, months)
  let bal = principal
  const n = Math.min(months, over)
  for (let m = 1; m <= n; m++) {
    bal -= pmt - bal * r
    if (bal < 0) bal = 0
  }
  return bal
}

/** Declining-balance value of an asset after `months`. */
export function depreciate(value: number, months: number, deprPct: number): number {
  return value * Math.pow(1 - deprPct / 100, months / 12)
}

/* ───────────────────────── the chain ───────────────────────── */

/**
 * Build the contract value from a list of items, one line at a time.
 *
 * `cost` is the pre-tax basis, `landed` is what the basis lays out, `contract` is the
 * total the client pays across the whole term. `trueCapital` is what the gear
 * actually cost us, which for owned stock is a different number and is used only for
 * reporting.
 */
export function buildChain(items: FlowItem[] = [], config?: Partial<FlowConfig>): FlowChain {
  const C: FlowConfig = { ...CONFIG_DEFAULTS, ...(config || {}) }
  const taxMul = C.exempt ? 1 : 1 + num(C.taxPct) / 100
  const mR = num(C.marginPct) / 100
  const fR = num(C.financePct) / 100

  const lines: FlowChainLine[] = (items || []).map((i) => {
    const cost = num(i.cost)
    const qty = Math.max(0, Math.round(num(i.qty == null ? 1 : i.qty)))
    const ext = cost * qty
    const landed = ext * taxMul
    return {
      name: i.name || 'Item',
      unitCost: cost,
      qty,
      cost: ext,
      tax: landed - ext,
      landed,
      // Defaults to landed — not to ext — so an order without a true cost reproduces
      // the original engine in every case, including the non-exempt one.
      trueCapital: i.trueCost == null ? landed : num(i.trueCost) * qty,
      finance: landed * fR,
      margin: landed * mR,
      contract: landed + landed * fR + landed * mR,
      addedAtMonth: i.addedAtMonth == null ? null : Math.round(num(i.addedAtMonth)),
    }
  })

  const sum = (k: keyof FlowChainLine): number =>
    lines.reduce((s, l) => s + (l[k] as number), 0)

  return {
    lines,
    units: lines.reduce((s, l) => s + l.qty, 0),
    cost: sum('cost'),
    tax: sum('tax'),
    landed: sum('landed'),
    trueCapital: sum('trueCapital'),
    finance: sum('finance'),
    margin: sum('margin'),
    contract: sum('contract'),
  }
}

/* ───────────────────────── shaping the term ───────────────────────── */

export type FlowScheduleYear = {
  year: number
  months: number
  monthly: number
  annual: number
  changesMidYear: boolean
}

export type FlowSchedule = {
  termMonths: number
  level: number
  shaped: boolean
  recoverByMonth: number
  minRecoverMonth: number
  rollMonth: number
  frontRate: number
  backRate: number
  rates: number[]
  years: FlowScheduleYear[]
  paybackMonth: number | null
}

/** The anniversary. Twelve months, everywhere, by definition of the product. */
export const CYCLE_MONTHS = 12

/**
 * The year-one/after rates a stepPct asks for, or null when it does not apply
 * (unset, out of (0,100], or a term with no anniversary).
 */
function stepRates(contract: number, T: number, stepPct: number | null | undefined): { front: number; back: number } | null {
  const p = stepPct == null ? NaN : Number(stepPct)
  if (!Number.isFinite(p) || p <= 0 || p > 100 || T <= CYCLE_MONTHS || contract <= 0) return null
  const f = p / 100
  const front = contract / (CYCLE_MONTHS + f * (T - CYCLE_MONTHS))
  return { front, back: front * f }
}

/**
 * Spread the contract across the term, the reference engine's way.
 *
 * The client pays one rate for the first twelve months and rolls to a lower one on
 * the anniversary. The first-year rate is set so the hardware is billed back by
 * `recoverByMonth`; what is left of the contract spreads over the rest.
 *
 * Recovery cannot sit earlier than `minRecoverMonth` — any sooner and year one would
 * collect more than the entire contract.
 *
 * Reported by quote(), but buildFlowSchedule() below is the schedule the app bills
 * from — see that function's doc comment for where the two agree and where (13–17
 * month terms) they do not.
 */
export function buildSchedule(
  chain: FlowChain,
  termMonths: number,
  config?: Partial<FlowConfig>,
): FlowSchedule {
  const C: FlowConfig = { ...CONFIG_DEFAULTS, ...(config || {}) }
  const T = Math.max(1, Math.round(num(termMonths)))
  const ROLL = CYCLE_MONTHS
  const level = chain.contract / T

  const minRecover = chain.contract > 0
    ? Math.ceil((ROLL * chain.landed) / chain.contract)
    : 1
  const asked = Math.round(num(C.recoverByMonth))
  const step = stepRates(chain.contract, T, C.stepPct)
  const shaped = !step && T > ROLL && asked >= minRecover && asked <= ROLL && chain.landed > 0
  const roi = shaped ? asked : 0

  const front = step ? step.front : shaped ? chain.landed / roi : level
  const back = step ? step.back : shaped ? (chain.contract - front * ROLL) / (T - ROLL) : level

  const rates: number[] = []
  for (let m = 1; m <= T; m++) rates.push(shaped || step ? (m <= ROLL ? front : back) : level)

  const years: FlowScheduleYear[] = []
  for (let y = 1; y <= Math.ceil(T / 12); y++) {
    const a = (y - 1) * 12
    const b = Math.min(y * 12, T)
    const slice = rates.slice(a, b)
    const annual = slice.reduce((x, r) => x + r, 0)
    years.push({
      year: y,
      months: b - a,
      monthly: annual / (b - a),
      annual,
      changesMidYear: slice.some((r) => Math.abs(r - slice[0]) > 0.005),
    })
  }

  let run = 0
  let payback: number | null = null
  for (let k = 1; k <= T && payback === null; k++) {
    run += rates[k - 1]
    if (run >= chain.landed - 0.01) payback = k
  }

  return {
    termMonths: T,
    level,
    shaped: shaped || !!step,
    recoverByMonth: roi,
    minRecoverMonth: minRecover,
    rollMonth: ROLL,
    frontRate: front,
    backRate: back,
    rates,
    years,
    paybackMonth: payback,
  }
}

/* ───────────────────────── the funding side ───────────────────────── */

export type ResolvedFunding = {
  funding: FlowFunding
  procurement: FlowProcurement
  financed: number
  aprPct: number
  noteMonths: number
  fees: number
  /**
   * v2: every note costed separately. `financed` is their total, `aprPct` the
   * balance-weighted rate and `noteMonths` the longest — summaries only; quote()
   * costs each note from this list.
   */
  loans: { balance: number; aprPct: number; noteMonths: number; label?: string }[]
}

export function resolveFunding(
  funding: Partial<FlowFunding> | undefined,
  procurement: Partial<FlowProcurement> | undefined,
  chain: FlowChain,
  termMonths: number,
): ResolvedFunding {
  const F: FlowFunding = { ...FUNDING_DEFAULTS, ...(funding || {}) }
  const P: FlowProcurement = {
    ...PROCUREMENT_DEFAULTS,
    ...(procurement || {}),
    loan: { ...PROCUREMENT_DEFAULTS.loan, ...((procurement || {}).loan || {}) },
  }

  let financed = 0
  let aprPct = 0
  let noteMonths = 0
  let fees = 0

  // v2: gear on one order can sit on several leases, so a stock_financed order
  // carries a list of notes. v1's single `loan` is the one-entry case.
  let loans: ResolvedFunding['loans'] = []
  if (P.mode === 'stock_financed') {
    const source = P.loans && P.loans.length ? P.loans : [P.loan]
    loans = source
      .map((l) => ({ balance: num(l.balance), aprPct: num(l.aprPct), noteMonths: Math.round(num(l.monthsLeft)), label: (l as FlowLoan).label }))
      .filter((l) => l.balance > 0)
    financed = loans.reduce((s, l) => s + l.balance, 0)
    aprPct = financed > 0 ? loans.reduce((s, l) => s + l.aprPct * l.balance, 0) / financed : 0
    noteMonths = loans.reduce((m, l) => Math.max(m, l.noteMonths), 0)
  } else if (P.mode === 'new' && F.mode !== 'cash') {
    aprPct = F.aprPct == null ? DEFAULT_APR[F.mode] : num(F.aprPct)
    noteMonths = num(F.termMonths) > 0
      ? Math.round(num(F.termMonths))
      : clamp(termMonths, 24, 60)
    financed = chain.landed
    fees = (financed * num(F.feePct)) / 100
    // v2: a new purchase is one note, so it is the one-entry list.
    loans = financed > 0 ? [{ balance: financed, aprPct, noteMonths }] : []
  }

  return { funding: F, procurement: P, financed, aprPct, noteMonths, fees, loans }
}

/* ───────────────────────── the quote ───────────────────────── */

export type FlowQuoteInput = {
  items: FlowItem[]
  termMonths: number
  config?: Partial<FlowConfig>
  funding?: Partial<FlowFunding>
  procurement?: Partial<FlowProcurement>
}

export type FlowQuote = {
  chain: FlowChain
  schedule: FlowSchedule
  client: {
    firstYearMonthly: number
    laterMonthly: number
    levelMonthly: number
    averageMonthly: number
    totalPayable: number
    rollsAtMonth: number | null
    perItemFirstYear: { name: string; monthly: number }[]
  }
  economics: {
    contract: number
    hardware: number
    financeAllowance: number
    financeActual: number
    financeGap: number
    longestNoteCovered: number
    margin: number
    profit: number
    profitPerMonth: number
    marginOnContract: number
    returnOnCapital: number
  }
  cash: {
    outAtSigning: number
    notePayment: number
    netByMonth: number[]
    firstYearNet: number
    thinnestMonth: number
    atEndOfTerm: number
    netPosition: number
  }
  tail: {
    noteMonths: number
    aprPct: number
    monthsPastTerm: number
    balanceAtTermEnd: number
    interestIfLeftToRun: number
    prepaymentPenalty: number
    savingIfClearedEarly: number
    gearValueAtTermEnd: number
    gearAgeMonths: number
    usefulLifeLeft: number
  }
  inputs: {
    config: FlowConfig
    funding: FlowFunding
    procurement: FlowProcurement
    termMonths: number
  }
}

/**
 * Price an order.
 *
 * `economics.hardware` and the residual read `trueCapital` — what the gear actually
 * cost us — while the contract and the schedule read `landed`, the basis. For gear
 * bought new those are the same number and this reduces to the reference engine.
 */
export function quote(input: FlowQuoteInput): FlowQuote {
  const C: FlowConfig = { ...CONFIG_DEFAULTS, ...(input.config || {}) }
  const T = Math.max(1, Math.round(num(input.termMonths)))
  const chain = buildChain(input.items, C)
  const sched = buildSchedule(chain, T, C)
  const f = resolveFunding(input.funding, input.procurement, chain, T)

  // v2: each note (one per lease) is costed on its own terms and summed. With a
  // single note these are exactly v1's three figures.
  const pmts = f.loans.map((l) => payment(l.balance, l.aprPct, l.noteMonths))
  const notePmt = pmts.reduce((s, p) => s + p, 0)
  const interest = f.loans.reduce((s, l) => s + interestOver(l.balance, l.aprPct, l.noteMonths, T), 0)
  const loanLeft = f.loans.reduce((s, l) => s + balanceAfter(l.balance, l.aprPct, l.noteMonths, T), 0)

  /* what the money cost against what we charged for it */
  const allowance = chain.finance
  const actual = interest + f.fees
  const gap = allowance - actual

  /* the longest note the allowance stretches to, at this rate. It reads the summary
     figures (total financed, balance-weighted rate): exact for one loan, an
     approximation when several leases sit behind the order. */
  let coveredNote = 0
  if (f.financed > 0 && f.aprPct > 0) {
    for (let N = 6; N <= 120; N++) {
      if (interestOver(f.financed, f.aprPct, N, T) + f.fees <= allowance) coveredNote = N
      else break
    }
  }

  /* contract, less what the gear cost us, less what the money cost. that is it. */
  const profit = chain.contract - chain.trueCapital - actual

  /* cash */
  const cashOutAtSigning = f.procurement.mode === 'new' && f.funding.mode === 'cash'
    ? chain.landed
    : 0
  // v2: each note stops costing cash after its own last payment.
  const paidInTerm = f.loans.reduce((s, l, i) => s + pmts[i] * Math.min(l.noteMonths, T), 0)
  const cashEnd = -cashOutAtSigning - f.fees + chain.contract - paidInTerm
  const monthlyNet = sched.rates.map((r, m) => r - f.loans.reduce((s, l, i) => s + (m < l.noteMonths ? pmts[i] : 0), 0))

  /* what is left of the gear, and of the note, when the contract ends */
  const held = Math.max(0, num(f.procurement.monthsInService))
  const capital = f.procurement.mode === 'new'
    ? chain.trueCapital
    : depreciate(chain.trueCapital, held, C.deprPct)
  const endValue = depreciate(capital, T, C.deprPct)
  const ageEnd = held + T
  const lifeLeft = Math.max(0, num(C.lifeMonths) - ageEnd)

  // v2: per note — the longest tail, and what every note still has to pay.
  const monthsPastTerm = f.loans.reduce((m, l) => Math.max(m, l.noteMonths - T), 0)
  const paymentsLeft = f.loans.reduce((s, l, i) => s + pmts[i] * Math.max(0, l.noteMonths - T), 0)
  const interestLeft = Math.max(0, paymentsLeft - loanLeft)
  const penalty = f.funding.prepay === 'penalty'
    ? (loanLeft * num(f.funding.penaltyPct)) / 100
    : 0

  return {
    chain,
    schedule: sched,

    client: {
      firstYearMonthly: round2(sched.rates[0] ?? 0),
      laterMonthly: round2(sched.rates[sched.rates.length - 1] ?? 0),
      levelMonthly: round2(sched.level),
      averageMonthly: round2(chain.contract / T),
      totalPayable: round2(chain.contract),
      rollsAtMonth: sched.shaped ? sched.rollMonth + 1 : null,
      perItemFirstYear: chain.lines.map((l) => ({
        name: l.name,
        monthly: round2(l.contract / T),
      })),
    },

    economics: {
      contract: round2(chain.contract),
      hardware: round2(chain.trueCapital),
      financeAllowance: round2(allowance),
      financeActual: round2(actual),
      financeGap: round2(gap),
      longestNoteCovered: coveredNote,
      margin: round2(chain.margin),
      profit: round2(profit),
      profitPerMonth: round2(profit / T),
      marginOnContract: chain.contract > 0 ? round2((profit / chain.contract) * 100) : 0,
      returnOnCapital: chain.trueCapital > 0 ? round2((profit / chain.trueCapital) * 100) : 0,
    },

    cash: {
      outAtSigning: round2(cashOutAtSigning + f.fees),
      notePayment: round2(notePmt),
      netByMonth: monthlyNet.map(round2),
      firstYearNet: round2(monthlyNet[0] ?? 0),
      thinnestMonth: monthlyNet.length ? round2(Math.min(...monthlyNet)) : 0,
      atEndOfTerm: round2(cashEnd),
      netPosition: round2(cashEnd + endValue - loanLeft),
    },

    tail: {
      noteMonths: f.noteMonths,
      aprPct: f.aprPct,
      monthsPastTerm,
      balanceAtTermEnd: round2(loanLeft),
      interestIfLeftToRun: round2(interestLeft),
      prepaymentPenalty: round2(penalty),
      savingIfClearedEarly: round2(interestLeft - penalty),
      gearValueAtTermEnd: round2(endValue),
      gearAgeMonths: ageEnd,
      usefulLifeLeft: lifeLeft,
    },

    inputs: { config: C, funding: f.funding, procurement: f.procurement, termMonths: T },
  }
}

/* ───────────────────────── mid-term changes ───────────────────────── */

export type FlowCoTerm = {
  atMonth: number
  monthsLeft: number
  chain: FlowChain
  monthly: number
  ifOnAFreshTerm: number
  premiumPct: number
  clientRateBefore: number
  clientRateAfter: number
  marginAdded: number
  capitalNeeded: number
  advice: string
}

/**
 * The reference engine's co-term: a line added part way through, billed over the
 * months that remain, so it always costs more per month than it would on a fresh
 * term.
 *
 * Retained for fidelity with the port. The app uses quoteAddition() instead, which
 * anchors recovery to the anniversary rather than spreading to the end of the term —
 * spreading lets a late addition ride the base order's recovery for free.
 */
export function coTermAddition(
  q: FlowQuote,
  addition: { name?: string; cost: number; qty?: number; atMonth: number },
): FlowCoTerm | null {
  const T = q.inputs.termMonths
  const C = q.inputs.config
  const at = Math.round(num(addition.atMonth))
  if (num(addition.cost) <= 0 || at < 1 || at >= T) return null

  const sub = buildChain([{ name: addition.name, cost: addition.cost, qty: addition.qty }], C)
  const monthsLeft = T - at + 1
  const monthly = sub.contract / monthsLeft
  const wasRate = q.schedule.rates[at - 1]

  return {
    atMonth: at,
    monthsLeft,
    chain: sub,
    monthly: round2(monthly),
    ifOnAFreshTerm: round2(sub.contract / T),
    premiumPct: round2((monthly / (sub.contract / T) - 1) * 100),
    clientRateBefore: round2(wasRate),
    clientRateAfter: round2(wasRate + monthly),
    marginAdded: round2(sub.margin),
    capitalNeeded: round2(sub.landed),
    advice: monthsLeft < 6
      ? 'Too few months left to bill it over. Start a fresh term for this line.'
      : 'Co-terming is sound at this point in the contract.',
  }
}

export type FlowEarlyReturn = {
  atMonth: number
  settlementPct: number
  billedToDate: number
  contractRemaining: number
  settlementDue: number
  forgone: number
  collectedTotal: number
  cashInHand: number
  gearBackWorth: number
  noteOutstanding: number
  ourPosition: number
  positionIfFullTerm: number
  difference: number
  breakEvenSettlementPct: number
}

/**
 * Price an early return: they hand the gear back at `atMonth` and settle a share of
 * the contract that is left.
 *
 * `ourPosition` and `positionIfFullTerm` are on the same basis — cash plus the gear
 * that comes back, less what is still owed — so the two compare honestly. Comparing
 * an early exit against full-term profit would ignore the returned hardware and make
 * every exit look like a windfall.
 */
export function earlyReturn(
  q: FlowQuote,
  exit: { atMonth: number; settlementPct?: number },
): FlowEarlyReturn | null {
  const T = q.inputs.termMonths
  const C = q.inputs.config
  const P = q.inputs.procurement
  const at = Math.round(num(exit.atMonth))
  const pct = clamp(num(exit.settlementPct == null ? 50 : exit.settlementPct), 0, 100)
  if (at < 1 || at >= T) return null

  const billed = q.schedule.rates.slice(0, at).reduce((a, b) => a + b, 0)
  const remaining = q.chain.contract - billed
  const settlement = (remaining * pct) / 100
  const collected = billed + settlement

  const f = resolveFunding(q.inputs.funding, P, q.chain, T)
  const notePmt = payment(f.financed, f.aprPct, f.noteMonths)
  const noteMonths = Math.min(f.noteMonths, at)
  const cashOut = P.mode === 'new' && f.funding.mode === 'cash' ? q.chain.landed : 0
  const cash = -cashOut - f.fees + collected - notePmt * noteMonths
  const balance = balanceAfter(f.financed, f.aprPct, f.noteMonths, at)

  const held = Math.max(0, num(P.monthsInService))
  const capital = P.mode === 'new'
    ? q.chain.trueCapital
    : depreciate(q.chain.trueCapital, held, C.deprPct)
  const gear = depreciate(capital, at, C.deprPct)

  const position = cash + gear - balance
  const full = q.cash.netPosition
  const shortfall = full - position

  return {
    atMonth: at,
    settlementPct: pct,
    billedToDate: round2(billed),
    contractRemaining: round2(remaining),
    settlementDue: round2(settlement),
    forgone: round2(remaining - settlement),
    collectedTotal: round2(collected),
    cashInHand: round2(cash),
    gearBackWorth: round2(gear),
    noteOutstanding: round2(balance),
    ourPosition: round2(position),
    positionIfFullTerm: round2(full),
    difference: round2(-shortfall),
    breakEvenSettlementPct: remaining > 0
      ? round2(clamp(((settlement + shortfall) / remaining) * 100, 0, 100))
      : 100,
  }
}

/* ───────────────────────── choosing a note ───────────────────────── */

export type FlowNoteRow = {
  noteMonths: number
  clientMonthly: number
  ourPayment: number
  interest: number
  vsAllowance: number
  keptEachMonth: number
  owedAtTermEnd: number
  profit: number
  quote: FlowQuote
}

/**
 * Re-price the same order across a set of note lengths. The client pays the same in
 * every row — only what we owe the lender moves. `best` is the most profitable length
 * that both covers the financing allowance and stays cash-positive, falling back to
 * the most profitable if none do.
 *
 * Not surfaced in the app: "how long should we take this money over" is a funding
 * question, not an order one.
 */
export function compareNoteTerms(
  input: FlowQuoteInput,
  lengths: number[] = [24, 36, 48, 60],
): { rows: FlowNoteRow[]; best: FlowNoteRow } {
  const rows: FlowNoteRow[] = lengths.map((N) => {
    const q = quote({ ...input, funding: { ...input.funding, termMonths: N } as Partial<FlowFunding> })
    return {
      noteMonths: N,
      clientMonthly: q.client.firstYearMonthly,
      ourPayment: q.cash.notePayment,
      interest: q.economics.financeActual,
      vsAllowance: q.economics.financeGap,
      keptEachMonth: q.cash.firstYearNet,
      owedAtTermEnd: q.tail.balanceAtTermEnd,
      profit: q.economics.profit,
      quote: q,
    }
  })
  const clean = rows.filter((r) => r.vsAllowance >= 0 && r.keptEachMonth >= 0)
  const pool = clean.length ? clean : rows
  const best = pool.reduce((a, r) => (r.profit > a.profit ? r : a))
  return { rows, best }
}

/* ───────────────────────── portfolio ───────────────────────── */

export type FlowPortfolio = {
  dealsStarted: number
  peakConcurrent: number
  worstCash: number
  worstCashMonth: number
  endingCash: number
  creditPerDeal: number
  capacity: {
    creditLine: number
    concurrentDeals: number
    dealsPerYear: number
    profitPerYear: number
  } | null
  series: { month: number; live: number; cash: number }[]
}

/**
 * Run the same deal repeatedly and watch the cash: how much credit a book of these
 * consumes, where cash troughs, and what a line of a given size can carry.
 *
 * Not surfaced in the app until there is a book of Flow deals to run it against.
 */
export function portfolio(
  input: FlowQuoteInput,
  opts: {
    everyMonths?: number
    horizonMonths?: number
    stopSellingAfter?: number
    creditLine?: number
  } = {},
): FlowPortfolio {
  const every = Math.max(1, Math.round(num(opts.everyMonths || 1)))
  const horizon = Math.max(1, Math.round(num(opts.horizonMonths || 60)))
  const stop = num(opts.stopSellingAfter) || horizon
  const q = quote(input)
  const T = q.inputs.termMonths

  let cash = 0
  let worst = 0
  let worstMonth = 0
  let started = 0
  let peakLive = 0
  const starts: number[] = []
  const series: { month: number; live: number; cash: number }[] = []

  for (let m = 1; m <= horizon; m++) {
    if (m <= stop && (m - 1) % every === 0) {
      starts.push(m)
      started++
      cash -= q.cash.outAtSigning
    }
    let live = 0
    for (const s of starts) {
      const age = m - s + 1
      if (age >= 1 && age <= T) {
        cash += q.cash.netByMonth[age - 1]
        live++
      }
    }
    peakLive = Math.max(peakLive, live)
    if (cash < worst) {
      worst = cash
      worstMonth = m
    }
    series.push({ month: m, live, cash: round2(cash) })
  }

  // The credit a deal actually draws is the capital financed — chain.landed, the
  // basis resolveFunding() lends against (financed = chain.landed for a 'new'
  // procurement) — not q.economics.hardware, which now reads trueCapital: what we
  // actually paid. Those two diverge sharply once a trueCost split is in play, and
  // it is the basis, not the true cost, that sizes how many deals a credit line can
  // carry.
  const creditPerDeal = q.chain.landed
  const line = num(opts.creditLine)
  const concurrent = line > 0 ? Math.floor(line / creditPerDeal) : null
  const noteMonths = q.tail.noteMonths || T

  return {
    dealsStarted: started,
    peakConcurrent: peakLive,
    worstCash: round2(worst),
    worstCashMonth: worstMonth,
    endingCash: round2(cash),
    creditPerDeal: round2(creditPerDeal),
    capacity: concurrent == null ? null : {
      creditLine: line,
      concurrentDeals: concurrent,
      dealsPerYear: round2(concurrent * (12 / noteMonths)),
      profitPerYear: round2(concurrent * (12 / noteMonths) * q.economics.profit),
    },
    series,
  }
}

/* ───────────────────────── anniversary-anchored scheduling ───────────────────────── */

export type FlowOrderScheduleRow = {
  /** 1-based month of the term. */
  month: number
  /** 1-based 12-month cycle the month falls in. */
  cycle: number
  rate: number
  cumulative: number
  remaining: number
  /** True when this month's rate differs from the previous month's. */
  isStep: boolean
}

export type FlowOrderSchedule = {
  termMonths: number
  contract: number
  rows: FlowOrderScheduleRow[]
  /** Months at which the rate changes. Month 1 always counts as a step. */
  steps: number[]
  /**
   * The rate billed in a given month, by 1-based month number. Returns 0 for any
   * month outside 1..termMonths, including NaN — it does not clamp to the first or
   * last month's rate, so callers cannot mistake an out-of-range lookup for a real
   * charge.
   */
  rateForMonth: (month: number) => number
  /**
   * False when the contract is non-positive, or when some line's addedAtMonth falls
   * outside 1..termMonths — there is then no honest month to bill that capital in,
   * even though the month gets clamped into range for the purpose of shaping a
   * schedule at all.
   *
   * An unreachable recoverByMonth no longer makes a schedule infeasible: it falls
   * through to a level rate (contract ÷ months left) instead of front-loading to a
   * cap, exactly as buildSchedule() does — so a positive-contract, in-range schedule
   * is always feasible now.
   *
   * CALLERS MUST CHECK THIS before presenting or invoicing off the schedule.
   */
  feasible: boolean
}

/**
 * The schedule the app bills from.
 *
 * Unrecovered capital must be billed back by the next 12-month anniversary of the
 * order. After each anniversary the rate steps down to residual. The whole order
 * re-solves to one blended rate; individual lines do not carry their own spikes.
 *
 * At each solve point — month 1, each anniversary, each addition month:
 *
 *     recoveryRate = outstanding capital ÷ months until the recover target
 *     levelRate    = remaining contract  ÷ months left in the term
 *     rate         = max(recoveryRate, levelRate), capped by what the hold can collect
 *
 * Taking the HIGHER of the two is what makes an addition always raise the rate.
 * Recovery alone would let a cycle-two addition lower it: the base gear is already
 * recovered by then, so a recovery-only rate would bill the new capital while
 * quietly deferring the base's remaining contract into the following cycle.
 *
 * Recovery targets `landed` — the basis — not `trueCapital`. Recovering market value
 * is what pays for the replacement; recovering historical cost on old gear would
 * produce a front rate that undercuts the offering.
 *
 * With no additions this reduces to buildSchedule() for terms that are a whole
 * number of 12-month cycles, or comfortably past one — verified for 12, 18, 20, 24,
 * 36 and 60. It does NOT for terms of 13–17 months: there, levelRate exceeds the
 * front rate, so this function bills level throughout, where buildSchedule() would
 * bill flat for a year and then balloon the final months. This function's answer is
 * the better one, but quote() still reports buildSchedule()'s shape — so those
 * terms are quoted and billed differently and must be reconciled before any such
 * term is offered.
 *
 * When recoverByMonth cannot be reached inside a cycle (outside minRecoverMonth..12,
 * or 0/unset), recovery is ignored for that cycle rather than front-loaded to
 * whatever cap is reachable — the schedule falls through to a level rate, matching
 * buildSchedule()'s own fallback. Front-loading a target that was never reachable
 * used to bill a client months of $0 they were never quoted; a level rate at least
 * agrees with what buildSchedule() would have quoted for the same input.
 *
 * A non-positive contract, and a line whose addedAtMonth falls outside the term, are
 * rejected upstream, not here — this function only sets `feasible` false for either
 * so a caller that skips that check still cannot invoice off it.
 */
export function buildFlowSchedule(
  items: FlowItem[],
  termMonths: number,
  config?: Partial<FlowConfig>,
): FlowOrderSchedule {
  const C: FlowConfig = { ...CONFIG_DEFAULTS, ...(config || {}) }
  const T = Math.max(1, Math.round(num(termMonths)))
  const chain = buildChain(items, C)

  const minRecover = chain.contract > 0
    ? Math.ceil((CYCLE_MONTHS * chain.landed) / chain.contract)
    : 1
  const asked = Math.round(num(C.recoverByMonth))
  // An unreachable or unset target is ignored rather than front-loaded, exactly as
  // buildSchedule does — otherwise an order would be quoted level and billed
  // front-loaded. `asked` of 0 means "level", which is the reference's meaning.
  const shaped = asked >= minRecover && asked <= CYCLE_MONTHS && chain.landed > 0
  // Only meaningful when shaped — see the recoveryRate gate in the loop below, which
  // is what actually keeps an unreachable target from being consulted.
  const roi = shaped ? asked : CYCLE_MONTHS

  const lines = chain.lines.map((l) => ({
    from: clamp(l.addedAtMonth == null ? 1 : l.addedAtMonth, 1, T),
    landed: l.landed,
    contract: l.contract,
  }))

  // A line added outside the term gets clamped into range above so the schedule can
  // still be shaped, but there is no honest month to bill it in — flagged here
  // rather than silently balloon-billing it wherever it lands.
  const anyOutOfRange = chain.lines.some(
    (l) => l.addedAtMonth != null && (l.addedAtMonth < 1 || l.addedAtMonth > T),
  )

  // A month-13 step % fixes both rates up front. Only for orders with no mid-term
  // additions — an addition re-solves the remaining contract, which the % does not
  // define, so those keep the recoverByMonth solver.
  const step = lines.some((l) => l.from > 1) ? null : stepRates(chain.contract, T, C.stepPct)

  let capitalRemaining = 0
  let contractRemaining = 0
  let rate = 0
  let holdUntil = 0
  // A non-positive contract cannot be billed back by any spread; flagged here so a
  // caller that skips the upstream check still cannot invoice off this.
  let feasible = chain.contract > 0 && !anyOutOfRange

  const contractRounded = round2(chain.contract)
  const rows: FlowOrderScheduleRow[] = []
  let cumulative = 0
  let previousCumulative = 0
  let previousRate = Number.NaN

  for (let m = 1; m <= T; m++) {
    let arrived = false
    for (const l of lines) {
      if (l.from === m) {
        capitalRemaining += l.landed
        contractRemaining += l.contract
        arrived = true
      }
    }

    if (step) {
      rate = m <= CYCLE_MONTHS ? step.front : step.back
    } else if (m > holdUntil || arrived) {
      const cycleEnd = Math.min(Math.ceil(m / CYCLE_MONTHS) * CYCLE_MONTHS, T)
      const cycleStart = Math.floor((m - 1) / CYCLE_MONTHS) * CYCLE_MONTHS + 1
      // The recover target inside this cycle. If it has already passed, recovery
      // falls to the anniversary instead of demanding an impossible catch-up.
      // Strictly `<`: an addition landing exactly on the target month still recovers
      // that month rather than being deferred a whole cycle.
      let recoverTarget = cycleStart - 1 + roi
      if (recoverTarget < m) recoverTarget = cycleEnd
      recoverTarget = Math.min(recoverTarget, cycleEnd)

      const monthsHeld = Math.max(1, cycleEnd - m + 1)
      const monthsToRecover = Math.max(1, recoverTarget - m + 1)
      const monthsLeft = Math.max(1, T - m + 1)

      const recoveryRate = shaped && capitalRemaining > 0 ? capitalRemaining / monthsToRecover : 0
      const levelRate = contractRemaining > 0 ? contractRemaining / monthsLeft : 0
      // The most the hold can collect. monthsHeld <= monthsLeft always, so this is
      // never below levelRate.
      const cap = contractRemaining > 0 ? contractRemaining / monthsHeld : 0

      // Defensive backstop: the `shaped` gate above already keeps an unreachable
      // recoverByMonth from being asked for at all, so this should not fire for a
      // positive contract in range — but if a future change to the per-solve-point
      // math ever asks recovery to outrun what the hold can bear, this still catches
      // it rather than silently over-collecting.
      if (recoveryRate > cap + 1e-7) feasible = false
      rate = Math.max(0, Math.min(Math.max(recoveryRate, levelRate), cap))

      // An addition must never reduce what the client is already paying. A
      // re-solve otherwise can: when recovery completed early in this cycle the
      // held rate is deliberately over-collecting, and re-spreading throws that
      // away. Floored at the held rate, capped so the hold still cannot collect
      // more than the contract has left.
      if (arrived && !Number.isNaN(previousRate)) {
        rate = Math.max(rate, Math.min(previousRate, cap))
      }

      holdUntil = cycleEnd
    }

    capitalRemaining = Math.max(0, capitalRemaining - rate)
    contractRemaining -= rate
    cumulative += rate

    // Bill whole cents that still sum to the contract exactly.
    //
    // Rounding each rate on its own drifts. A repeating rate like 4286.333… rounds
    // DOWN every month of a flat hold, so the shortfall compounds instead of
    // cancelling — 12¢ short across a 36-month term on the pinned deal. Deriving
    // each row from the rounded running total makes the rows telescope: the final
    // cumulative is round2(contract) by construction, the last row absorbs the
    // residual cent, and Σ(rate) equals the contract to the penny.
    const cumulativeRounded = round2(cumulative)
    const rowRate = round2(cumulativeRounded - previousCumulative)

    rows.push({
      month: m,
      cycle: Math.floor((m - 1) / CYCLE_MONTHS) + 1,
      rate: rowRate,
      cumulative: cumulativeRounded,
      remaining: round2(contractRounded - cumulativeRounded),
      // Compared on the UNROUNDED solver rate: a one-cent true-up inside a flat
      // hold is not a step, and must not be reported as one.
      isStep: Number.isNaN(previousRate) || Math.abs(rate - previousRate) > 0.005,
    })
    previousCumulative = cumulativeRounded
    previousRate = rate
  }

  return {
    termMonths: T,
    contract: round2(chain.contract),
    rows,
    steps: rows.filter((r) => r.isStep).map((r) => r.month),
    rateForMonth: (month: number) => {
      const m = Math.round(num(month))
      return m >= 1 && m <= T ? (rows[m - 1]?.rate ?? 0) : 0
    },
    feasible,
  }
}

/* ───────────────────────── quoting an addition ───────────────────────── */

export type FlowAdditionOption = {
  kind: 'this_anniversary' | 'next_anniversary' | 'fresh_order'
  label: string
  /** The month from which this option changes what the client pays. */
  effectiveFromMonth: number
  /** The month by which the added capital is billed back. */
  recoversByMonth: number
  /** The order's rate from effectiveFromMonth once this option is taken. */
  rateAfter: number
  /** The order's rate in that same month as things stand. Zero for a fresh order. */
  rateBefore: number
  /** rateAfter ÷ rateBefore. Reported for context, never used as a guard. */
  stepMultiple: number
  marginAdded: number
  capitalAdded: number
  /** feasible flag of the schedule this option itself resolves to. See buildFlowSchedule(). */
  feasible: boolean
}

export type FlowAdditionQuote = {
  atMonth: number
  monthsToAnniversary: number
  options: FlowAdditionOption[]
  recommended: FlowAdditionOption['kind'] | null
  advice: string
}

/** Fewer months than this to the anniversary and the recovery spike is worth flagging. */
export const ADDITION_ADVISORY_MONTHS = 6

/**
 * Price gear added part way through a live Flow order.
 *
 * Returns all three outcomes rather than picking one: recover by the next
 * anniversary, roll recovery to the one after, or start a fresh order. Each carries
 * its resulting rate, the step against the current rate, and the margin it adds.
 *
 * There is deliberately no cap on the step multiple. A client who doubles their gear
 * should see the rate roughly double; a cap would refuse legitimate additions. The
 * step is a symptom — months remaining to the anniversary is the cause, and that is
 * what the advisory reads.
 */
export function quoteAddition(
  items: FlowItem[],
  termMonths: number,
  addition: { name?: string; cost: number; qty?: number; trueCost?: number; atMonth: number },
  config?: Partial<FlowConfig>,
): FlowAdditionQuote {
  const C: FlowConfig = { ...CONFIG_DEFAULTS, ...(config || {}) }
  const T = Math.max(1, Math.round(num(termMonths)))
  const at = Math.round(num(addition.atMonth))
  const cycleEnd = Math.min(Math.ceil(at / CYCLE_MONTHS) * CYCLE_MONTHS, T)
  const monthsToAnniversary = Math.max(0, cycleEnd - at + 1)

  if (num(addition.cost) <= 0 || at < 1 || at >= T) {
    return { atMonth: at, monthsToAnniversary, options: [], recommended: null,
      advice: 'That month falls outside the term.' }
  }

  const line: FlowItem = {
    name: addition.name, cost: addition.cost, qty: addition.qty, trueCost: addition.trueCost,
  }
  const sub = buildChain([line], C)
  const marginAdded = round2(sub.margin)
  const capitalAdded = round2(sub.landed)
  const base = buildFlowSchedule(items, T, C)

  // The base order's own schedule must be feasible before quoting anything against
  // it — after FIX 1 that only fails for a non-positive contract or a line already
  // outside the term, but either way there is no honest rate to co-term onto.
  if (!base.feasible) {
    return {
      atMonth: at,
      monthsToAnniversary,
      options: [],
      recommended: null,
      advice: 'The base order cannot be scheduled as it stands, so no addition can be priced against it.',
    }
  }

  const deferredFrom = Math.min(cycleEnd + 1, T)
  const deferredCycleEnd = Math.min(Math.ceil(deferredFrom / CYCLE_MONTHS) * CYCLE_MONTHS, T)
  // How much cycle is actually left to defer into. When the addition lands in the
  // final cycle this collapses to 1 (or less), which would balloon-bill the whole
  // addition in a single month — see the deferIsUseful gate below, which drops
  // next_anniversary from the options entirely rather than merely warning about it.
  const deferredWindow = deferredCycleEnd - deferredFrom + 1

  const option = (
    kind: FlowAdditionOption['kind'],
    label: string,
    effectiveFromMonth: number,
    recoversByMonth: number,
    scheduleItems: FlowItem[],
    rateBefore: number,
  ): FlowAdditionOption => {
    const built = buildFlowSchedule(scheduleItems, T, C)
    const rateAfter = built.rateForMonth(effectiveFromMonth)
    return {
      kind,
      label,
      effectiveFromMonth,
      recoversByMonth,
      rateAfter,
      rateBefore,
      stepMultiple: rateBefore > 0 ? round2(rateAfter / rateBefore) : 0,
      marginAdded,
      capitalAdded,
      feasible: built.feasible,
    }
  }

  const deferIsUseful = deferredWindow >= ADDITION_ADVISORY_MONTHS

  const options: FlowAdditionOption[] = [
    // Straight in: recovery lands inside the current cycle.
    option('this_anniversary', `Recover by month ${cycleEnd}`, at, cycleEnd,
      [...items, { ...line, addedAtMonth: at }], base.rateForMonth(at)),
    // Deferred a cycle: the line simply enters after the anniversary, so the solve
    // falls through to the following one. The order's own config is untouched.
    // Omitted entirely — not merely flagged — when there is no useful cycle left to
    // defer into (deferredWindow < ADDITION_ADVISORY_MONTHS): otherwise this option
    // can collapse to a single month and balloon-bill the whole addition there,
    // while the "sound at this point in the contract" advice for this_anniversary
    // still reads as if nothing were wrong.
    ...(deferIsUseful
      ? [option('next_anniversary', `Recover by month ${deferredCycleEnd}`, deferredFrom, deferredCycleEnd,
          [...items, { ...line, addedAtMonth: deferredFrom }], base.rateForMonth(deferredFrom))]
      : []),
    // Its own term, from scratch. Not a step on this order, so rateBefore is zero.
    option('fresh_order', `Fresh ${T}-month order`, 1, Math.min(CYCLE_MONTHS, T),
      [{ ...line, addedAtMonth: null }], 0),
  ]

  // Every remaining option is always available — recovery anchored to an
  // anniversary can never ask for more than the contract has left, because capital
  // is always less than contract. The advisory is about what reads well to a
  // client, not what the maths permits, so it steers rather than blocks.
  let recommended: FlowAdditionOption['kind']
  let advice: string

  if (monthsToAnniversary < ADDITION_ADVISORY_MONTHS) {
    // deferredFrom > at is always true by construction: cycleEnd >= at, and the early
    // boundary return ensures at < T, so deferredFrom = Math.min(cycleEnd + 1, T) > at.
    // deferIsUseful (computed above, and used there to decide whether next_anniversary
    // is even offered) is reused here so the recommendation can never point at an
    // option that was omitted.
    recommended = deferIsUseful ? 'next_anniversary' : 'fresh_order'
    advice = `Only ${monthsToAnniversary} month${monthsToAnniversary === 1 ? '' : 's'} to the `
      + 'anniversary, so recovering by then spikes the rate. '
      + (deferIsUseful
        ? 'Deferring a cycle will read better to the client.'
        : 'There is no useful cycle left to defer into — start a fresh order for this gear.')
  } else {
    recommended = 'this_anniversary'
    advice = 'Co-terming to this anniversary is sound at this point in the contract.'
  }

  return { atMonth: at, monthsToAnniversary, options, recommended, advice }
}
