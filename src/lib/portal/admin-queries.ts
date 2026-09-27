import { prisma } from '@/lib/prisma'

/** Rows for Settings → API keys → Portal clients. Never the token or secret. */
export type PortalClientRow = {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  allowedCidrs: string[]
  webhookUrl: string | null
  hasWebhookSecret: boolean
  rateLimitPerMin: number
  isActive: boolean
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  accounts: number
}

export async function getPortalClientRows(): Promise<PortalClientRow[]> {
  const rows = await prisma.portalClient.findMany({
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      allowedCidrs: true,
      webhookUrl: true,
      webhookSecretEnc: true,
      rateLimitPerMin: true,
      isActive: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      _count: { select: { accounts: true } },
    },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(({ webhookSecretEnc, _count, ...row }) => ({
    ...row,
    hasWebhookSecret: !!webhookSecretEnc,
    accounts: _count.accounts,
  }))
}
