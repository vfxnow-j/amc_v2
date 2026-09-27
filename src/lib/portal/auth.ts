import type { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { portalError } from './errors'
import {
  UNAUTHORIZED_MESSAGE,
  clientIp,
  clientIpConfigFromEnv,
  evaluatePortalClient,
  hashPortalToken,
  parseBearer,
  portalRateLimit,
  type PortalScope,
} from './auth-core'

export { PORTAL_SCOPES, isPortalScope, type PortalScope } from './auth-core'

/** Who is calling. Deliberately no role and no userId — a portal is not staff. */
export type PortalPrincipal = { id: string; name: string; scopes: PortalScope[] }

export type PortalAuthResult =
  | { ok: true; portal: PortalPrincipal }
  | { ok: false; response: NextResponse; portalClientId?: string }

const LAST_USED_THROTTLE_MS = 60_000

const BEARER_CHALLENGE = { 'WWW-Authenticate': 'Bearer realm="vfxnow-portal"' }

let warnedUnverifiable = false

/**
 * The gate in front of every /v1 route: bearer token → SHA-256 → PortalClient;
 * active and unexpired; caller IP inside `allowedCidrs` (fail closed when a
 * list is set, and when the server can't tell the caller's address — see
 * `clientIp`); the route's scope; the per-minute limit for that kind of call.
 *
 * Every 401 says the same thing; which one it was goes to the server log only.
 */
export async function authorizePortal(req: NextRequest | Request, scope: PortalScope): Promise<PortalAuthResult> {
  const token = parseBearer(req.headers.get('authorization'))
  if (!token) {
    return {
      ok: false,
      response: portalError(401, 'unauthorized', UNAUTHORIZED_MESSAGE, { headers: BEARER_CHALLENGE }),
    }
  }

  const client = await prisma.portalClient.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    select: {
      id: true,
      name: true,
      scopes: true,
      allowedCidrs: true,
      isActive: true,
      expiresAt: true,
      rateLimitPerMin: true,
      lastUsedAt: true,
    },
  })

  const gate = evaluatePortalClient(client, { scope, ip: clientIp(req.headers, clientIpConfigFromEnv()) })
  if (!gate.ok) {
    if (gate.reason && gate.reason !== 'unknown_token') {
      console.warn(`[portal] 401 ${gate.reason} for portal client ${client?.id}`)
    }
    if (gate.code === 'ip_unverifiable' && !warnedUnverifiable) {
      warnedUnverifiable = true
      console.error(
        '[portal] A portal client has an address allowlist but none of PORTAL_RELAY_SECRET, PORTAL_CLIENT_IP_HEADER or PORTAL_TRUSTED_PROXY_HOPS is set, so its requests are refused (ip_unverifiable). See docs/portal-api-plan.md, Hosting checklist.',
      )
    }
    return {
      ok: false,
      portalClientId: client?.id,
      response: portalError(gate.status, gate.code, gate.message, {
        headers: gate.status === 401 ? BEARER_CHALLENGE : undefined,
      }),
    }
  }
  // evaluatePortalClient returned ok, so the row exists.
  const row = client!

  const bucket = portalRateLimit(scope, row.rateLimitPerMin)
  const limit = checkRateLimit(bucket.namespace, row.id, bucket.limit, 60_000)
  if (!limit.allowed) {
    return {
      ok: false,
      portalClientId: row.id,
      response: portalError(429, 'rate_limited', 'Rate limit exceeded', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }),
    }
  }

  touchLastUsed(row.id, row.lastUsedAt)

  return {
    ok: true,
    portal: { id: row.id, name: row.name, scopes: row.scopes as PortalScope[] },
  }
}

/** At most one write a minute per client; the WHERE makes it safe across instances. */
function touchLastUsed(id: string, lastUsedAt: Date | null) {
  const now = Date.now()
  if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return
  prisma.portalClient
    .updateMany({
      where: {
        id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - LAST_USED_THROTTLE_MS) } }],
      },
      data: { lastUsedAt: new Date(now) },
    })
    .catch(() => {})
}
