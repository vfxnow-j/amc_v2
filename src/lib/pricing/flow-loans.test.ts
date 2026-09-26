// v2: a Flow order's gear can sit on several leases at once. Each note is costed
// on its own terms and the results summed; one note must price exactly as v1 did.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quote, payment, interestOver, balanceAfter } from './flow'

const items = [{ name: 'Lenovo P620', cost: 10000, qty: 1 }, { name: 'RTX A6000', cost: 5000, qty: 1 }]
const base = { items, termMonths: 24 }
const A = { balance: 6000, aprPct: 7, monthsLeft: 30 }
const B = { balance: 2000, aprPct: 5.65, monthsLeft: 10 }

test('one loan in the list prices exactly like the single-loan form', () => {
  const single = quote({ ...base, procurement: { mode: 'stock_financed', loan: A } })
  const listed = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A] } })
  assert.deepEqual(listed.economics, single.economics)
  assert.deepEqual(listed.cash, single.cash)
  assert.deepEqual(listed.tail, single.tail)
})

test('two loans: note payment, interest and what is left all add up per loan', () => {
  const q = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  const pA = payment(A.balance, A.aprPct, A.monthsLeft)
  const pB = payment(B.balance, B.aprPct, B.monthsLeft)
  assert.equal(q.cash.notePayment, Math.round((pA + pB) * 100) / 100)
  const interest = interestOver(A.balance, A.aprPct, A.monthsLeft, 24) + interestOver(B.balance, B.aprPct, B.monthsLeft, 24)
  assert.equal(q.economics.financeActual, Math.round(interest * 100) / 100)
  const left = balanceAfter(A.balance, A.aprPct, A.monthsLeft, 24) + balanceAfter(B.balance, B.aprPct, B.monthsLeft, 24)
  assert.equal(q.tail.balanceAtTermEnd, Math.round(left * 100) / 100)
})

test('a loan stops costing cash after its last payment', () => {
  const q = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  const pA = payment(A.balance, A.aprPct, A.monthsLeft)
  const pB = payment(B.balance, B.aprPct, B.monthsLeft)
  const rate = (i: number) => q.schedule.rates[i]
  assert.equal(q.cash.netByMonth[0], Math.round((rate(0) - pA - pB) * 100) / 100)
  assert.equal(q.cash.netByMonth[15], Math.round((rate(15) - pA) * 100) / 100) // B paid off after month 10
})

test('the client price never depends on funding', () => {
  const owned = quote({ ...base, procurement: { mode: 'stock_owned' } })
  const leased = quote({ ...base, procurement: { mode: 'stock_financed', loans: [A, B] } })
  assert.deepEqual(leased.schedule.rates, owned.schedule.rates)
  assert.equal(leased.client.totalPayable, owned.client.totalPayable)
})

test('an empty loan list is owned stock', () => {
  const owned = quote({ ...base, procurement: { mode: 'stock_owned' } })
  const empty = quote({ ...base, procurement: { mode: 'stock_financed', loans: [] } })
  assert.equal(empty.economics.financeActual, owned.economics.financeActual)
})

test('a single loan keeps its own rate exactly, not a balance-weighted approximation', () => {
  const one = { balance: 17.3, aprPct: 0.95, monthsLeft: 12 }
  const single = quote({ ...base, procurement: { mode: 'stock_financed', loan: one } })
  const listed = quote({ ...base, procurement: { mode: 'stock_financed', loans: [one] } })
  assert.equal(listed.tail.aprPct, 0.95)
  assert.deepEqual(listed.tail, single.tail)
})

test('a single loan with zero balance is owned stock: no note', () => {
  const zero = { balance: 0, aprPct: 7, monthsLeft: 24 }
  const owned = quote({ ...base, procurement: { mode: 'stock_owned' } })
  const financed = quote({ ...base, procurement: { mode: 'stock_financed', loans: [zero] } })
  assert.equal(financed.tail.noteMonths, 0)
  assert.equal(financed.cash.notePayment, 0)
  assert.deepEqual(financed.economics, owned.economics)
  assert.deepEqual(financed.cash, owned.cash)
})
