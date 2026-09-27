import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertClientSafe, findClientUnsafeKeys, isoDate, money } from './dto'

test('a clean portal payload passes', () => {
  assert.doesNotThrow(() =>
    assertClientSafe({
      data: {
        rate_id: 'r1',
        total: 1200,
        lines: [{ unit_price: 100, line_total: 1200, demand: 'normal', allowed: true, reason: null }],
      },
    }),
  )
})

test('internal keys are found at any depth, named by path', () => {
  const payload = {
    data: {
      lines: [{ unit_price: 1, trueCost: 2 }],
      nested: { deep: { flowMarginPct: 10, costBasis: 3 } },
      purchasePrice: 5,
      leaseFunding: 1,
      landedCostAdjustment: 0,
      salvageValue: 0,
      deprPct: 1,
      loanBalance: 1,
      financePct: 1,
      internalNotes: 'x',
    },
  }
  const found = findClientUnsafeKeys(payload)
  for (const path of [
    '$.data.lines[0].trueCost',
    '$.data.nested.deep.flowMarginPct',
    '$.data.nested.deep.costBasis',
    '$.data.purchasePrice',
    '$.data.leaseFunding',
    '$.data.landedCostAdjustment',
    '$.data.salvageValue',
    '$.data.deprPct',
    '$.data.loanBalance',
    '$.data.financePct',
    '$.data.internalNotes',
  ]) {
    assert.ok(found.includes(path), `missing ${path}`)
  }
  assert.throws(() => assertClientSafe(payload), /trueCost/)
})

test('values are not scanned, only keys; cycles terminate', () => {
  assert.doesNotThrow(() => assertClientSafe({ note: 'cost basis margin lease' }))
  const cyclic: Record<string, unknown> = { a: 1 }
  cyclic.self = cyclic
  assert.doesNotThrow(() => assertClientSafe(cyclic))
})

test('money rounds to cents; isoDate is YYYY-MM-DD', () => {
  assert.equal(money('12.345'), 12.35)
  assert.equal(money(null), null)
  assert.equal(money({ toString: () => '99.9' }), 99.9)
  assert.equal(isoDate(new Date('2026-09-26T23:00:00Z')), '2026-09-26')
})
