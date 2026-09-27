import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderFlowTerms, unknownPlaceholders, mergeFlowTermsSettings, isValidTermsUrl,
  FLOW_TERMS_DEFAULTS, FLOW_TERMS_PLACEHOLDERS,
} from './flow-terms'
import type { FlowClientQuote } from './flow-client-quote'

/** 24-month quote: 12 × $1,000 then 12 × $800, no tax. `remaining` = what's left after the month. */
function quote(): FlowClientQuote {
  const pays = [...Array(12).fill(1000), ...Array(12).fill(800)]
  let left = pays.reduce((a, b) => a + b, 0)
  const rows = pays.map((p, i) => { left -= p; return { month: i + 1, payment: p, tax: 0, total: p, remaining: left } })
  return {
    feasible: true, termMonths: 24, tiers: [], rows, oneTime: [],
    totals: { contract: 21600, discount: 0, contractAfterDiscount: 21600, tax: 0, oneTime: 0, total: 21600 },
  }
}
const ctx = { termMonths: 24, startDate: '2026-10-01T00:00:00Z', endDate: '2028-09-30T00:00:00Z', quote: quote() }

test('every default placeholder is filled', () => {
  const r = renderFlowTerms(FLOW_TERMS_DEFAULTS, ctx)
  for (const c of r.clauses) assert.doesNotMatch(c.title + c.body, /\{\{/)
  const all = r.clauses.map((c) => c.body).join('\n')
  assert.match(all, /24-month Flow subscription starting October 1, 2026/)
  assert.match(all, /50% of the scheduled payments remaining/)
  assert.match(all, /\$400\.00\/month \(50% of your final payment of \$800\.00\)/)
  assert.match(all, /At least 30 days before September 30, 2028/)
  assert.match(all, /https:\/\/vfxnow\.com\/terms/)
})

test('defaults only use known placeholders', () => {
  for (const c of FLOW_TERMS_DEFAULTS.clauses) assert.deepEqual(unknownPlaceholders(c.title + c.body), [])
  assert.ok(FLOW_TERMS_PLACEHOLDERS.includes('extensionMonthly'))
})

test('unknown placeholders are reported', () => {
  assert.deepEqual(unknownPlaceholders('Pay {{termMonths}} x {{bogus}} and {{ alsoBad }}'), ['bogus', 'alsoBad'])
})

test('cancellation examples: every 6th month, fee = pct × remaining, across the step', () => {
  const r = renderFlowTerms(FLOW_TERMS_DEFAULTS, ctx)
  assert.deepEqual(r.cancellationExamples.map((e) => e.afterMonth), [6, 12, 18])
  // after month 6: 6×1000 + 12×800 = 15,600 left → 7,800
  assert.equal(r.cancellationExamples[0].fee, 7800)
  // after month 12: 12×800 = 9,600 → 4,800
  assert.equal(r.cancellationExamples[1].fee, 4800)
  // after month 18: 6×800 = 4,800 → 2,400
  assert.equal(r.cancellationExamples[2].fee, 2400)
})

test('short terms: 2–6 months list month 1; 1 month lists none', () => {
  const q = quote()
  const short = { ...q, termMonths: 4, rows: q.rows.slice(0, 4).map((r, i, a) => ({ ...r, remaining: a.slice(i + 1).reduce((s, x) => s + x.payment, 0) })) }
  assert.deepEqual(renderFlowTerms(FLOW_TERMS_DEFAULTS, { ...ctx, termMonths: 4, quote: short }).cancellationExamples.map((e) => e.afterMonth), [1])
  const one = { ...q, termMonths: 1, rows: [{ ...q.rows[0], remaining: 0 }] }
  assert.deepEqual(renderFlowTerms(FLOW_TERMS_DEFAULTS, { ...ctx, termMonths: 1, quote: one }).cancellationExamples, [])
})

test('per-order extension override wins over settings', () => {
  const r = renderFlowTerms(FLOW_TERMS_DEFAULTS, { ...ctx, extensionPct: 40 })
  assert.deepEqual(r.extension, { pct: 40, monthly: 320, finalMonthly: 800 })
})

test('settings merge fills missing keys and keeps stored clauses', () => {
  const m = mergeFlowTermsSettings({ cancellationPct: 60, clauses: [{ title: 'A', body: 'B' }] })
  assert.equal(m.cancellationPct, 60)
  assert.equal(m.extensionPct, 50)
  assert.deepEqual(m.clauses, [{ title: 'A', body: 'B' }])
  assert.deepEqual(mergeFlowTermsSettings(null), FLOW_TERMS_DEFAULTS)
})

test('deterministic', () => {
  assert.deepEqual(renderFlowTerms(FLOW_TERMS_DEFAULTS, ctx), renderFlowTerms(FLOW_TERMS_DEFAULTS, ctx))
})

test('isValidTermsUrl accepts only http(s)', () => {
  assert.equal(isValidTermsUrl('https://vfxnow.com/terms'), true)
  assert.equal(isValidTermsUrl('http://vfxnow.com/terms'), true)
  assert.equal(isValidTermsUrl('javascript:alert(1)'), false)
  assert.equal(isValidTermsUrl('data:text/html,hi'), false)
  assert.equal(isValidTermsUrl('/relative/path'), false)
  assert.equal(isValidTermsUrl(''), false)
  assert.equal(isValidTermsUrl('ftp://vfxnow.com/terms'), false)
})

test('settings merge falls back to the default URL when the stored one is not http(s)', () => {
  const bad = mergeFlowTermsSettings({ generalTermsUrl: 'javascript:alert(1)' })
  assert.equal(bad.generalTermsUrl, FLOW_TERMS_DEFAULTS.generalTermsUrl)
  const alsoBad = mergeFlowTermsSettings({ generalTermsUrl: '' })
  assert.equal(alsoBad.generalTermsUrl, FLOW_TERMS_DEFAULTS.generalTermsUrl)
  const ok = mergeFlowTermsSettings({ generalTermsUrl: 'https://example.com/terms' })
  assert.equal(ok.generalTermsUrl, 'https://example.com/terms')
})
