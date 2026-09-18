import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverPlanLines, deviceFamily, readPlanLine, unitsForLine, type CandidateUnit, type POLine } from './po-plans'

const line = (over: Partial<POLine> & Pick<POLine, 'id' | 'description' | 'quantity'>): POLine => ({
  unitPrice: 0, assetId: null, isInventoried: false, ...over,
})

test('reads a Melrose AppleCare+ line for what it says, and no more', () => {
  assert.deepEqual(readPlanLine('AppleCare+ for Mac Studio (M4) (Auto Enroll)'), {
    name: 'AppleCare+', provider: 'Apple', autoEnroll: true, family: 'mac-studio',
  })
  assert.equal(readPlanLine('AppleCare+ for 15inch MacBook Air (M4) (Auto Enroll)')?.family, 'macbook-air')
  assert.equal(readPlanLine('Mac Studio M4 MAX 512GB'), null)
})

test('"Mac Mini M4 PRO" is a Mac mini, not a Mac Pro', () => {
  assert.equal(deviceFamily('Mac Mini M4 PRO 12-Core CPU 16-Core GPU 24GB RAM 512GB SSD 10G Ethernet'), 'mac-mini')
  assert.equal(deviceFamily('MacBook Air M5 15" 512GB'), 'macbook-air')
})

test('one plan line covers both Mac mini lines when the counts agree (PO-2026-00001 shape)', () => {
  const lines = [
    line({ id: 'pro', description: 'Mac Mini M4 PRO 12-Core CPU', quantity: 5, assetId: 'a1', isInventoried: true }),
    line({ id: 'base', description: 'Mac Mini M4 10C CPU 10C GPU 16GB 256GB', quantity: 15, assetId: 'a2', isInventoried: true }),
    line({ id: 'plan', description: 'AppleCare+ for Mac Mini M4 2024 (Auto Enroll)', quantity: 20 }),
    line({ id: 'cable', description: 'Hosa Y cable', quantity: 10 }),
  ]
  const [cover] = coverPlanLines(lines)
  assert.equal(cover.ok, true)
  assert.deepEqual(cover.hardware.map((h) => h.id), ['pro', 'base'])
})

test('a plan count that disagrees with the hardware is refused, not guessed', () => {
  const lines = [
    line({ id: 'hw', description: 'Mac Studio M4 MAX', quantity: 8, assetId: 'a1', isInventoried: true }),
    line({ id: 'plan', description: 'AppleCare+ for Mac Studio (M4) (Auto Enroll)', quantity: 6 }),
  ]
  assert.equal(coverPlanLines(lines)[0].ok, false)
})

test('units are matched by price inside the PO window, and only when the count is exact', () => {
  const at = (iso: string) => new Date(iso)
  const unit = (id: string, price: number, date: string): CandidateUnit => ({
    id, barcode: id, assetId: 'a1', purchaseOrderId: null, purchasePrice: price, purchaseDate: at(date),
  })
  const hw = line({ id: 'hw', description: 'Mac Studio', quantity: 2, unitPrice: 1999, assetId: 'a1', isInventoried: true })
  const po = { id: 'po', window: { from: at('2026-02-02T08:00:00Z'), to: at('2026-03-09T20:00:00Z') } }
  const units = [
    unit('old', 1999, '2025-05-14T00:00:00Z'), // same price, a year earlier
    unit('in1', 1999, '2026-02-10T21:00:00Z'),
    unit('in2', 1999, '2026-02-10T21:00:00Z'),
    unit('other', 1936.46, '2026-02-10T21:00:00Z'),
  ]
  const match = unitsForLine(hw, po, units)
  assert.equal(match.ok, true)
  assert.deepEqual(match.units.map((u) => u.id), ['in1', 'in2'])
  assert.equal(unitsForLine({ ...hw, quantity: 3 }, po, units).ok, false)
})
