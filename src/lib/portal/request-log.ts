import { prisma } from '@/lib/prisma'

/**
 * One row per /v1 request in portal_request_log: method, path, status, ms,
 * client and account. Never bodies, never query strings, never headers.
 * Fire-and-forget — a logging failure never fails the request.
 */
export type PortalRequestLogEntry = {
  method: string
  path: string
  status: number
  ms: number
  portalClientId?: string | null
  accountId?: string | null
}

/** The rewritten `/api/v1/portal/x` back to the contract's `/v1/x`; no query string. */
export function contractPath(pathname: string): string {
  const path = pathname.split('?')[0]
  return path.startsWith('/api/v1/portal') ? `/v1${path.slice('/api/v1/portal'.length)}` : path
}

export function logPortalRequest(entry: PortalRequestLogEntry): void {
  prisma.portalRequestLog
    .create({
      data: {
        method: entry.method.slice(0, 10),
        path: contractPath(entry.path).slice(0, 500),
        status: entry.status,
        ms: Math.max(0, Math.round(entry.ms)),
        portalClientId: entry.portalClientId ?? null,
        accountId: entry.accountId ?? null,
      },
    })
    .catch(() => {})
}

/** Delete rows older than `days` (plan: kept 30 days). For a cron; returns the count. */
export async function prunePortalRequestLog(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const { count } = await prisma.portalRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return count
}
