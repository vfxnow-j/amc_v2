import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  duplicateIdentity, missingIdentity, groupDeployed, groupStored, latestReleases, matchesQuery, releaseKey, parseLogFilter, parseQuery, parseTab, splitSerials, unitsToSend,
  type PlacedStock, type PlacedUnit,
} from './screens'

test('tab: only "return" selects Return; garbage and arrays fall back to release', () => {
  assert.equal(parseTab('return'), 'return')
  assert.equal(parseTab(' RETURN '), 'return')
  assert.equal(parseTab(['return', 'x']), 'return')
  for (const v of [undefined, '', 'x', '../..', ['x'], 'returns']) assert.equal(parseTab(v), 'release')
})

test('query is trimmed, bounded and never an array', () => {
  assert.equal(parseQuery('  abc '), 'abc')
  assert.equal(parseQuery(['a', 'b']), 'a')
  assert.equal(parseQuery(undefined), '')
  assert.equal(parseQuery('x'.repeat(500)).length, 100)
})

test('log filter drops unknown types and oversized ids', () => {
  assert.deepEqual(parseLogFilter({ item: 'abc', type: 'release' }), { itemId: 'abc', type: 'RELEASE' })
  assert.deepEqual(parseLogFilter({ item: 'x'.repeat(65), type: 'DROP TABLE' }), { itemId: null, type: null })
  assert.deepEqual(parseLogFilter({}), { itemId: null, type: null })
  assert.deepEqual(parseLogFilter({ item: ['a', 'b'], type: ['move'] }), { itemId: 'a', type: 'MOVE' })
  assert.deepEqual(parseLogFilter({ item: '  ', type: '' }), { itemId: null, type: null })
})

test('matchesQuery is case-insensitive across fields and empty matches all', () => {
  assert.ok(matchesQuery('', 'x'))
  assert.ok(matchesQuery('sn1', null, 'abc-SN1'))
  assert.ok(!matchesQuery('zzz', 'a', null))
})

test('splitSerials trims, splits on lines/commas, dedupes and caps', () => {
  const r = splitSerials(' A1 \r\n\nA2,a1\tA3\n')
  assert.deepEqual(r.serials, ['A1', 'A2', 'A3'])
  assert.equal(r.duplicates, 1)
  assert.equal(r.overCap, 0)
  const withExisting = splitSerials('A1\nB1', ['a1'])
  assert.deepEqual(withExisting.serials, ['B1'])
  assert.equal(withExisting.duplicates, 1)
  const capped = splitSerials('1\n2\n3\n4', ['x'], 3)
  assert.deepEqual(capped.serials, ['1', '2'])
  assert.equal(capped.overCap, 2)
  assert.deepEqual(splitSerials('a', ['1', '2'], 2), { serials: [], duplicates: 0, overCap: 1 })
  assert.deepEqual(splitSerials('   \n\n').serials, [])
})

test('unitsToSend drops empty rows and trims', () => {
  const rows = [
    { serial: ' S1 ', ownerTag: '', scanTag: '', condition: '' },
    { serial: '', ownerTag: ' ', scanTag: '', condition: '' },
    { serial: '', ownerTag: '', scanTag: '', condition: 'dented' },
  ]
  assert.deepEqual(unitsToSend(rows), [{ serial: 'S1', ownerTag: undefined, scanTag: undefined, condition: undefined }, { serial: undefined, ownerTag: undefined, scanTag: undefined, condition: 'dented' }])
})

test('duplicateIdentity finds repeats case-insensitively per field', () => {
  const blank = { serial: '', ownerTag: '', scanTag: '', condition: '' }
  assert.equal(duplicateIdentity([{ ...blank, serial: 'A' }, { ...blank, serial: 'b' }]), null)
  assert.match(duplicateIdentity([{ ...blank, serial: 'A' }, { ...blank, serial: ' a ' }]) ?? '', /listed twice/)
  assert.equal(duplicateIdentity([{ ...blank, serial: 'A' }, { ...blank, ownerTag: 'A' }]), null)
  assert.match(duplicateIdentity([{ ...blank, scanTag: 'T' }, { ...blank, scanTag: 't' }]) ?? '', /listed twice/)
})

const unit = (o: Partial<PlacedUnit>): PlacedUnit => ({ id: 'u', itemId: 'i', itemName: 'Server', serial: 'S', ownerTag: null, scanTag: null, status: 'IN_STORAGE', currentLocationId: 'L1', ...o })
const stock = (o: Partial<PlacedStock>): PlacedStock => ({ id: 's', itemId: 'q', itemName: 'Cable', locationId: 'L1', deployed: false, quantity: 5, ...o })
const names = new Map([['L1', 'Warehouse'], ['L2', 'Stage 9']])

test('groupStored groups by location name and ignores deployed, returned and empty rows', () => {
  const g = groupStored(
    [unit({ id: 'a' }), unit({ id: 'b', currentLocationId: 'L2', serial: 'Z' }), unit({ id: 'c', status: 'DEPLOYED' }), unit({ id: 'd', status: 'RETURNED_TO_OWNER', currentLocationId: null }), unit({ id: 'e', currentLocationId: 'gone' })],
    [stock({ id: 's1' }), stock({ id: 's2', deployed: true }), stock({ id: 's3', quantity: 0 })],
    names,
  )
  assert.deepEqual(g.map((x) => x.name), ['Removed location', 'Stage 9', 'Warehouse'])
  const wh = g.find((x) => x.name === 'Warehouse')!
  assert.equal(wh.entries.length, 2)
  assert.ok(wh.entries.some((e) => e.quantity === 5))
})

test('groupDeployed groups by destination and puts a missing location in its own group', () => {
  const g = groupDeployed(
    [unit({ id: 'a', status: 'DEPLOYED', currentLocationId: 'L2' }), unit({ id: 'b', status: 'DEPLOYED', currentLocationId: null }), unit({ id: 'c' })],
    [stock({ id: 's1', deployed: true, locationId: 'L2' })],
    names,
  )
  assert.deepEqual(g.map((x) => x.name), ['No location recorded', 'Stage 9'])
  assert.equal(g[1].entries.length, 2)
})

test('latestReleases keeps the newest real release, skipping corrections and hand-backs', () => {
  const base = { type: 'RELEASE', correctsId: null, finalToOwner: false, unitId: 'u1', itemId: 'i', toLocationId: 'L2', actorUserId: 'a', recipient: 'R' }
  const m = latestReleases([
    { ...base, occurredAt: new Date('2026-01-01') },
    { ...base, actorUserId: 'b', occurredAt: new Date('2026-03-01') },
    { ...base, actorUserId: 'c', occurredAt: new Date('2026-05-01'), correctsId: 'x' },
    { ...base, actorUserId: 'd', occurredAt: new Date('2026-06-01'), finalToOwner: true },
    { ...base, unitId: null, itemId: 'q', toLocationId: 'L2', occurredAt: new Date('2026-02-01') },
    { ...base, type: 'MOVE', occurredAt: new Date('2027-01-01') },
  ])
  assert.equal(m.get('u:u1')?.actorUserId, 'b')
  assert.equal(m.get('s:q:L2')?.actorUserId, 'a')
  assert.equal(m.size, 2)
})

test('releaseKey shapes are what latestReleases produces', () => {
  assert.equal(releaseKey.unit('u1'), 'u:u1')
  assert.equal(releaseKey.stock('i', 'L2'), 's:i:L2')
  const base = { type: 'RELEASE', correctsId: null, finalToOwner: false, unitId: 'u1', itemId: 'i', toLocationId: 'L2', actorUserId: 'a', recipient: null }
  const m = latestReleases([{ ...base, occurredAt: new Date('2026-01-01') }, { ...base, unitId: null, occurredAt: new Date('2026-01-02') }])
  assert.deepEqual([...m.keys()].sort(), [releaseKey.stock('i', 'L2'), releaseKey.unit('u1')].sort())
})

test('release, return, release again: the second release wins; return and hand-back never count', () => {
  const base = { correctsId: null, finalToOwner: false, unitId: 'u1', itemId: 'i', toLocationId: 'L2', actorUserId: 'a', recipient: 'R' }
  const m = latestReleases([
    { ...base, type: 'RELEASE', actorUserId: 'first', occurredAt: new Date('2026-01-01') },
    { ...base, type: 'RETURN', actorUserId: 'ret', occurredAt: new Date('2026-02-01') },
    { ...base, type: 'RELEASE', actorUserId: 'second', occurredAt: new Date('2026-03-01') },
    { ...base, type: 'RELEASE', finalToOwner: true, actorUserId: 'handback', occurredAt: new Date('2026-04-01') },
    { ...base, type: 'RELEASE', correctsId: 'x', actorUserId: 'fix', occurredAt: new Date('2026-05-01') },
  ])
  assert.equal(m.get(releaseKey.unit('u1'))?.actorUserId, 'second')
  assert.equal(m.size, 1)
})

test('missingIdentity refuses a unit with only a condition', () => {
  assert.equal(missingIdentity([{ serial: 'A' }, { scanTag: 'T' }]), null)
  assert.match(missingIdentity([{ serial: 'A' }, {}]) ?? '', /serial, owner tag or scan tag/)
})
