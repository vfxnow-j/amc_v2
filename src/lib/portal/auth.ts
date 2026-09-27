import type { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { portalError } from './errors'
import {
  clientIp,
  evaluatePortalClient,
  hashPortalToken,
  parseBearer,
  type PortalScope,
} from './auth-core'

export { PORTAL_SCOPES, isPortalScope, type PortalScope } from './auth-core'

/** Who is calling. Deliberately no role and no userId — a portal is not staff. */
export type PortalPrincipal = { id: string; name: string; scopes: PortalScope[] }

export type PortalAuthResult =
  | { ok: true; portal: PortalPrincipal }
  | { ok: false; response: NextResponse; portalClientId?: string }

const LAST_USED_THROTTLE_MS = 60_000

/**
 * The gate in front of every /v1 route: bearer token → SHA-256 → PortalClient;
 * active and unexpired; caller IP inside `allowedCidrs` (fail closed when a
 * list is set); the route's scope; the client's per-minute rate limit.
 */
export async function authorizePortal(req: NextRequest | Request, scope: PortalScope): Promise<PortalAuthResult> {
  const token = parseBearer(req.headers.get('authorization'))
  if (!token) {
    return {
      ok: false,
      response: portalError(401, 'unauthorized', 'Missing or malformed bearer token', {
        headers: { 'WWW-Authenticate': 'Bearer realm="vfxnow-portal"' },
      }),
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

  const gate = evaluatePortalClient(client, { scope, ip: clientIp(req.headers) })
  if (!gate.ok) {
    return {
      ok: false,
      portalClientId: client?.id,
      response: portalError(gate.status, gate.code, gate.message),
    }
  }
  // evaluatePortalClient returned ok, so the row exists.
  const row = client!

  const limit = checkRateLimit('portal', row.id, Math.max(1, row.rateLimitPerMin), 60_000)
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
