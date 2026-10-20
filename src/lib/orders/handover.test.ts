import test from 'node:test'
import assert from 'node:assert/strict'
import { gateApplies, shortfallMessage } from './handover-rules'

const short = { units: 3, nothingToScan: false, missing: [{ itemId: 'a', label: 'RTX 4090', parentLabel: 'Workstation', ordered: 4, out: 1, missing: 3 }] }

test('the completion gate applies to sales only', () => {
  assert.equal(gateApplies('complete', 'SALE'), true)
  for (const t of ['RENTAL', 'RENT_TO_OWN', 'FLOW', 'CLOUD']) assert.equal(gateApplies('complete', t), false, t)
})

test('ship and activate gates are unchanged (cloud activates without scanning)', () => {
  assert.equal(gateApplies('ship', 'CLOUD'), true)
  assert.equal(gateApplies('activate', 'CLOUD'), false)
  assert.equal(gateApplies('activate', 'SALE'), true)
})

test('the completion refusal names the count and what to do', () => {
  assert.match(shortfallMessage(short, 'complete'), /3 units are still to be checked out across 1 line\. Scan everything out before completing the order\./)
  assert.match(shortfallMessage(short, 'ship'), /before shipping/)
})
