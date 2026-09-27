'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { generatePortalToken, isPortalScope, parseCidr } from '@/lib/portal/auth-core'
import {
  encryptPortalSecret,
  generateWebhookSecret,
  portalSecretKeyConfigured,
} from '@/lib/portal/secrets'

/**
 * Settings → API keys → Portal clients. Admin only.
 *
 * A portal client is not an ApiKey: it carries scopes, never a staff role
 * (docs/portal-api-plan.md §1). The token — and the webhook secret, when one
 * is made — is returned once, from the call that creates it, and never again.
 * The webhook secret is only made when PORTAL_SECRET_KEY is set, because it
 * must be stored encrypted; a client without one still authenticates.
 */

const PATH = '/dashboard/settings/api-keys'

export type CreatePortalClientInput = {
  name: string
  scopes: string[]
  allowedCidrs?: string[]
  webhookUrl?: string | null
  withWebhookSecret?: boolean
  rateLimitPerMin?: number
  expiresAt?: string | null
}

export type CreatePortalClientResult = {
  id: string
  token: string
  webhookSecret: string | null
  /** Why no secret was made, when one was asked for. */
  webhookSecretSkipped: string | null
}

async function admin() {
  const result = await requireAdmin()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Admin access required')
  return result.userId
}

function cleanScopes(scopes: string[]) {
  const clean = [...new Set(scopes.map((s) => s.trim()))].filter(isPortalScope)
  if (!clean.length) throw new Error('Pick at least one scope')
  return clean
}

function cleanCidrs(cidrs: string[] | undefined) {
  const list = (cidrs ?? []).map((c) => c.trim()).filter(Boolean)
  const bad = list.filter((c) => !parseCidr(c))
  if (bad.length) throw new Error(`Not an address or CIDR: ${bad.join(', ')}`)
  return [...new Set(list)]
}

function cleanWebhookUrl(url: string | null | undefined) {
  const value = url?.trim()
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Webhook URL is not a valid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Webhook URL must be http or https')
  }
  return parsed.toString()
}

const NO_KEY =
  'No webhook secret was made: PORTAL_SECRET_KEY is not set on the server, and a secret is never stored unencrypted. The token works; add the key and rotate the secret to make one.'

export async function createPortalClient(input: CreatePortalClientInput): Promise<CreatePortalClientResult> {
  const userId = await admin()
  const name = input.name?.trim()
  if (!name) throw new Error('Give the portal client a name')
  const scopes = cleanScopes(input.scopes ?? [])
  const allowedCidrs = cleanCidrs(input.allowedCidrs)
  const webhookUrl = cleanWebhookUrl(input.webhookUrl)
  const rateLimitPerMin = Math.min(10_000, Math.max(1, Math.round(input.rateLimitPerMin ?? 300)))
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Expiry is not a date')

  let webhookSecret: string | null = null
  let webhookSecretEnc: string | null = null
  let webhookSecretSkipped: string | null = null
  if (input.withWebhookSecret) {
    if (portalSecretKeyConfigured()) {
      webhookSecret = generateWebhookSecret()
      webhookSecretEnc = encryptPortalSecret(webhookSecret)
    } else {
      webhookSecretSkipped = NO_KEY
    }
  }

  const { token, tokenHash, tokenPrefix } = generatePortalToken()
  const created = await prisma.portalClient.create({
    data: {
      name,
      tokenHash,
      tokenPrefix,
      scopes,
      allowedCidrs,
      webhookUrl,
      webhookSecretEnc,
      rateLimitPerMin,
      expiresAt,
      createdById: userId,
    },
    select: { id: true },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Portal',
    entityId: created.id,
    newValues: {
      kind: 'portal_client',
      name,
      tokenPrefix,
      scopes,
      allowedCidrs,
      webhookUrl,
      hasWebhookSecret: !!webhookSecretEnc,
      rateLimitPerMin,
      expiresAt,
    },
    userId,
  })

  revalidatePath(PATH)
  return { id: created.id, token, webhookSecret, webhookSecretSkipped }
}

/** A new token; the old one stops working at once. */
export async function rotatePortalClientToken(id: string): Promise<{ token: string }> {
  const userId = await admin()
  const existing = await prisma.portalClient.findUnique({ where: { id }, select: { tokenPrefix: true } })
  if (!existing) throw new Error('Portal client not found')

  const { token, tokenHash, tokenPrefix } = generatePortalToken()
  await prisma.portalClient.update({ where: { id }, data: { tokenHash, tokenPrefix } })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Portal',
    entityId: id,
    oldValues: { tokenPrefix: existing.tokenPrefix },
    newValues: { kind: 'portal_client', event: 'token_rotated', tokenPrefix },
    userId,
  })
  revalidatePath(PATH)
  return { token }
}

/** A new webhook signing secret. Refuses without PORTAL_SECRET_KEY. */
export async function rotatePortalWebhookSecret(id: string): Promise<{ webhookSecret: string }> {
  const userId = await admin()
  if (!portalSecretKeyConfigured()) throw new Error(NO_KEY)
  const existing = await prisma.portalClient.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw new Error('Portal client not found')

  const webhookSecret = generateWebhookSecret()
  await prisma.portalClient.update({
    where: { id },
    data: { webhookSecretEnc: encryptPortalSecret(webhookSecret) },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Portal',
    entityId: id,
    newValues: { kind: 'portal_client', event: 'webhook_secret_rotated' },
    userId,
  })
  revalidatePath(PATH)
  return { webhookSecret }
}

/** Stops the token working. The row stays so the request log keeps its name. */
export async function revokePortalClient(id: string): Promise<void> {
  const userId = await admin()
  await prisma.portalClient.update({ where: { id }, data: { isActive: false } })
  await logAudit({
    action: 'UPDATE',
    entityType: 'Portal',
    entityId: id,
    newValues: { kind: 'portal_client', event: 'revoked', isActive: false },
    userId,
  })
  revalidatePath(PATH)
}
