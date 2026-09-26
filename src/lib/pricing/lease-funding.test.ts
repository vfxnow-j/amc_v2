import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaseBalance, unitFunding, FLOW_LEASE_ASSUMPTION, type LeaseTerms } from './lease-funding'
import { payment } from './flow'

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12))
const fcb: LeaseTerms = { id: 'L1', label: '6786821', status: 'ACTIVE', monthlyPayment: 4117.09, aprPct: 5.55, startDate: day(2026, 2, 2), termMonths: 36 }

test('balance is the present value of the payments still to come', () => {
  const b = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0) // 6 payments made (Mar..Aug)
  const r = 5.55 / 100 / 12
  const pv = 4117.09 * (1 - Math.pow(1 + r, -30)) / r
  assert.equal(b.monthsLeft, 30)
  assert.equal(b.balance, Math.round(pv * 100) / 100)
  assert.equal(b.assumed, false)
})

test('a 0% lease with a payment: payments left × payment', () => {
  const b = leaseBalance({ ...fcb, aprPct: 0, monthlyPayment: 1000, termMonths: 12, startDate: day(2026, 5, 1) }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0)
  assert.equal(b.monthsLeft, 9)
  assert.equal(b.balance, 9000)
})

test('a paid-off or finished lease owes nothing', () => {
  assert.equal(leaseBalance({ ...fcb, status: 'PAID_OFF' }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance, 0)
  assert.equal(leaseBalance({ ...fcb, startDate: day(2020, 0, 1) }, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance, 0)
})

test('no terms recorded: priced on the labelled assumption, as a note on the unit cost from the lease start', () => {
  const shell = { ...fcb, monthlyPayment: 0, aprPct: 0, termMonths: 60, startDate: day(2025, 10, 19) }
  const b = leaseBalance(shell, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 20345)
  const pmt = payment(20345, 8, 60)
  const r = 8 / 100 / 12
  assert.equal(b.assumed, true)
  assert.equal(b.aprPct, 8)
  assert.equal(b.monthsLeft, 50) // Dec..Sep = 10 made
  assert.equal(b.balance, Math.round(pmt * (1 - Math.pow(1 + r, -50)) / r * 100) / 100)
})

test('a lease balance is split across the units still held, by cost', () => {
  const held = [
    { unitId: 'u1', assetId: 'p620', leaseId: 'L1', cost: 10000 },
    { unitId: 'u2', assetId: 'a6000', leaseId: 'L1', cost: 5000 },
    { unitId: 'u3', assetId: 'mac', leaseId: null, cost: 3000 },
  ]
  const f = unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const total = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance
  assert.equal(f.get('u1')!.share, 2 / 3)
  assert.equal(f.get('u1')!.balance, Math.round(total * 2 / 3 * 100) / 100)
  assert.equal(f.get('u2')!.payment, Math.round(4117.09 / 3 * 100) / 100)
  assert.equal(f.has('u3'), false) // owned outright
})

test('shares of one lease sum back to the lease, to the cent', () => {
  const held = [1, 2, 3].map((i) => ({ unitId: `u${i}`, assetId: 'x', leaseId: 'L1', cost: 3333.33 }))
  const f = unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const total = leaseBalance(fcb, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION, 0).balance
  const sum = [...f.values()].reduce((s, u) => s + u.balance, 0)
  assert.equal(Math.round(sum * 100) / 100, total)
})

test('a lease whose held units cost nothing splits evenly', () => {
  const held = [{ unitId: 'u1', assetId: 'x', leaseId: 'L1', cost: 0 }, { unitId: 'u2', assetId: 'x', leaseId: 'L1', cost: 0 }]
  assert.equal(unitFunding([fcb], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION).get('u1')!.share, 0.5)
})

test('month-end payment timing: a Jan 31 start clamps to the last day of short months', () => {
  const lease = { ...fcb, startDate: day(2026, 0, 31) }
  const made = (asOf: Date) => leaseBalance(lease, asOf, FLOW_LEASE_ASSUMPTION, 0).monthsLeft
  // termMonths - monthsLeft = paymentsMade
  assert.equal(36 - made(day(2026, 1, 27)), 0) // Feb 27: not yet
  assert.equal(36 - made(day(2026, 1, 28)), 1) // Feb 28: first payment (clamped)
  assert.equal(36 - made(day(2026, 2, 30)), 1) // Mar 30: still 1
  assert.equal(36 - made(day(2026, 2, 31)), 2) // Mar 31: second payment
  assert.equal(36 - made(day(2026, 3, 30)), 3) // Apr 30: third payment (clamped)
})

test('month-end payment timing: a Feb 29 leap-year start pays on Mar 29', () => {
  const lease = { ...fcb, startDate: day(2024, 1, 29) }
  const made = (asOf: Date) => 36 - leaseBalance(lease, asOf, FLOW_LEASE_ASSUMPTION, 0).monthsLeft
  assert.equal(made(day(2024, 2, 29)), 1)
})

test('month-end payment timing: a mid-month start crosses a year boundary cleanly', () => {
  const lease = { ...fcb, startDate: day(2025, 10, 15) }
  const made = (asOf: Date) => 36 - leaseBalance(lease, asOf, FLOW_LEASE_ASSUMPTION, 0).monthsLeft
  assert.equal(made(day(2026, 0, 15)), 2)
  assert.equal(made(day(2026, 0, 14)), 1)
})

test('largest-remainder split: $1.00 over 200 equal-cost units never goes negative', () => {
  const held = Array.from({ length: 200 }, (_, i) => ({ unitId: `u${i}`, assetId: 'x', leaseId: 'L1', cost: 100 }))
  const lease = { ...fcb, monthlyPayment: 1, aprPct: 0, termMonths: 1, startDate: day(2026, 8, 26) }
  const f = unitFunding([lease], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const balances = [...f.values()].map((u) => u.balance)
  const cents = balances.map((b) => Math.round(b * 100))
  const sum = Math.round(balances.reduce((s, b) => s + b, 0) * 100) / 100
  assert.equal(sum, 1)
  assert.ok(balances.every((b) => b >= 0))
  assert.ok(Math.max(...cents) - Math.min(...cents) <= 1)
})

test('largest-remainder split: $1.00 over 3 equal units splits to the cent with no negatives', () => {
  const held = [1, 2, 3].map((i) => ({ unitId: `u${i}`, assetId: 'x', leaseId: 'L1', cost: 100 }))
  const lease = { ...fcb, monthlyPayment: 1, aprPct: 0, termMonths: 1, startDate: day(2026, 8, 26) }
  const f = unitFunding([lease], held, day(2026, 8, 26), FLOW_LEASE_ASSUMPTION)
  const balances = [...f.values()].map((u) => u.balance)
  const cents = balances.map((b) => Math.round(b * 100))
  const sum = Math.round(balances.reduce((s, b) => s + b, 0) * 100) / 100
  assert.equal(sum, 1)
  assert.ok(balances.every((b) => b >= 0))
  assert.ok(Math.max(...cents) - Math.min(...cents) <= 1)
})
