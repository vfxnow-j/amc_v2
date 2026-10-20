import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCosts, extrasShare, type CostLine } from './allocate'

const L = (id: number, group: CostLine['group'], kind: CostLine['kind'], qty: number, total: number, model: string | null = null): CostLine => ({ id, group, kind, model, qty, total })

test('extras split across asset lines by value; non-assets take none', () => {
  const s = extrasShare([L(1, 'core_component', 'cpu', 1, 300), L(2, 'core_component', 'ram', 1, 100), L(3, 'extra', null, 1, 40), L(4, 'non_asset', null, 1, 999)])
  assert.equal(s.get(1), 30)
  assert.equal(s.get(2), 10)
  assert.equal(s.has(4), false)
})

test('complete build: per machine = (parts + extras) / cpu qty', () => {
  const lines = [
    L(1, 'core_component', 'cpu', 16, 16 * 1320, '3960X'), L(2, 'core_component', 'ram', 64, 64 * 52),
    L(3, 'core_component', 'storage', 16, 16 * 99), L(4, 'core_component', 'case', 16, 16 * 147),
    L(5, 'core_component', 'psu', 16, 16 * 192), L(6, 'core_component', 'board', 16, 16 * 422),
  ]
  const [b] = buildCosts(lines, extrasShare(lines))
  assert.equal(b.key, '3960X')
  assert.equal(b.cpuQty, 16)
  assert.equal(b.perMachine, 1320 + 4 * 52 + 99 + 147 + 192 + 422)
  assert.deepEqual(b.missing, [])
  assert.equal(b.mixedModels, false)
})

test('cpu-only PO is a partial build', () => {
  const [b] = buildCosts([L(1, 'core_component', 'cpu', 4, 15000, '3990X')], new Map())
  assert.equal(b.perMachine, 3750)
  assert.deepEqual(b.missing, ['board', 'ram', 'case', 'psu'])
})

test('priced case line carrying a $0 cpu line still costs the build (PO 0000000001 shape)', () => {
  const [b] = buildCosts([L(1, 'core_component', 'board', 2, 0), L(2, 'core_component', 'cpu', 2, 0, '3960X'), L(3, 'core_component', 'case', 2, 15396)], new Map())
  assert.equal(b.perMachine, 7698)
})

test('two cpu models on one PO split shared parts by cpu count', () => {
  const r = buildCosts([L(1, 'core_component', 'cpu', 10, 13200, '3960X'), L(2, 'core_component', 'cpu', 5, 18645, '3990X'), L(3, 'core_component', 'ram', 15, 1500)], new Map())
  assert.equal(r.length, 2)
  assert.equal(r.find((b) => b.key === '3960X')!.perMachine, 1420)
  assert.equal(r.find((b) => b.key === '3990X')!.perMachine, 3829)
  assert.ok(r.every((b) => b.mixedModels))
})

test('no cpu with a model → no build', () => {
  assert.deepEqual(buildCosts([L(1, 'core_component', 'ram', 4, 400)], new Map()), [])
})
