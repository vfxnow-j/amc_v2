import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeLike, findSiteMatch, itemIdentity, normKey } from './match'

test('normKey trims, lowercases and collapses whitespace', () => {
  assert.equal(normKey('  Stage   9 '), 'stage 9')
  assert.equal(normKey(null), '')
})

test('wildcards and backslashes are literal in the key and escaped for LIKE', () => {
  assert.notEqual(normKey('Cable_A'), normKey('Cable-A'))
  assert.notEqual(normKey('%'), normKey('Stage 9'))
  assert.equal(escapeLike('50%_off\\x'), '50\\%\\_off\\\\x')
})

test('itemIdentity treats blank and missing the same and ignores case', () => {
  assert.equal(itemIdentity({ name: 'Cam', manufacturer: '', model: undefined }), itemIdentity({ name: 'cam ', manufacturer: null }))
  assert.notEqual(itemIdentity({ name: 'Cable_A' }), itemIdentity({ name: 'Cable-A' }))
})

const day = (n: number) => new Date(Date.UTC(2026, 0, n))
const sites = [
  { id: 'b', name: 'Stage 9', createdAt: day(2) },
  { id: 'a', name: 'stage 9', createdAt: day(1) },
  { id: 'c', name: 'Stage_9', createdAt: day(1) },
  { id: 'd', name: '%', createdAt: day(3) },
]

test('findSiteMatch never treats % or _ as wildcards', () => {
  assert.equal(findSiteMatch(sites, '%')?.id, 'd')
  assert.equal(findSiteMatch(sites.filter((s) => s.id !== 'd'), '%'), undefined)
  assert.equal(findSiteMatch(sites, 'Stage_9')?.id, 'c')
  assert.equal(findSiteMatch(sites, 'Stage %'), undefined)
  assert.equal(findSiteMatch(sites, 'Stage\\ 9'), undefined)
})

test('findSiteMatch is case/space-insensitive and deterministic', () => {
  assert.equal(findSiteMatch(sites, '  STAGE   9')?.id, 'a')
  assert.equal(findSiteMatch([...sites].reverse(), 'stage 9')?.id, 'a')
})

test('findSiteMatch ties go to oldest createdAt, then id, regardless of name casing or input order', () => {
  const tie = [
    { id: 'z', name: 'Dock', createdAt: day(1) },
    { id: 'm', name: 'dock', createdAt: day(1) },
    { id: 'a', name: 'DOCK', createdAt: day(2) },
  ]
  assert.equal(findSiteMatch(tie, 'dock')?.id, 'm')
  assert.equal(findSiteMatch([...tie].reverse(), 'dock')?.id, 'm')
})

test('normKey: NFC vs NFD agree, zero-width characters vanish, fullwidth stays distinct', () => {
  assert.equal(normKey('Café'), normKey('Café'))
  assert.equal(normKey('Sta​ge‍ 9﻿'), 'stage 9')
  assert.notEqual(normKey('ＡＢＣ'), normKey('ABC'))
})
