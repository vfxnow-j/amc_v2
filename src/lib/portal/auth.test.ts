import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PORTAL_RATE_LIMITS,
  UNAUTHORIZED_MESSAGE,
  clientIp,
  clientIpConfigFromEnv,
  evaluatePortalClient,
  generatePortalToken,
  hashPortalToken,
  ipAllowed,
  parseBearer,
  parseCidr,
  portalRateLimit,
  rateClassFor,
  type ClientIpConfig,
  type PortalClientGateRow,
} from './auth-core'
import { noStore } from './errors'

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
const v = (ip: string | null) => ({ ip, verifiable: true })
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
  const r = evaluatePortalClient(null, { scope: 'portal:read', ip: v('10.0.0.1'), now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [401, 'unauthorized'])
})

test('inactive client is a 401', () => {
  const r = evaluatePortalClient(row({ isActive: false }), { scope: 'portal:read', ip: v(null), now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [401, 'unauthorized'])
})

test('expired client is a 401; not-yet-expired passes', () => {
  const expired = evaluatePortalClient(row({ expiresAt: new Date('2026-09-26T11:59:59Z') }), {
    scope: 'portal:read',
    ip: v(null),
    now,
  })
  assert.deepEqual(expired.ok ? null : [expired.status, expired.code], [401, 'unauthorized'])
  const atNow = evaluatePortalClient(row({ expiresAt: now }), { scope: 'portal:read', ip: v(null), now })
  assert.equal(atNow.ok, false)
  const later = evaluatePortalClient(row({ expiresAt: new Date('2026-09-27T00:00:00Z') }), {
    scope: 'portal:read',
    ip: v(null),
    now,
  })
  assert.equal(later.ok, true)
})

test('missing scope is a 403 insufficient_scope', () => {
  const r = evaluatePortalClient(row({ scopes: ['portal:read'] }), { scope: 'portal:write', ip: v(null), now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [403, 'insufficient_scope'])
  const ok = evaluatePortalClient(row({ scopes: ['portal:read', 'portal:write'] }), {
    scope: 'portal:write',
    ip: v(null),
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
    ip: v('8.8.8.8'),
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

test('client IP config comes from env: header wins, then hops, else none', () => {
  assert.deepEqual(clientIpConfigFromEnv({}), { mode: 'none' })
  assert.deepEqual(clientIpConfigFromEnv({ PORTAL_CLIENT_IP_HEADER: ' X-Real-IP ' }), {
    mode: 'header',
    header: 'x-real-ip',
  })
  assert.deepEqual(clientIpConfigFromEnv({ PORTAL_CLIENT_IP_HEADER: 'x-real-ip', PORTAL_TRUSTED_PROXY_HOPS: '1' }), {
    mode: 'header',
    header: 'x-real-ip',
  })
  assert.deepEqual(clientIpConfigFromEnv({ PORTAL_TRUSTED_PROXY_HOPS: '2' }), { mode: 'hops', hops: 2 })
  for (const bad of ['0', '-1', '1.5', 'one', '']) {
    assert.deepEqual(clientIpConfigFromEnv({ PORTAL_TRUSTED_PROXY_HOPS: bad }), { mode: 'none' }, bad)
  }
})

test('clientIp, header mode: reads only the configured header, one address', () => {
  const cfg: ClientIpConfig = { mode: 'header', header: 'x-real-ip' }
  assert.deepEqual(clientIp(headers({ 'x-real-ip': '10.8.0.3' }), cfg), { ip: '10.8.0.3', verifiable: true })
  // A spoofed x-forwarded-for is ignored entirely.
  assert.deepEqual(clientIp(headers({ 'x-forwarded-for': '10.8.0.9', 'x-real-ip': '203.0.113.5' }), cfg), {
    ip: '203.0.113.5',
    verifiable: true,
  })
  assert.deepEqual(clientIp(headers({ 'x-forwarded-for': '10.8.0.9' }), cfg), { ip: null, verifiable: true })
  // The proxy overwrites the header; a list means it didn't.
  assert.deepEqual(clientIp(headers({ 'x-real-ip': '10.8.0.9, 203.0.113.5' }), cfg), { ip: null, verifiable: true })
  assert.deepEqual(clientIp(headers({ 'x-real-ip': 'nonsense' }), cfg), { ip: null, verifiable: true })
})

test('clientIp, hops mode: counts from the right and ignores a spoofed leftmost value', () => {
  const one: ClientIpConfig = { mode: 'hops', hops: 1 }
  const two: ClientIpConfig = { mode: 'hops', hops: 2 }
  const spoofed = headers({ 'x-forwarded-for': '10.8.0.9, 203.0.113.5' })
  assert.equal(clientIp(spoofed, one).ip, '203.0.113.5')
  assert.equal(clientIp(spoofed, two).ip, '10.8.0.9')
  assert.equal(clientIp(headers({ 'x-forwarded-for': '10.8.0.9, 203.0.113.5, 172.17.0.1' }), two).ip, '203.0.113.5')
  assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.5' }), two).ip, null) // fewer hops than proxies
  assert.equal(clientIp(headers({}), one).ip, null)
  assert.equal(clientIp(headers({ 'x-forwarded-for': '10.8.0.9, nonsense' }), one).ip, null)
  // x-real-ip is not consulted in hops mode.
  assert.equal(clientIp(headers({ 'x-real-ip': '10.8.0.3' }), one).ip, null)
})

test('clientIp, unconfigured: no address and not verifiable, whatever the headers say', () => {
  const none: ClientIpConfig = { mode: 'none' }
  assert.deepEqual(clientIp(headers({ 'x-forwarded-for': '10.8.0.2', 'x-real-ip': '10.8.0.3' }), none), {
    ip: null,
    verifiable: false,
  })
})

test('an allowlist with an unverifiable address fails closed; no allowlist is not checked', () => {
  const unknown = { ip: null, verifiable: false }
  const r = evaluatePortalClient(row({ allowedCidrs: ['10.8.0.0/24'] }), { scope: 'portal:read', ip: unknown, now })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [403, 'ip_unverifiable'])
  assert.equal(evaluatePortalClient(row(), { scope: 'portal:read', ip: unknown, now }).ok, true)
})

test('a spoofed leftmost x-forwarded-for cannot pass the allowlist', () => {
  const spoofed = headers({ 'x-forwarded-for': '10.8.0.9, 203.0.113.5' })
  const r = evaluatePortalClient(row({ allowedCidrs: ['10.8.0.0/24'] }), {
    scope: 'portal:read',
    ip: clientIp(spoofed, { mode: 'hops', hops: 1 }),
    now,
  })
  assert.deepEqual(r.ok ? null : [r.status, r.code], [403, 'forbidden_ip'])
})

test('every 401 carries the same message; the reason is separate', () => {
  const reasons = [
    evaluatePortalClient(null, { scope: 'portal:read', ip: v(null), now }),
    evaluatePortalClient(row({ isActive: false }), { scope: 'portal:read', ip: v(null), now }),
    evaluatePortalClient(row({ expiresAt: now }), { scope: 'portal:read', ip: v(null), now }),
  ].map((r) => {
    assert.equal(r.ok, false)
    if (r.ok) return null
    assert.equal(r.message, UNAUTHORIZED_MESSAGE)
    return r.reason
  })
  assert.deepEqual(reasons, ['unknown_token', 'revoked', 'expired'])
})

test('rate limits are per kind of call: 300 reads, 60 writes, 30 quotes; billing is a read', () => {
  assert.deepEqual(PORTAL_RATE_LIMITS, { read: 300, write: 60, quote: 30 })
  assert.equal(rateClassFor('portal:billing'), 'read')
  assert.deepEqual(portalRateLimit('portal:read'), { namespace: 'portal:read', limit: 300 })
  assert.deepEqual(portalRateLimit('portal:billing'), { namespace: 'portal:read', limit: 300 })
  assert.deepEqual(portalRateLimit('portal:write'), { namespace: 'portal:write', limit: 60 })
  assert.deepEqual(portalRateLimit('portal:quote'), { namespace: 'portal:quote', limit: 30 })
  // The client's own limit replaces the read limit only.
  assert.deepEqual(portalRateLimit('portal:read', 1000), { namespace: 'portal:read', limit: 1000 })
  assert.deepEqual(portalRateLimit('portal:write', 1000), { namespace: 'portal:write', limit: 60 })
  assert.deepEqual(portalRateLimit('portal:quote', 1000), { namespace: 'portal:quote', limit: 30 })
  assert.deepEqual(portalRateLimit('portal:read', 0), { namespace: 'portal:read', limit: 300 })
  assert.deepEqual(portalRateLimit('portal:read', Number.NaN), { namespace: 'portal:read', limit: 300 })
})

test('noStore sets no-store, and copies a response whose headers are immutable', async () => {
  const plain = noStore(new Response('ok'))
  assert.equal(plain.headers.get('cache-control'), 'no-store')
  const immutable = Response.redirect('https://example.com/', 302)
  assert.throws(() => immutable.headers.set('x', 'y'))
  const copied = noStore(immutable)
  assert.equal(copied.status, 302)
  assert.equal(copied.headers.get('cache-control'), 'no-store')
  assert.equal(copied.headers.get('location'), 'https://example.com/')
})

test('clientIpConfigFromEnv, relay: a long enough secret wins over the other settings', () => {
  const secret = 'r'.repeat(40)
  assert.deepEqual(clientIpConfigFromEnv({ PORTAL_RELAY_SECRET: secret, PORTAL_CLIENT_IP_HEADER: 'x-real-ip' }), { mode: 'relay', secret })
  assert.deepEqual(clientIpConfigFromEnv({ PORTAL_RELAY_SECRET: 'short' }), { mode: 'none' })
})

test('clientIp, relay mode: trusts x-real-ip only with the matching stamp', () => {
  const cfg = { mode: 'relay', secret: 's'.repeat(40) } as const
  const stamped = { 'x-portal-relay': 's'.repeat(40), 'x-real-ip': '10.8.0.1' }
  assert.deepEqual(clientIp(headers(stamped), cfg), { ip: '10.8.0.1', verifiable: true })
  // A caller that skips the relay and sets the headers itself gets nothing.
  assert.deepEqual(clientIp(headers({ 'x-real-ip': '10.8.0.1' }), cfg), { ip: null, verifiable: true })
  assert.deepEqual(clientIp(headers({ 'x-portal-relay': 'x'.repeat(40), 'x-real-ip': '10.8.0.1' }), cfg), { ip: null, verifiable: true })
  assert.deepEqual(clientIp(headers({ 'x-portal-relay': 'short', 'x-real-ip': '10.8.0.1' }), cfg), { ip: null, verifiable: true })
  assert.deepEqual(clientIp(headers({ ...stamped, 'x-real-ip': '10.8.0.1, 10.8.0.9' }), cfg), { ip: null, verifiable: true })
})
