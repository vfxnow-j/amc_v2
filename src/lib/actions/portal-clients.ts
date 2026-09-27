'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { PORTAL_SCOPES, generatePortalToken, parseCidr } from '@/lib/portal/auth-core'
import { encryptPortalSecret, generateWebhookSecret, readPortalSecretKey } from '@/lib/portal/secrets'

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

const RATE_LIMIT_MAX = 10_000

/**
 * Every admin input, checked before anything is written. The webhook URL is
 * https only — including on the WireGuard network — so a signed payload is
 * never sent in the clear.
 */
const createSchema = z.object({
  name: z
    .string({ error: 'Give the portal client a name' })
    .trim()
    .min(1, 'Give the portal client a name')
    .max(100, 'Keep the name under 100 characters'),
  scopes: z
    .array(z.string().trim())
    .transform((list) => [...new Set(list)])
    .pipe(
      z
        .array(z.enum(PORTAL_SCOPES, { error: (issue) => `Not a portal scope: ${String(issue.input)}` }))
        .min(1, 'Pick at least one scope'),
    ),
  allowedCidrs: z
    .array(z.string())
    .max(50, 'At most 50 addresses or ranges')
    .optional()
    .transform((list) => [...new Set((list ?? []).map((c) => c.trim()).filter(Boolean))])
    .superRefine((list, ctx) => {
      const bad = list.filter((c) => !parseCidr(c))
      if (bad.length) ctx.addIssue({ code: 'custom', message: `Not an address or CIDR: ${bad.join(', ')}` })
    }),
  webhookUrl: z
    .string()
    .trim()
    .max(2000, 'Webhook URL is too long')
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null
      let parsed: URL
      try {
        parsed = new URL(value)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Webhook URL is not a valid URL' })
        return z.NEVER
      }
      if (parsed.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', message: 'Webhook URL must use https' })
        return z.NEVER
      }
      if (parsed.username || parsed.password) {
        ctx.addIssue({ code: 'custom', message: 'Webhook URL must not carry a username or password' })
        return z.NEVER
      }
      return parsed.toString()
    }),
  withWebhookSecret: z.boolean().optional(),
  rateLimitPerMin: z
    .number({ error: 'Rate limit must be a number' })
    .int('Rate limit must be a whole number')
    .min(1, 'Rate limit must be at least 1 a minute')
    .max(RATE_LIMIT_MAX, `Rate limit must be at most ${RATE_LIMIT_MAX} a minute`)
    .optional(),
  expiresAt: z
    .string()
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Expiry is not a date' })
        return z.NEVER
      }
      return date
    }),
})

const idSchema = z.string({ error: 'Portal client not found' }).trim().min(1, 'Portal client not found').max(64)

/** The first problem, as a sentence for the console. */
function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'That input is not valid')
  return result.data
}

async function findClientOrThrow(id: string) {
  const existing = await prisma.portalClient.findUnique({
    where: { id: parseOrThrow(idSchema, id) },
    select: { id: true, tokenPrefix: true, isActive: true },
  })
  if (!existing) throw new Error('That portal client no longer exists — refresh the page.')
  return existing
}

/** Why no webhook secret can be made, or null when the key is usable. */
function noKeyReason(): string | null {
  const { problem } = readPortalSecretKey()
  if (!problem) return null
  return `No webhook secret was made: ${problem} A secret is never stored unencrypted. The token works; fix the key and rotate the secret to make one.`
}

export async function createPortalClient(input: CreatePortalClientInput): Promise<CreatePortalClientResult> {
  const userId = await admin()
  const { name, scopes, allowedCidrs, webhookUrl, withWebhookSecret, expiresAt, ...rest } = parseOrThrow(
    createSchema,
    input,
  )
  // The client's own limit is its read limit (writes 60, quotes 30 — auth-core PORTAL_RATE_LIMITS).
  const rateLimitPerMin = rest.rateLimitPerMin ?? 300

  let webhookSecret: string | null = null
  let webhookSecretSkipped: string | null = null
  if (withWebhookSecret) {
    webhookSecretSkipped = noKeyReason()
    if (!webhookSecretSkipped) webhookSecret = generateWebhookSecret()
  }

  const { token, tokenHash, tokenPrefix } = generatePortalToken()
  // The secret is bound to the row's id, so the row is made first and the
  // secret added in the same transaction.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.portalClient.create({
      data: {
        name,
        tokenHash,
        tokenPrefix,
        scopes,
        allowedCidrs,
        webhookUrl,
        rateLimitPerMin,
        expiresAt,
        createdById: userId,
      },
      select: { id: true },
    })
    if (webhookSecret) {
      await tx.portalClient.update({
        where: { id: row.id },
        data: { webhookSecretEnc: encryptPortalSecret(webhookSecret, row.id) },
      })
    }
    return row
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
      hasWebhookSecret: !!webhookSecret,
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
  const existing = await findClientOrThrow(id)
  id = existing.id

  const { token, tokenHash, tokenPrefix } = generatePortalToken()
  const { count } = await prisma.portalClient.updateMany({ where: { id }, data: { tokenHash, tokenPrefix } })
  if (!count) throw new Error('That portal client no longer exists — refresh the page.')

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
  const problem = noKeyReason()
  if (problem) throw new Error(problem)
  id = (await findClientOrThrow(id)).id

  const webhookSecret = generateWebhookSecret()
  const { count } = await prisma.portalClient.updateMany({
    where: { id },
    data: { webhookSecretEnc: encryptPortalSecret(webhookSecret, id) },
  })
  if (!count) throw new Error('That portal client no longer exists — refresh the page.')

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
  id = (await findClientOrThrow(id)).id
  const { count } = await prisma.portalClient.updateMany({ where: { id }, data: { isActive: false } })
  if (!count) throw new Error('That portal client no longer exists — refresh the page.')
  await logAudit({
    action: 'UPDATE',
    entityType: 'Portal',
    entityId: id,
    newValues: { kind: 'portal_client', event: 'revoked', isActive: false },
    userId,
  })
  revalidatePath(PATH)
}

/**
 * Removes a revoked portal client for good, with its request-log rows (they
 * carry no foreign key, so they would otherwise point at nothing). Super admin
 * only, like deleting an API key. Refused while the client is live — revoke
 * first — and while it has accounts: those are linked to real clients, so the
 * row stays revoked instead. The audit entry keeps its name and prefix.
 */
export async function deletePortalClient(id: string): Promise<void> {
  const result = await requireAdmin()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Admin access required')
  if (result.role !== 'SUPER_ADMIN') throw new Error('Only a super admin can delete a portal client.')
  const userId = result.userId

  const existing = await prisma.portalClient.findUnique({
    where: { id: parseOrThrow(idSchema, id) },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, isActive: true, _count: { select: { accounts: true } } },
  })
  if (!existing) throw new Error('That portal client no longer exists — refresh the page.')
  if (existing.isActive) throw new Error('Revoke the portal client before deleting it.')
  if (existing._count.accounts) {
    throw new Error(
      `It has ${existing._count.accounts} portal account${existing._count.accounts === 1 ? '' : 's'} linked to clients, so it stays revoked rather than deleted.`,
    )
  }

  await prisma.$transaction([
    prisma.portalRequestLog.deleteMany({ where: { portalClientId: existing.id } }),
    prisma.portalClient.delete({ where: { id: existing.id } }),
  ])
  await logAudit({
    action: 'DELETE',
    entityType: 'Portal',
    entityId: existing.id,
    oldValues: { kind: 'portal_client', name: existing.name, tokenPrefix: existing.tokenPrefix, scopes: existing.scopes },
    userId,
  })
  revalidatePath(PATH)
}
