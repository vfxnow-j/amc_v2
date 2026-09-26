import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChain,
  buildSchedule,
  quote,
  coTermAddition,
  earlyReturn,
  compareNoteTerms,
  portfolio,
  buildFlowSchedule,
  quoteAddition,
  CYCLE_MONTHS,
  type FlowConfig,
  type FlowItem,
  type FlowQuoteInput,
} from './flow'

/**
 * Figures pinned to the deal the pricing was designed against:
 * 2 × $25,718 workstations, bought for resale, financed at 8%.
 */
const ITEMS: FlowItem[] = [{ name: '4U Threadripper 3970X / RTX 4090', cost: 25718, qty: 2 }]
const CONFIG: Partial<FlowConfig> = {
  marginPct: 40, financePct: 10, taxPct: 9.75, exempt: true, recoverByMonth: 12,
}

const near = (got: number, want: number, tol = 0.01, context?: string) =>
  assert.ok(Math.abs(got - want) <= tol, `got ${got}, want ${want}${context ? ` (${context})` : ''}`)

test('chain: cost + 10% financing + 40% margin', () => {
  const chain = buildChain(ITEMS, CONFIG)
  near(chain.cost, 51436)
  near(chain.tax, 0)              // bought for resale
  near(chain.finance, 5143.6)
  near(chain.margin, 20574.4)
  near(chain.contract, 77154)
  assert.equal(chain.units, 2)
})

test('chain: tax applies when we are not exempt', () => {
  const taxed = buildChain(ITEMS, { ...CONFIG, exempt: false })
  near(taxed.landed, 51436 * 1.0975)
  near(taxed.margin, 51436 * 1.0975 * 0.4)  // margin is taken on the landed cost
})

test('chain: trueCapital defaults to landed, so absent trueCost changes nothing', () => {
  near(buildChain(ITEMS, CONFIG).trueCapital, 51436)
  near(buildChain(ITEMS, { ...CONFIG, exempt: false }).trueCapital, 51436 * 1.0975)
})

test('chain: trueCost overrides what we paid without moving the contract', () => {
  const cheap = buildChain([{ ...ITEMS[0], trueCost: 18000 }], CONFIG)
  near(cheap.contract, 77154)     // contract comes off the basis, untouched
  near(cheap.trueCapital, 36000)  // 18000 × 2
})

test('chain: a missing quantity counts as one', () => {
  near(buildChain([{ cost: 1000 }], CONFIG).cost, 1000)
})

test('schedule: year one flat, rolls on the anniversary', () => {
  const chain = buildChain(ITEMS, CONFIG)
  const s = buildSchedule(chain, 24, CONFIG)
  assert.equal(s.shaped, true)
  near(s.frontRate, 51436 / 12)                          // recovers cost by month 12
  near(s.backRate, (77154 - (51436 / 12) * 12) / 12)
  assert.ok(s.rates[11] !== s.rates[12])                 // the rate changes at month 13
  assert.equal(s.paybackMonth, 12)
  near(s.years[0].annual, 51436)
  near(s.years[1].annual, 77154 - 51436)
  assert.ok(s.years.every((y) => !y.changesMidYear))
})

test('schedule: the whole contract is billed, whatever the shape', () => {
  const chain = buildChain(ITEMS, CONFIG)
  for (const recoverByMonth of [6, 9, 12]) {
    const sc = buildSchedule(chain, 24, { ...CONFIG, recoverByMonth })
    near(sc.rates.reduce((a, b) => a + b, 0), 77154)
  }
})

test('schedule: a one-year term cannot be shaped', () => {
  const oneYear = buildSchedule(buildChain(ITEMS, CONFIG), 12, CONFIG)
  assert.equal(oneYear.shaped, false)
  near(oneYear.frontRate, 77154 / 12)
})

const BASE: FlowQuoteInput = {
  items: ITEMS,
  termMonths: 24,
  config: CONFIG,
  funding: { mode: 'loan', aprPct: 8, termMonths: 24, feePct: 0 },
  procurement: { mode: 'new' },
}

test('quote: 2 years, 24-month note at 8%', () => {
  const q = quote(BASE)
  const chain = buildChain(ITEMS, CONFIG)
  near(q.client.firstYearMonthly, 4286.33)
  near(q.client.laterMonthly, 2143.17)
  near(q.client.totalPayable, 77154)
  near(q.economics.financeActual, 4394.53, 1)
  assert.ok(q.economics.financeGap > 0)
  near(q.economics.profit, chain.margin + q.economics.financeGap, 1)
  near(q.economics.profit, 21323.07, 1)
  near(q.cash.notePayment, 2326.31, 1)
  near(q.cash.firstYearNet, 4286.33 - 2326.31, 1)
  near(q.tail.balanceAtTermEnd, 0, 1)
})

test('quote: cash keeps the whole financing allowance', () => {
  const chain = buildChain(ITEMS, CONFIG)
  const q = quote({ ...BASE, funding: { mode: 'cash' } })
  near(q.economics.financeActual, 0)
  near(q.economics.profit, chain.margin + chain.finance, 1)
  near(q.cash.outAtSigning, 51436)
})

test('quote: a long note overruns the allowance', () => {
  const chain = buildChain(ITEMS, CONFIG)
  const q = quote({ ...BASE, funding: { mode: 'loan', aprPct: 8, termMonths: 60 } })
  assert.ok(q.economics.financeGap < 0)
  assert.ok(q.economics.profit < chain.margin)
  assert.ok(q.tail.balanceAtTermEnd > 0)
  assert.ok(q.economics.longestNoteCovered >= 28 && q.economics.longestNoteCovered <= 30)
})

test('quote: gear we already own carries no fresh outlay', () => {
  const fresh = quote(BASE)
  const owned = quote({
    ...BASE,
    funding: { mode: 'cash' },
    procurement: { mode: 'stock_owned', monthsInService: 18 },
  })
  near(owned.cash.outAtSigning, 0)
  assert.ok(owned.tail.gearValueAtTermEnd < fresh.tail.gearValueAtTermEnd)
})

test('quote: trueCost moves profit and residual, never the contract', () => {
  const dearer = quote({ ...BASE, items: [{ ...ITEMS[0], trueCost: 20000 }] })
  const plain = quote(BASE)
  near(dearer.client.totalPayable, plain.client.totalPayable)
  assert.ok(dearer.economics.profit > plain.economics.profit)  // it cost us less
  near(dearer.economics.hardware, 40000)
  assert.ok(dearer.tail.gearValueAtTermEnd < plain.tail.gearValueAtTermEnd)
})

test('guards: bad input does not throw', () => {
  near(quote({ items: [], termMonths: 24 }).economics.contract, 0)
  assert.equal(quote({ items: ITEMS, termMonths: 0 }).inputs.termMonths, 1)
  assert.ok(quote({ items: [{ cost: -100, qty: 1 }], termMonths: 12 }).client.totalPayable <= 0)
})

test('co-term: an add-on bills over the months that are left', () => {
  const q = quote(BASE)
  const add = coTermAddition(q, { cost: 12000, qty: 1, atMonth: 14 })
  assert.ok(add)
  assert.equal(add.monthsLeft, 11)
  near(add.chain.contract, 18000)
  near(add.monthly, 18000 / 11, 0.02)
  assert.ok(add.premiumPct > 0)
  near(add.clientRateAfter, add.clientRateBefore + add.monthly, 0.02)
  assert.equal(coTermAddition(q, { cost: 9000, atMonth: 30 }), null)
})

test('co-term: too late to be sensible', () => {
  const late = coTermAddition(quote(BASE), { cost: 12000, qty: 1, atMonth: 22 })
  assert.ok(late && /fresh term/.test(late.advice))
})

test('early return: 50% of the remainder at month 15', () => {
  const q = quote(BASE)
  const ex = earlyReturn(q, { atMonth: 15, settlementPct: 50 })
  assert.ok(ex)
  near(ex.billedToDate, q.schedule.rates.slice(0, 15).reduce((a, b) => a + b, 0), 0.02)
  near(ex.settlementDue, ex.contractRemaining / 2, 0.02)
  // Compared on the same basis as the full term: cash plus the gear that comes
  // back, less what is still owed. Comparing against profit would ignore the
  // returned hardware and make every exit look like a windfall.
  near(ex.positionIfFullTerm, q.cash.netPosition, 0.02)
  assert.ok(ex.breakEvenSettlementPct > 0)
  const full = earlyReturn(q, { atMonth: 15, settlementPct: 100 })
  assert.ok(full && full.difference >= ex.difference)
})

test('compareNoteTerms: the client pays the same in every row', () => {
  const cmp = compareNoteTerms(BASE)
  const rates = cmp.rows.map((r) => r.clientMonthly)
  assert.ok(rates.every((r) => Math.abs(r - rates[0]) < 0.01))
  assert.ok(cmp.rows[cmp.rows.length - 1].interest > cmp.rows[0].interest)
  assert.ok(cmp.best && cmp.best.noteMonths > 0)
})

test('portfolio: financed deals need no capital to start', () => {
  const pf = portfolio(BASE, { everyMonths: 1, horizonMonths: 60, creditLine: 500000 })
  assert.equal(pf.dealsStarted, 60)
  assert.ok(pf.worstCash >= 0)
  assert.ok(pf.endingCash > 0)
  near(pf.creditPerDeal, 51436)
  assert.equal(pf.capacity?.concurrentDeals, 9)
})

test('portfolio: cash purchases need a trough', () => {
  const pf = portfolio({ ...BASE, funding: { mode: 'cash' } }, { everyMonths: 1, horizonMonths: 60 })
  assert.ok(pf.worstCash < -100000)
  assert.ok(pf.endingCash > 0)
})

test('portfolio: creditPerDeal is the capital financed, not trueCost', () => {
  // economics.hardware now reads trueCapital — what we actually paid — while the
  // credit a deal actually draws against the line is chain.landed, the basis
  // resolveFunding() lends against. With a trueCost well below cost these two
  // diverge sharply, and creditPerDeal must still report the basis: reporting
  // trueCost here understates how much credit a book of these deals consumes.
  const cheapItems: FlowItem[] = [{ ...ITEMS[0], trueCost: 5000 }]
  const chain = buildChain(cheapItems, CONFIG)
  assert.ok(chain.trueCapital < chain.landed)   // the split this test exists to catch
  const pf = portfolio({ ...BASE, items: cheapItems }, { everyMonths: 1, horizonMonths: 12, creditLine: 500000 })
  near(pf.creditPerDeal, chain.landed)
})

const sumRates = (s: { rows: { rate: number }[] }) => s.rows.reduce((a, r) => a + r.rate, 0)

/**
 * Tolerance for "these two rates are the same rate".
 *
 * Rows telescope off the rounded running total so the schedule sums to the
 * contract exactly, which means one month of an otherwise flat hold legitimately
 * lands a penny apart. A tolerance of exactly 0.01 sits on a float boundary —
 * `5715.12 - 5715.11` is 0.010000000000218 in IEEE-754 — so it must be wider than
 * a penny, not equal to one. Flatness itself is proved structurally by `steps`;
 * these comparisons only catch something larger moving.
 */
const PENNY = 0.015

test('flow schedule: with no additions it reproduces the ported shaping exactly', () => {
  for (const T of [24, 36, 60]) {
    const ported = buildSchedule(buildChain(ITEMS, CONFIG), T, CONFIG)
    const flow = buildFlowSchedule(ITEMS, T, CONFIG)
    assert.equal(flow.rows.length, T)
    for (let m = 1; m <= T; m++) near(flow.rateForMonth(m), ported.rates[m - 1], PENNY)
  }
})

test('flow schedule: the whole contract is billed — the revenue invariant', () => {
  const chain = buildChain(ITEMS, CONFIG)
  for (const recoverByMonth of [1, 4, 6, 9, 12]) {
    const s = buildFlowSchedule(ITEMS, 36, { ...CONFIG, recoverByMonth })
    near(sumRates(s), chain.contract, 0.02)
  }
})

test('flow schedule: an addition still bills the whole contract, at any month', () => {
  for (const atMonth of [2, 6, 11, 14, 23, 30]) {
    const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: atMonth }]
    const s = buildFlowSchedule(items, 36, CONFIG)
    near(sumRates(s), buildChain(items, CONFIG).contract, 0.02)
  }
})

test('flow schedule: rates step at anniversaries and addition months, nowhere else', () => {
  for (const recoverByMonth of [1, 6, 12]) {
    const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: 6 }]
    const s = buildFlowSchedule(items, 36, { ...CONFIG, recoverByMonth })
    const allowed = new Set([1, 6, 13, 25])
    for (const m of s.steps) assert.ok(allowed.has(m), `unexpected step at month ${m}`)
  }

  // A subset check alone would pass for steps = [] or steps = [1]. Confirm month 1
  // and the addition month actually register as steps, for a representative
  // (feasible) configuration. recoverByMonth: 1 is deliberately excluded here: it is
  // so aggressive that month 1 is already capped at the most the whole first cycle
  // can bear, and the FIX-1 floor (an addition must never lower the rate) then holds
  // month 6 at that same capped rate — a legitimate zero-step outcome, not a bug.
  const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: 6 }]
  const s = buildFlowSchedule(items, 36, CONFIG)
  assert.ok(s.steps.includes(1), 'month 1 must be a step')
  assert.ok(s.steps.includes(6), 'the addition month must be a step')
})

test('flow schedule: an addition never lowers the rate', () => {
  // Swept across recoverByMonth too: the default (12) never surfaces the defect
  // where an addition can lower the rate, because recovery holds to the anniversary
  // exactly when it completes. Shorter recovery windows are where a re-solve can
  // throw away an over-collection unless it is floored at the held rate.
  //
  // The floor only matters in the months just past the in-cycle recovery target,
  // once recovery has already completed and the held rate is deliberately
  // over-collecting — a re-solve there would otherwise drop to a fresh, lower rate.
  // For recoverByMonth 8 that target is month 8 in cycle one and month 20 in cycle
  // two; for recoverByMonth 9 it is month 9 and month 21. Months 10 and 22 sit just
  // past both of those targets, which is why they are in the sweep below — without
  // them, none of the atMonth values landed in a window where removing the floor
  // would change anything, so the assertion passed whether or not the floor existed.
  //
  // The comparison window is the addition's own cycle — through its next
  // anniversary — which is exactly the span the FIX-1 floor governs (it holds until
  // the next natural re-solve). Past that anniversary, both schedules re-solve from
  // scratch with no floor involved, and a schedule that front-loaded more in an
  // earlier cycle can legitimately need to bill less in a later one to still land
  // on its own total contract — a separate, pre-existing property of the
  // anniversary-anchored design (confirmed unchanged with the floor disabled),
  // not something FIX 1 promises or this task's scope covers.
  for (const recoverByMonth of [8, 9, 12]) {
    const config = { ...CONFIG, recoverByMonth }
    for (const atMonth of [2, 6, 10, 14, 20, 22, 30]) {
      const cycleEnd = Math.min(Math.ceil(atMonth / CYCLE_MONTHS) * CYCLE_MONTHS, 36)
      const base = buildFlowSchedule([ITEMS[0]], 36, config)
      const withAdd = buildFlowSchedule(
        [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: atMonth }], 36, config,
      )
      for (let m = atMonth; m <= cycleEnd; m++) {
        assert.ok(
          withAdd.rateForMonth(m) >= base.rateForMonth(m) - 0.01,
          `roi=${recoverByMonth} month ${m}: ${withAdd.rateForMonth(m)} < ${base.rateForMonth(m)}`,
        )
      }
    }
  }
})

test('flow schedule: recoverByMonth reaches payback early, rate holds to the anniversary', () => {
  // minRecoverMonth for this deal is 8 — ceil(12 × 51436 / 77154) — so 9 is the
  // earliest round target it can actually reach. Asking for 6 is tested below.
  const chain = buildChain(ITEMS, CONFIG)
  const s = buildFlowSchedule(ITEMS, 36, { ...CONFIG, recoverByMonth: 9 })
  assert.equal(s.feasible, true)
  let run = 0
  let payback = 0
  for (const row of s.rows) {
    run += row.rate
    if (!payback && run >= chain.landed - 0.01) payback = row.month
  }
  assert.equal(payback, 9)
  // One rate across the whole first cycle, despite payback landing at month 9.
  for (let m = 2; m <= 12; m++) near(s.rateForMonth(m), s.rateForMonth(1), PENNY)
})

test('flow schedule: a mid-cycle addition past recoverByMonth recovers by the anniversary', () => {
  const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: 10 }]
  const s = buildFlowSchedule(items, 36, { ...CONFIG, recoverByMonth: 9 })
  near(sumRates(s), buildChain(items, CONFIG).contract, 0.02)
  // Month 9 has passed, so recovery falls to the anniversary and the rate holds there.
  for (let m = 11; m <= 12; m++) near(s.rateForMonth(m), s.rateForMonth(10), PENNY)
})

test('flow schedule: a 12-month term bills level — no step, no residual phase', () => {
  const s = buildFlowSchedule(ITEMS, 12, CONFIG)
  assert.deepEqual(s.steps, [1])
  near(sumRates(s), buildChain(ITEMS, CONFIG).contract, 0.02)
})

test('flow schedule: cumulative and remaining close out at the final month', () => {
  const s = buildFlowSchedule(ITEMS, 24, CONFIG)
  const last = s.rows[s.rows.length - 1]
  assert.equal(last.cumulative, s.contract)
  assert.equal(last.remaining, 0)
})

test('flow schedule: rounded rates sum to the contract exactly, to the penny', () => {
  // Rounding each rate independently drifts: 4286.333… rounds down every month of
  // a flat hold and the shortfall compounds. The rows must telescope instead.
  for (const T of [24, 36, 60]) {
    for (const recoverByMonth of [8, 9, 12]) {
      const s = buildFlowSchedule(ITEMS, T, { ...CONFIG, recoverByMonth })
      assert.equal(Math.round(sumRates(s) * 100) / 100, s.contract, `T=${T} roi=${recoverByMonth}`)
    }
  }
})

test('flow schedule: a one-cent true-up inside a flat hold is not a step', () => {
  const s = buildFlowSchedule(ITEMS, 36, CONFIG)
  assert.deepEqual(s.steps, [1, 13])   // anniversaries only, despite penny true-ups
})

test('flow schedule: an unreachable recover target falls through to a level rate', () => {
  // minRecoverMonth is 8: asking for month 4 would collect more across the first
  // cycle than the whole contract is worth. Front-loading to whatever cap IS
  // reachable used to bill 6429.50/month for a year then $0.00 for the next — a
  // 100% divergence from what buildSchedule() (and the client) was quoted. FIX 1:
  // an unreachable target is now ignored, the same as buildSchedule()'s own
  // fallback, so this bills level and agrees with the reference engine exactly.
  const s = buildFlowSchedule(ITEMS, 24, { ...CONFIG, recoverByMonth: 4 })
  assert.equal(s.feasible, true)
  near(sumRates(s), buildChain(ITEMS, CONFIG).contract, 0.02)
  near(s.rateForMonth(1), 77154 / 24, 0.02)   // level, not front-loaded to the cap
  const ported = buildSchedule(buildChain(ITEMS, CONFIG), 24, { ...CONFIG, recoverByMonth: 4 })
  for (let m = 1; m <= 24; m++) near(s.rateForMonth(m), ported.rates[m - 1], PENNY)
})

test('flow schedule: the feasibility boundary is minRecoverMonth itself', () => {
  // minRecoverMonth for the pinned deal (landed 51436, contract 77154) is 8 —
  // ceil(12 × 51436 / 77154). Asking for exactly that month still shapes, recovering
  // the capital by month 8. One month tighter (7) is unreachable and, after FIX 1,
  // no longer marked infeasible — it falls through to a level rate instead.
  const reachable = buildFlowSchedule(ITEMS, 24, { ...CONFIG, recoverByMonth: 8 })
  assert.equal(reachable.feasible, true)
  near(reachable.rateForMonth(1), 51436 / 8, 0.02)   // still shaped

  const unreachable = buildFlowSchedule(ITEMS, 24, { ...CONFIG, recoverByMonth: 7 })
  assert.equal(unreachable.feasible, true)
  near(unreachable.rateForMonth(1), 77154 / 24, 0.02)   // level, not front-loaded
})

test('flow schedule: an addedAtMonth outside the term is flagged infeasible', () => {
  // Clamped so the schedule can still be shaped, but there is no honest month to
  // bill it in — the rate is never over-collected, just dishonestly timed, so this
  // must surface as feasible: false rather than looking like a clean schedule.
  const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: 99 }]
  const s = buildFlowSchedule(items, 24, CONFIG)
  assert.equal(s.feasible, false)
  near(sumRates(s), buildChain(items, CONFIG).contract, 0.02)
})

test('flow schedule vs buildSchedule: quote/bill agreement across terms and recover targets', () => {
  // The divergence FIX 1 closes was mis-scoped in the docs precisely because
  // nothing asserted quote() and buildFlowSchedule() agree. This sweeps the space
  // that matters — full terms, whole cycles, and comfortably-past-a-cycle terms —
  // deliberately excluding the documented 13–17 month exception (see
  // buildFlowSchedule's doc comment), which is a separate, pre-existing gap.
  for (const T of [12, 18, 20, 24, 36, 60]) {
    for (const recoverByMonth of [0, 4, 7, 8, 9, 12, 13, 99]) {
      const config = { ...CONFIG, recoverByMonth }
      const chain = buildChain(ITEMS, config)
      const ported = buildSchedule(chain, T, config)
      const flow = buildFlowSchedule(ITEMS, T, config)
      for (let m = 1; m <= T; m++) {
        near(flow.rateForMonth(m), ported.rates[m - 1], PENNY,
          `T=${T} recoverByMonth=${recoverByMonth} month=${m}`)
      }
    }
  }
})

test('flow schedule: recovering by the anniversary is always reachable', () => {
  // With recoverByMonth 12 the recovery window IS the hold, and capital is always
  // less than contract, so feasibility can never fail however large the addition.
  const items: FlowItem[] = [ITEMS[0], { name: 'Huge', cost: 400000, qty: 1, addedAtMonth: 11 }]
  assert.equal(buildFlowSchedule(items, 24, CONFIG).feasible, true)
})

test('addition: returns all three options, rated and dated', () => {
  const q = quoteAddition(ITEMS, 36, { name: 'Extra workstation', cost: 12000, qty: 1, atMonth: 6 }, CONFIG)
  assert.equal(q.options.length, 3)
  assert.deepEqual(q.options.map((o) => o.kind), ['this_anniversary', 'next_anniversary', 'fresh_order'])
  for (const o of q.options) {
    assert.ok(o.rateAfter > 0)
    assert.ok(o.effectiveFromMonth >= 1)
  }
  assert.equal(q.options[0].recoversByMonth, 12)
  assert.equal(q.options[1].recoversByMonth, 24)
  near(q.options[0].marginAdded, buildChain([{ cost: 12000, qty: 1 }], CONFIG).margin)
})

test('addition: deferring a cycle lands at a lower rate than recovering now', () => {
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 8 }, CONFIG)
  const [now, later] = q.options
  assert.equal(now.effectiveFromMonth, 8)
  assert.equal(later.effectiveFromMonth, 13)
  assert.ok(now.rateAfter > later.rateAfter)
})

test('addition: a late addition is flagged but every option stays open', () => {
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 10 }, CONFIG)
  assert.equal(q.monthsToAnniversary, 3)
  assert.equal(q.options.length, 3)
  assert.notEqual(q.recommended, 'this_anniversary')
  assert.ok(/anniversary/i.test(q.advice))
})

test('addition: co-terming is sound with room left in the cycle', () => {
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 4 }, CONFIG)
  assert.equal(q.monthsToAnniversary, 9)
  assert.equal(q.recommended, 'this_anniversary')
  assert.ok(/sound/i.test(q.advice))
})

test('addition: too late to defer usefully recommends a fresh order', () => {
  // Month 23 of 24: deferring lands on the final month, which is no help.
  const q = quoteAddition(ITEMS, 24, { cost: 12000, qty: 1, atMonth: 23 }, CONFIG)
  assert.equal(q.recommended, 'fresh_order')
})

test('addition: outside the term returns no options', () => {
  assert.equal(quoteAddition(ITEMS, 24, { cost: 9000, atMonth: 24 }, CONFIG).options.length, 0)
  assert.equal(quoteAddition(ITEMS, 24, { cost: 0, atMonth: 6 }, CONFIG).options.length, 0)
})

test('addition: the quoted rate matches what the schedule will actually bill', () => {
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 6 }, CONFIG)
  near(q.options[0].rateBefore, buildFlowSchedule(ITEMS, 36, CONFIG).rateForMonth(6), 0.02)
  near(
    q.options[0].rateAfter,
    buildFlowSchedule([ITEMS[0], { cost: 12000, qty: 1, addedAtMonth: 6 }], 36, CONFIG).rateForMonth(6),
    0.02,
  )
  // options[1] takes effect at month 13, so its "before" must be the rate the
  // client is on THEN, not the rate at the addition month.
  assert.equal(q.options[1].effectiveFromMonth, 13)
  near(q.options[1].rateBefore, buildFlowSchedule(ITEMS, 36, CONFIG).rateForMonth(13), 0.02)
  near(
    q.options[1].rateAfter,
    buildFlowSchedule([ITEMS[0], { cost: 12000, qty: 1, addedAtMonth: 13 }], 36, CONFIG).rateForMonth(13),
    0.02,
  )
})

test('addition: every option reports its own feasibility', () => {
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 6 }, CONFIG)
  for (const o of q.options) assert.equal(o.feasible, true)
})

test('addition: a BASE schedule that cannot be scheduled returns no options', () => {
  // An existing line already outside the term makes the BASE schedule infeasible
  // (FIX 5). There is then no honest rate to co-term onto, so quoteAddition must
  // not quote against it — the old behaviour discarded every schedule's feasible
  // flag and would have happily priced options against a broken base.
  const brokenItems: FlowItem[] = [{ ...ITEMS[0], addedAtMonth: 99 }]
  assert.equal(buildFlowSchedule(brokenItems, 24, CONFIG).feasible, false)
  const q = quoteAddition(brokenItems, 24, { cost: 9000, atMonth: 6 }, CONFIG)
  assert.equal(q.options.length, 0)
  assert.equal(q.recommended, null)
  assert.ok(q.advice.length > 0)
})

test('addition: next_anniversary is dropped when there is no useful cycle left to defer into', () => {
  // Month 26 of 36: cycleEnd is 36 (the term's own end), so deferring a cycle
  // collapses deferredFrom to 36 too — a one-month window that used to balloon-bill
  // the whole addition in month 36 alone while advice still called it "sound".
  // FIX 4 omits the option outright rather than merely warning about it.
  const q = quoteAddition(ITEMS, 36, { cost: 12000, qty: 1, atMonth: 26 }, CONFIG)
  assert.deepEqual(q.options.map((o) => o.kind), ['this_anniversary', 'fresh_order'])
  assert.notEqual(q.recommended, 'next_anniversary')
})

/* ───────── month-13 step percentage ───────── */

test('stepPct 100 bills level across the term, to the penny', () => {
  const s = buildFlowSchedule(ITEMS, 36, { ...CONFIG, stepPct: 100 })
  const sum = s.rows.reduce((a, r) => a + r.rate, 0)
  assert.equal(Math.round(sum * 100), Math.round(s.contract * 100))
  assert.ok(Math.abs(s.rows[0].rate - s.rows[35].rate) <= 0.01)
  assert.deepEqual(s.steps, [1])
})

test('stepPct 50 on 36 months: month 13+ is half of year one, sum is the contract', () => {
  const s = buildFlowSchedule(ITEMS, 36, { ...CONFIG, stepPct: 50 })
  const sum = s.rows.reduce((a, r) => a + r.rate, 0)
  assert.equal(Math.round(sum * 100), Math.round(s.contract * 100))
  assert.ok(Math.abs(s.rows[12].rate - s.rows[0].rate / 2) <= 0.01)
  assert.deepEqual(s.steps, [1, 13])
  // The reference quote reports the same shape
  const q = quote({ items: ITEMS, termMonths: 36, config: { ...CONFIG, stepPct: 50 } })
  assert.ok(Math.abs(q.schedule.frontRate - s.rows[0].rate) <= 0.01)
  assert.ok(Math.abs(q.schedule.backRate - s.rows[12].rate) <= 0.01)
})

test('stepPct is ignored when a line is added mid-term, and for terms of 12 months or less', () => {
  const items: FlowItem[] = [ITEMS[0], { name: 'Added', cost: 12000, qty: 1, addedAtMonth: 6 }]
  assert.deepEqual(
    buildFlowSchedule(items, 36, { ...CONFIG, stepPct: 50 }).rows.map((r) => r.rate),
    buildFlowSchedule(items, 36, CONFIG).rows.map((r) => r.rate),
  )
  assert.deepEqual(
    buildFlowSchedule(ITEMS, 12, { ...CONFIG, stepPct: 50 }).rows.map((r) => r.rate),
    buildFlowSchedule(ITEMS, 12, CONFIG).rows.map((r) => r.rate),
  )
})
