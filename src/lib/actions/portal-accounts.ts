'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireEditor } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { getPortalAccountPanel, relinkPortalAccount, type PortalAccountPanel } from '@/lib/portal/accounts'

/**
 * Client record → "Portal account" panel (docs/portal-api-plan.md §2, owner
 * answer 5). Reading the panel only needs edit access, since it's reference
 * information already visible on the record; re-linking moves data between
 * two AMC clients and is admin-only, like other cross-record moves (e.g.
 * Locations removal).
 */

export type PortalAccountActionResult = { ok: true } | { ok: false; error: string }

async function editor() {
  const result = await requireEditor()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Edit access required')
  return result.userId
}

async function admin() {
  const result = await requireAdmin()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Admin access required')
  return result.userId
}

export async function getPortalAccountPanelData(clientId: string): Promise<PortalAccountPanel> {
  await editor()
  return getPortalAccountPanel(prisma, clientId)
}

/** Up to 10 clients with no portal account yet, matching the search text. */
export async function searchClientsForRelink(
  query: string,
): Promise<{ id: string; name: string; companyName: string | null }[]> {
  await editor()
  const q = query.trim()
  if (q.length < 2) return []
  return prisma.client.findMany({
    where: {
      portalAccount: null,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { companyName: { contains: q, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, companyName: true },
    orderBy: { name: 'asc' },
    take: 10,
  })
}

/** Moves a portal account onto a different, existing AMC client. Admin only. */
export async function relinkPortalAccountToClient(
  accountId: string,
  targetClientId: string,
): Promise<PortalAccountActionResult> {
  const userId = await admin()
  try {
    const { fromClientId } = await relinkPortalAccount(prisma, accountId, targetClientId)
    if (fromClientId !== targetClientId) {
      await logAudit({
        action: 'UPDATE',
        entityType: 'Portal',
        entityId: accountId,
        oldValues: { kind: 'portal_account_relink', clientId: fromClientId },
        newValues: { kind: 'portal_account_relink', clientId: targetClientId },
        userId,
      })
      revalidatePath(`/dashboard/clients/${fromClientId}`)
      revalidatePath(`/dashboard/clients/${targetClientId}`)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That did not save.' }
  }
}
