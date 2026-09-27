import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFlowApproval, FLOW_SCHEDULE_CHANGED } from './approval'

const base = { signerName: 'Ada Client', autopayMethod: 'ACH' as const, displayedTermsVersion: 1, currentTermsVersion: 1 }
const HASH = 'a'.repeat(64)

test('a Flow approval passes when the schedule the client saw is the schedule now', () => {
  assert.equal(checkFlowApproval({ ...base, displayedScheduleHash: HASH, currentScheduleHash: HASH }).ok, true)
})

test('a Flow approval is refused when the schedule was re-priced after the client opened it', () => {
  assert.deepEqual(
    checkFlowApproval({ ...base, displayedScheduleHash: 'b'.repeat(64), currentScheduleHash: HASH }),
    { ok: false, error: FLOW_SCHEDULE_CHANGED },
  )
})

test('a missing or malformed schedule hash is refused, never trusted', () => {
  for (const bad of [undefined, null, '', 42, {}, [HASH], HASH.toUpperCase(), `${HASH} `, HASH.slice(1)]) {
    const r = checkFlowApproval({ ...base, displayedScheduleHash: bad, currentScheduleHash: HASH })
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)} as a schedule hash`)
  }
})

test('the schedule rule applies only when the server supplies the current hash', () => {
  assert.equal(checkFlowApproval({ ...base }).ok, true)
})
