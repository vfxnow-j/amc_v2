import { prisma } from '@/lib/prisma'
import { notFound } from './errors'

/**
 * Tenant isolation, in one place (plan §2). Every account route resolves
 * `(portalClientId, portalAccountId)` first; a record whose clientId is not
 * linked to the calling portal is a 404, never a 403 — a portal must not
 * learn that another tenant's record exists.
 */

export type PortalAccountRef = {
  id: string
  portalClientId: string
  portalAccountId: string
  clientId: string
  verificationLevel: string
  creditTier: string
}

const ACCOUNT_SELECT = {
  id: true,
  portalClientId: true,
  portalAccountId: true,
  clientId: true,
  verificationLevel: true,
  creditTier: true,
} as const

/** The calling portal's account with this portal-side id, or null. */
export async function resolveAccount(
  portalClientId: string,
  portalAccountId: string,
): Promise<PortalAccountRef | null> {
  if (!portalAccountId) return null
  return prisma.portalAccount.findUnique({
    where: { portalClientId_portalAccountId: { portalClientId, portalAccountId } },
    select: ACCOUNT_SELECT,
  })
}

/** resolveAccount, or throw the 404 withPortal maps. */
export async function requireAccount(portalClientId: string, portalAccountId: string): Promise<PortalAccountRef> {
  const account = await resolveAccount(portalClientId, portalAccountId)
  if (!account) throw notFound('Account not found')
  return account
}

/**
 * The calling portal's account linked to this AMC client, or null. Use it to
 * guard reads of an order or invoice by its own id: null → 404.
 */
export async function accountForClient(
  portalClientId: string,
  clientId: string,
): Promise<PortalAccountRef | null> {
  const account = await prisma.portalAccount.findUnique({ where: { clientId }, select: ACCOUNT_SELECT })
  return account && account.portalClientId === portalClientId ? account : null
}
