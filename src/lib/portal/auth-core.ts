import crypto from 'node:crypto'
import net from 'node:net'

/**
 * The pure half of portal authentication: no database, no Next. Everything
 * here is unit-tested in auth.test.ts; `auth.ts` wires it to Prisma.
 */

export const PORTAL_SCOPES = ['portal:read', 'portal:quote', 'portal:write', 'portal:billing'] as const
export type PortalScope = (typeof PORTAL_SCOPES)[number]

export const PORTAL_TOKEN_PREFIX = 'vfxp_'

export function isPortalScope(value: string): value is PortalScope {
  return (PORTAL_SCOPES as readonly string[]).includes(value)
}

/** SHA-256 hex, the same hashing ApiKey uses (lib/api-auth.ts). */
export function hashPortalToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** A fresh token and what gets stored for it. The raw token is shown once. */
export function generatePortalToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${PORTAL_TOKEN_PREFIX}${crypto.randomBytes(24).toString('hex')}`
  return { token, tokenHash: hashPortalToken(token), tokenPrefix: token.slice(0, 13) }
}

/** The token from `Authorization: Bearer vfxp_…`, or null. Header only — no query-string fallback. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match) return null
  const token = match[1]
  if (!token.startsWith(PORTAL_TOKEN_PREFIX) || token.length < 20 || token.length > 200) return null
  return token
}

/**
 * How the caller's address is found. It is never guessed from headers a caller
 * can set: Next only fills `x-forwarded-for` when it is absent, so its
 * leftmost value is whatever the caller sent. One of two settings must say
 * which value a trusted reverse proxy wrote:
 *
 * - `PORTAL_CLIENT_IP_HEADER` (e.g. `x-real-ip`): a header the proxy
 *   **overwrites** with `$remote_addr`. Only that header is read, and it must
 *   hold exactly one address.
 * - `PORTAL_TRUSTED_PROXY_HOPS` (integer ≥ 1): the number of proxies that each
 *   append to `x-forwarded-for`. The address that many entries from the right
 *   is the one the outermost trusted proxy saw; anything to its left is the
 *   caller's own claim and is ignored.
 *
 * - `PORTAL_RELAY_SECRET` (≥ 32 characters): the tunnel relay
 *   (scripts/portal-relay.mjs) is the proxy. It listens only on the WireGuard
 *   address, overwrites `x-real-ip` with the TCP socket's address and stamps
 *   `x-portal-relay` with this secret. The address is trusted only when the
 *   stamp matches, so a caller reaching the app directly cannot forge it.
 *   Takes precedence over the other two.
 *
 * With none set the address is unverifiable: a client with an allowlist
 * is refused (`ip_unverifiable`), a client without one is not checked.
 */
export type ClientIpConfig =
  | { mode: 'relay'; secret: string }
  | { mode: 'header'; header: string }
  | { mode: 'hops'; hops: number }
  | { mode: 'none' }

export const RELAY_SECRET_HEADER = 'x-portal-relay'
export const RELAY_ADDRESS_HEADER = 'x-real-ip'

export function clientIpConfigFromEnv(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const secret = env.PORTAL_RELAY_SECRET?.trim()
  if (secret && secret.length >= 32) return { mode: 'relay', secret }
  const header = env.PORTAL_CLIENT_IP_HEADER?.trim().toLowerCase()
  if (header) return { mode: 'header', header }
  const hopsRaw = env.PORTAL_TRUSTED_PROXY_HOPS?.trim()
  if (hopsRaw && /^\d+$/.test(hopsRaw) && Number(hopsRaw) >= 1) return { mode: 'hops', hops: Number(hopsRaw) }
  return { mode: 'none' }
}

/** The caller's address under `config`; `verifiable: false` when no source is configured. */
export type ClientIp = { ip: string | null; verifiable: boolean }

export function clientIp(headers: { get(name: string): string | null }, config: ClientIpConfig): ClientIp {
  if (config.mode === 'relay') {
    const stamp = headers.get(RELAY_SECRET_HEADER) ?? ''
    const a = Buffer.from(stamp)
    const b = Buffer.from(config.secret)
    // Not through the relay (or a forged stamp): the address is unknown, so an
    // allowlisted client is refused rather than trusted.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ip: null, verifiable: true }
    const value = headers.get(RELAY_ADDRESS_HEADER)?.trim()
    if (!value || value.includes(',')) return { ip: null, verifiable: true }
    return { ip: normalizeIp(value), verifiable: true }
  }
  if (config.mode === 'header') {
    const value = headers.get(config.header)?.trim()
    // The proxy overwrites this header with one address; a list means it didn't.
    if (!value || value.includes(',')) return { ip: null, verifiable: true }
    return { ip: normalizeIp(value), verifiable: true }
  }
  if (config.mode === 'hops') {
    const hops = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (hops.length < config.hops) return { ip: null, verifiable: true }
    return { ip: normalizeIp(hops[hops.length - config.hops]), verifiable: true }
  }
  return { ip: null, verifiable: false }
}

/** Strips an IPv4-mapped IPv6 prefix and any zone/port noise; null if not an IP. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim()
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'))
  const zone = ip.indexOf('%')
  if (zone >= 0) ip = ip.slice(0, zone)
  if (/^::ffff:/i.test(ip) && net.isIPv4(ip.slice(7))) ip = ip.slice(7)
  // "1.2.3.4:5678" from some proxies.
  if (!net.isIP(ip) && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))
  return net.isIP(ip) ? ip : null
}

export type ParsedCidr = { address: string; prefix: number; family: 'ipv4' | 'ipv6' }

/** "10.8.0.0/24", "fd00::/64", or a bare address (a /32 or /128). Null if malformed. */
export function parseCidr(raw: string): ParsedCidr | null {
  const [addressPart, prefixPart, ...rest] = raw.trim().split('/')
  if (rest.length) return null
  const address = normalizeIp(addressPart ?? '')
  if (!address) return null
  const family = net.isIPv4(address) ? 'ipv4' : 'ipv6'
  const max = family === 'ipv4' ? 32 : 128
  if (prefixPart === undefined) return { address, prefix: max, family }
  if (!/^\d{1,3}$/.test(prefixPart)) return null
  const prefix = Number(prefixPart)
  if (prefix < 0 || prefix > max) return null
  return { address, prefix, family }
}

/**
 * Whether `ip` falls in any of `cidrs`. An empty list means no restriction.
 * A non-empty list fails closed: no IP, an unparseable IP, or only malformed
 * entries all deny.
 */
export function ipAllowed(ip: string | null, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return true
  if (!ip) return false
  const address = normalizeIp(ip)
  if (!address) return false
  const list = new net.BlockList()
  let any = false
  for (const raw of cidrs) {
    const cidr = parseCidr(raw)
    if (!cidr) continue
    list.addSubnet(cidr.address, cidr.prefix, cidr.family)
    any = true
  }
  if (!any) return false
  return list.check(address, net.isIPv4(address) ? 'ipv4' : 'ipv6')
}

/** The columns of PortalClient the gate reads. */
export type PortalClientGateRow = {
  id: string
  name: string
  scopes: string[]
  allowedCidrs: string[]
  isActive: boolean
  expiresAt: Date | null
}

/** Why a 401 happened. Logged on the server only; every 401 body says the same thing. */
export type UnauthorizedReason = 'missing_token' | 'unknown_token' | 'revoked' | 'expired'

/** The one 401 message, so a caller can't tell a revoked token from a wrong one. */
export const UNAUTHORIZED_MESSAGE = 'Invalid or missing token'

export type GateFailure = {
  ok: false
  status: 401 | 403
  code: 'unauthorized' | 'forbidden_ip' | 'ip_unverifiable' | 'insufficient_scope'
  message: string
  reason?: UnauthorizedReason
}

const unauthorized = (reason: UnauthorizedReason): GateFailure => ({
  ok: false,
  status: 401,
  code: 'unauthorized',
  message: UNAUTHORIZED_MESSAGE,
  reason,
})

/**
 * Every check after the token lookup, in order: active, unexpired, IP, scope.
 * A missing/unknown token is the caller's 401 before this runs.
 */
export function evaluatePortalClient(
  client: PortalClientGateRow | null,
  input: { scope: PortalScope; ip: ClientIp; now?: Date },
): { ok: true } | GateFailure {
  const now = input.now ?? new Date()
  if (!client) return unauthorized('unknown_token')
  if (!client.isActive) return unauthorized('revoked')
  if (client.expiresAt && client.expiresAt <= now) return unauthorized('expired')
  if (client.allowedCidrs.length > 0 && !input.ip.verifiable) {
    return {
      ok: false,
      status: 403,
      code: 'ip_unverifiable',
      message:
        'This token has an address allowlist, but the server is not configured to know the caller address',
    }
  }
  if (!ipAllowed(input.ip.ip, client.allowedCidrs)) {
    return { ok: false, status: 403, code: 'forbidden_ip', message: 'Caller address is not allowed for this token' }
  }
  if (!client.scopes.includes(input.scope)) {
    return { ok: false, status: 403, code: 'insufficient_scope', message: `Token lacks scope ${input.scope}` }
  }
  return { ok: true }
}

/**
 * Requests per minute, per client, per kind of call (docs/portal-api-plan.md
 * §7). Each kind has its own bucket, so a burst of quotes can't starve reads.
 * `portal:billing` is a read. The client's `rateLimitPerMin` (default 300) is
 * the read limit; writes and quotes are fixed.
 */
export const PORTAL_RATE_LIMITS = { read: 300, write: 60, quote: 30 } as const
export type PortalRateClass = keyof typeof PORTAL_RATE_LIMITS

export function rateClassFor(scope: PortalScope): PortalRateClass {
  if (scope === 'portal:write') return 'write'
  if (scope === 'portal:quote') return 'quote'
  return 'read'
}

export function portalRateLimit(
  scope: PortalScope,
  clientReadLimit?: number | null,
): { namespace: string; limit: number } {
  const kind = rateClassFor(scope)
  const override =
    kind === 'read' && typeof clientReadLimit === 'number' && Number.isFinite(clientReadLimit) && clientReadLimit >= 1
      ? Math.floor(clientReadLimit)
      : null
  return { namespace: `portal:${kind}`, limit: override ?? PORTAL_RATE_LIMITS[kind] }
}
