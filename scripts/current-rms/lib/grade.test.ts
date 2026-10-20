import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gradeCost, gradeDate, gradeStatus, worst } from './grade'

test('worst-of ordering', () => {
  assert.equal(worst('green', 'none', 'yellow'), 'yellow')
  assert.equal(worst('orange', 'green'), 'orange')
  assert.equal(worst(), 'none')
})

test('date grades', () => {
  const d = (amc: string | null, poDate: string | null, openingDate: string | null, openingIsBulkDay = false) => gradeDate({ amc, poDate, openingDate, openingIsBulkDay })
  assert.equal(d('2020-11-18', null, '2020-11-20').grade, 'green')
  assert.equal(d('2026-02-07', null, '2019-02-13').grade, 'yellow')
  assert.match(d('2026-02-07', null, '2019-02-13').reason!, /import stamp/)
  assert.equal(d('2021-06-01', null, '2022-05-23', true).grade, 'orange')
  assert.equal(d('2022-05-23', null, '2022-05-23', true).grade, 'green')
  const po = d('2020-12-01', '2020-11-16', '2020-12-01')
  assert.equal(po.grade, 'yellow')
  assert.equal(po.source, 'po')
  assert.equal(po.candidate, '2020-11-16')
  assert.match(po.reason!, /in-stock date/)
  assert.equal(d('2020-01-01', null, null).grade, 'none')
})

test('cost grades', () => {
  assert.equal(gradeCost({ amc: null, current: 100, estimated: false }).grade, 'yellow')
  assert.equal(gradeCost({ amc: 100.5, current: 100, estimated: false }).grade, 'green')
  const e = gradeCost({ amc: 480.7, current: 520, estimated: true })
  assert.equal(e.grade, 'yellow')
  assert.match(e.reason!, /estimate/)
  assert.equal(gradeCost({ amc: 5, current: null, estimated: false }).grade, 'none')
})

test('status cross-check', () => {
  assert.equal(gradeStatus({ amcStatus: 'AVAILABLE', state: 'sold' }).grade, 'orange')
  assert.equal(gradeStatus({ amcStatus: 'SOLD', state: 'held' }).grade, 'none')
  assert.match(gradeStatus({ amcStatus: 'SOLD', state: 'held' }).reason!, /never recorded the disposal/)
  assert.equal(gradeStatus({ amcStatus: 'SOLD', state: 'sold' }).grade, 'none')
  assert.equal(gradeStatus({ amcStatus: 'CHECKED_OUT', state: 'held' }).grade, 'none')
})
