import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateLandedCost, landedAdjustmentForUnit, type LandedCostPO } from './landed-cost'

const po = (over: Partial<LandedCostPO>): LandedCostPO => ({
  discountAmount: 0, freightAmount: 0, feesTotal: 0, taxAmount: 0, items: [], ...over,
})

test('P3P: $2,500 discount + $250 freight over 10 × $6,999 → −$225 each', () => {
  const p = po({ discountAmount: 2500, freightAmount: 250,
    items: [{ id: 'l1', assetId: 'a1', isInventoried: true, quantity: 10, unitPrice: 6999 }] })
  assert.equal(allocateLandedCost(p).get('l1'), -225)
})

test('consumable lines take no share (PO-2026-00005 shape)', () => {
  const p = po({ discountAmount: 5731.34, freightAmount: 1089.91, items: [
    { id: 't', assetId: 'a1', isInventoried: true, quantity: 20, unitPrice: 3499 },
    { id: 'c1', assetId: null, isInventoried: false, quantity: 5, unitPrice: 149.99 },
    { id: 'c2', assetId: null, isInventoried: false, quantity: 2, unitPrice: 259.99 },
  ] })
  const a = allocateLandedCost(p)
  assert.equal(a.get('t'), -232.07)
  assert.equal(a.has('c1'), false)
})

test('allocates by value across mixed tracked lines', () => {
  const p = po({ freightAmount: 100, items: [
    { id: 'big', assetId: 'a1', isInventoried: true, quantity: 1, unitPrice: 3000 },
    { id: 'small', assetId: 'a2', isInventoried: true, quantity: 2, unitPrice: 500 },
  ] })
  const a = allocateLandedCost(p)
  assert.equal(a.get('big'), 75) // 100 × 3000/4000
  assert.equal(a.get('small'), 12.5) // 100 × 500/4000
})

test('zero extras → zero; no tracked lines → empty', () => {
  assert.equal(allocateLandedCost(po({ items: [{ id: 'l', assetId: 'a', isInventoried: true, quantity: 1, unitPrice: 10 }] })).get('l'), 0)
  assert.equal(allocateLandedCost(po({ freightAmount: 50, items: [{ id: 'c', assetId: null, isInventoried: false, quantity: 1, unitPrice: 10 }] })).size, 0)
})

test('rounds each share to cents; drift is small', () => {
  const p = po({ freightAmount: 100, items: [{ id: 'l', assetId: 'a', isInventoried: true, quantity: 3, unitPrice: 10 }] })
  assert.equal(allocateLandedCost(p).get('l'), 33.33)
})

test('unit matched by asset + price; hand-priced unit → null', () => {
  const p = po({ freightAmount: 9, taxAmount: 158.35,
    items: [{ id: 'l', assetId: 'mba', isInventoried: true, quantity: 1, unitPrice: 1504 }] })
  const a = allocateLandedCost(p)
  assert.equal(landedAdjustmentForUnit(p, a, { assetId: 'mba', purchasePrice: 1504 }), 167.35)
  assert.equal(landedAdjustmentForUnit(p, a, { assetId: 'mba', purchasePrice: 1258.33 }), null)
  assert.equal(landedAdjustmentForUnit(p, a, { assetId: 'other', purchasePrice: 1504 }), null)
})
