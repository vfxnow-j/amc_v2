import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, flowScheduleHash } from './flow-schedule-hash'
import { flowClientQuote } from './flow-client-quote'

const quote = flowClientQuote({
  rates: [1000, 1000, 1000, 1200, 1200, 1200],
  discountAmount: 300,
  taxRate: 9.5,
  deliveryCost: 150,
  returnCost: 150,
  feasible: true,
})
const extension = { pct: 50, monthly: 600, finalMonthly: 1200 }

test('canonical JSON ignores key order at every depth', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }))
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}')
})

test('the schedule hash is deterministic and hex SHA-256', () => {
  const a = flowScheduleHash(quote, extension)
  const b = flowScheduleHash(JSON.parse(JSON.stringify(quote)), { finalMonthly: 1200, monthly: 600, pct: 50 })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('any change to what the client is shown changes the hash', () => {
  const base = flowScheduleHash(quote, extension)
  const repriced = flowClientQuote({ rates: [1000, 1000, 1000, 1200, 1200, 1201], discountAmount: 300, taxRate: 9.5, deliveryCost: 150, returnCost: 150, feasible: true })
  assert.notEqual(flowScheduleHash(repriced, extension), base)
  const shipping = flowClientQuote({ rates: [1000, 1000, 1000, 1200, 1200, 1200], discountAmount: 300, taxRate: 9.5, deliveryCost: 175, returnCost: 150, feasible: true })
  assert.notEqual(flowScheduleHash(shipping, extension), base)
  const discount = flowClientQuote({ rates: [1000, 1000, 1000, 1200, 1200, 1200], discountAmount: 200, taxRate: 9.5, deliveryCost: 150, returnCost: 150, feasible: true })
  assert.notEqual(flowScheduleHash(discount, extension), base)
  assert.notEqual(flowScheduleHash(quote, { ...extension, pct: 60, monthly: 720 }), base)
  const shorter = flowClientQuote({ rates: [1000, 1000, 1000, 1200, 1200], discountAmount: 300, taxRate: 9.5, deliveryCost: 150, returnCost: 150, feasible: true })
  assert.notEqual(flowScheduleHash(shorter, extension), base)
})
