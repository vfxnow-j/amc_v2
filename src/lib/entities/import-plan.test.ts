import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseItemCsv, groupRows } from './csv'
import { resolveLocation, buildPlans, describeImport } from './import-plan'

const header = 'name,manufacturer,model,category,tracking,serial,owner_tag,quantity,location'
const options = [
  { id: 'l1', name: 'Warehouse A', path: 'Warehouse A' },
  { id: 'l2', name: 'Shelf 3', path: 'Warehouse A / Shelf 3' },
  { id: 'l3', name: 'Dup', path: 'North / Dup' },
  { id: 'l4', name: 'Dup', path: 'South / Dup' },
]

test('a location matches by name or by path, ignoring case and spacing', () => {
  assert.deepEqual(resolveLocation(' warehouse a ', options), { ok: true, id: 'l1' })
  assert.deepEqual(resolveLocation('warehouse a / shelf 3', options), { ok: true, id: 'l2' })
  assert.deepEqual(resolveLocation('Shelf 3', options), { ok: true, id: 'l2' })
})

test('an unknown location is an error and creates nothing', () => {
  const r = resolveLocation('Warehose A', options)
  assert.equal(r.ok, false)
})

test('a name shared by two locations is ambiguous unless the path is given', () => {
  const r = resolveLocation('Dup', options)
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /more than one/)
  assert.deepEqual(resolveLocation('South / Dup', options), { ok: true, id: 'l4' })
})

test('buildPlans resolves every row and lists each unknown location once', () => {
  const { rows } = parseItemCsv(`${header}\nA,,,,serialized,S1,,,Nowhere\nA,,,,serialized,S2,,,Nowhere\nB,,,,quantity,,5,Warehouse A`.replace(',5,Warehouse', ',,5,Warehouse'))
  const { groups } = groupRows(rows)
  const { plans, errors } = buildPlans(groups, options)
  assert.equal(plans.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /Nowhere/)
})

test('buildPlans produces ids for a clean file', () => {
  const { rows } = parseItemCsv(`${header}\nA,,,,serialized,S1,,,Warehouse A\nB,,,,quantity,,,5,shelf 3`)
  const { plans, errors } = buildPlans(groupRows(rows).groups, options)
  assert.deepEqual(errors, [])
  assert.equal(plans[0].units[0].locationId, 'l1')
  assert.deepEqual(plans[1].stock, [{ locationId: 'l2', quantity: 5 }])
})

test('describeImport words the preview', () => {
  const lines = describeImport([{ name: 'Rack', created: true, units: 3, quantity: 0 }, { name: 'Cable', created: false, units: 0, quantity: 40 }])
  assert.equal(lines[0], 'Rack: 3 units, new item')
  assert.equal(lines[1], 'Cable: 40 in stock, existing item')
})
