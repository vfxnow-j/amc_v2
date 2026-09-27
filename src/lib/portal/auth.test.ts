import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clientIp,
  evaluatePortalClient,
  generatePortalToken,
  hashPortalToken,
  ipAllowed,
  parseBearer,
  parseCidr,
  type PortalClientGateRow,
} from './auth-core'

const now = new Date('2026-09-26T12:00:00Z')
const row = (over: Partial<PortalClientGateRow> = {}): PortalClientGateRow => ({
  id: 'pc_1',
  name: 'Portal',
  scopes: ['portal:read'],
  allowedCidrs: [],
  isActive: true,
  expiresAt: null,
  ...over,
})
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

test('generated tokens carry the vfxp_ prefix and hash with SHA-256', () => {
  const { token, tokenHash, tokenPrefix } = generatePortalToken()
  assert.match(token, /^vfxp_[0-9a-f]{48}$/)
  assert.equal(tokenPrefix, token.slice(0, 13))
  assert.equal(tokenHash, hashPortalToken(token))
  assert.equal(tokenHash.length, 64)
  assert.notEqual(generatePortalToken().token, token)
})

test('bad or missing bearer tokens parse to null', () => {
  const { token } = generatePortalToken()
  assert.equal(parseBearer(`Bearer ${token}`), token)
  assert.equal(parseBearer(`bearer ${token}`), token)
  assert.equal(parseBearer(null), null)
  assert.equal(parseBearer(''), null)
  assert.equal(parseBearer(token), null) // no scheme
  assert.equal(parseBearer(`Basic ${token}`), null)
  assert.equal(parseBearer('Bearer vfx_0123456789abcdef0123'), null) // a staff ApiKey is not a portal token
  assert.equal(parseBearer('Bearer vfxp_short'), null)
  assert.equal(parseBearer(`Bearer ${token} extra`), null)
})

test('unknown token is a 401', () => {
  const r = evaluatePortalClient(null, { scope: 'portal:read', ip: '10.0.0.1', now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [401, 'unauthorized'])
})

test('inactive client is a 401', () => {
  const r = evaluatePortalClient(row({ isActive: false }), { scope: 'portal:read', ip: null, now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [401, 'unauthorized'])
})

test('expired client is a 401; not-yet-expired passes', () => {
  const expired = evaluatePortalClient(row({ expiresAt: new Date('2026-09-26T11:59:59Z') }), {
    scope: 'portal:read',
    ip: null,
    now,
  })
  assert.deepEqual(expired.ok ? null : [expired.status, expired.code], [401, 'unauthorized'])
  const atNow = evaluatePortalClient(row({ expiresAt: now }), { scope: 'portal:read', ip: null, now })
  assert.equal(atNow.ok, false)
  const later = evaluatePortalClient(row({ expiresAt: new Date('2026-09-27T00:00:00Z') }), {
    scope: 'portal:read',
    ip: null,
    now,
  })
  assert.equal(later.ok, true)
})

test('missing scope is a 403 insufficient_scope', () => {
  const r = evaluatePortalClient(row({ scopes: ['portal:read'] }), { scope: 'portal:write', ip: null, now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [403, 'insufficient_scope'])
  const ok = evaluatePortalClient(row({ scopes: ['portal:read', 'portal:write'] }), {
    scope: 'portal:write',
    ip: null,
    now,
  })
  assert.equal(ok.ok, true)
})

test('CIDR allowlist: empty list allows anyone, a set list fails closed', () => {
  assert.equal(ipAllowed(null, []), true)
  assert.equal(ipAllowed('203.0.113.9', []), true)
  const wg = ['10.8.0.0/24']
  assert.equal(ipAllowed('10.8.0.17', wg), true)
  assert.equal(ipAllowed('10.8.1.17', wg), false)
  assert.equal(ipAllowed(null, wg), false)
  assert.equal(ipAllowed('not-an-ip', wg), false)
  assert.equal(ipAllowed('10.8.0.17', ['garbage']), false) // only malformed entries → deny
  assert.equal(ipAllowed('::ffff:10.8.0.5', wg), true) // IPv4-mapped IPv6
  assert.equal(ipAllowed('fd00::1', ['fd00::/64']), true)
  assert.equal(ipAllowed('fd01::1', ['fd00::/64']), false)
  assert.equal(ipAllowed('192.168.1.10', ['192.168.1.10']), true) // bare address = /32
})

test('CIDR failure is a 403 forbidden_ip, checked before scope', () => {
  const r = evaluatePortalClient(row({ allowedCidrs: ['10.8.0.0/24'], scopes: [] }), {
    scope: 'portal:read',
    ip: '8.8.8.8',
    now,
  })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [403, 'forbidden_ip'])
})

test('parseCidr rejects malformed entries', () => {
  assert.deepEqual(parseCidr('10.8.0.0/24'), { address: '10.8.0.0', prefix: 24, family: 'ipv4' })
  assert.equal(parseCidr('10.8.0.0/33'), null)
  assert.equal(parseCidr('10.8.0/24'), null)
  assert.equal(parseCidr('10.8.0.0/24/1'), null)
  assert.equal(parseCidr('10.8.0.0/x'), null)
  assert.equal(parseCidr('fd00::/129'), null)
})

test('clientIp takes the first x-forwarded-for hop, then x-real-ip', () => {
  assert.equal(clientIp(headers({ 'x-forwarded-for': '10.8.0.2, 172.17.0.1' })), '10.8.0.2')
  assert.equal(clientIp(headers({ 'x-real-ip': '10.8.0.3' })), '10.8.0.3')
  assert.equal(clientIp(headers({})), null)
  assert.equal(clientIp(headers({ 'x-forwarded-for': 'nonsense' })), null)
})
