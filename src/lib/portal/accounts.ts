/**
 * Portal accounts (docs/portal-api.md §3, docs/portal-api-plan.md §2 "PUT
 * /accounts", "Tenant isolation", owner answer 5).
 *
 * `PUT /v1/accounts/{portal_account_id}` is a per-portal-client upsert keyed
 * on `(portalClientId, portalAccountId)`:
 *   - first time → a new AMC `Client` is created for it, plus the
 *     `portal_accounts` row and its sites;
 *   - later → the `portal_accounts` fields and sites are updated, and the
 *     linked `Client`'s company/contact fields are mirrored over **only**
 *     while the account is still linked to the client it created. Staff can
 *     re-link an account to a pre-existing client from the client record
 *     (`relinkPortalAccount`); once that happens the portal's company/contact
 *     fields are validated but dropped (portal_accounts has no column for them) —
 *     staff own that client's identity from then on. `PUT` itself never
 *     merges or re-links (owner, 2026-09-26).
 *
 * "Still linked to the client it created" is `clientId === createdClientId`
 * (`isMirroring`): `portal_accounts.createdClientId` is set once, when PUT
 * creates the client, and never changed — a re-link moves `clientId` only,
 * so mirroring stops (and resumes only if staff re-link it back).
 *
 * Sites are a replace-set keyed by `external_site_id`: every PUT with a
 * `sites` array upserts what's present and deletes what's absent, with
 * exactly one `is_default`, stored in `portal_account_sites."isDefault"`. A
 * partial unique index allows at most one default per account, so a PUT that
 * moves the default clears the old one before setting the new one (same
 * transaction). See prisma/manual/2026-09-26-portal-accounts-columns.sql.
 *
 * Like quote.ts and offers.ts, this module never imports the live `prisma`
 * singleton itself — every DB-touching export takes it (or a transaction
 * client) as a parameter. That keeps the pure functions below (body
 * validation, the sites replace-set plan, the response mapper, the re-link
 * rule) testable with `node:test` alone, no DATABASE_URL required; the
 * routes and server actions that call these pass `prisma` in.
 */
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { badRequest } from './errors'
import { assertClientSafe } from './dto'
import { loadCreditTiers, VERIFICATION_LEVELS, type VerificationLevel } from './tiers'

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().min(1).max(max)

const SiteInputSchema = z.object({
  external_site_id: trimmed(120),
  label: trimmed(200),
  address: trimmed(500).nullish().transform((v) => v ?? null),
  is_default: z.boolean(),
})

export type SiteInput = z.infer<typeof SiteInputSchema>

/**
 * Pure: null when `sites` has exactly one default (or is empty), else the
 * validation message. Exported so the rule is directly unit-testable without
 * going through zod.
 */
export function sitesDefaultError(sites: { is_default: boolean }[]): string | null {
  if (sites.length === 0) return null
  const defaults = sites.filter((s) => s.is_default).length
  if (defaults === 0) return 'Exactly one site must have is_default: true'
  if (defaults > 1) return 'Only one site may have is_default: true'
  return null
}

const SitesInputSchema = z
  .array(SiteInputSchema)
  .max(50)
  .superRefine((sites, ctx) => {
    const error = sitesDefaultError(sites)
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
    const seen = new Set<string>()
    sites.forEach((site, index) => {
      if (seen.has(site.external_site_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate external_site_id: ${site.external_site_id}`,
          path: [index, 'external_site_id'],
        })
      }
      seen.add(site.external_site_id)
    })
  })

export const AccountPutBodySchema = z.object({
  company: trimmed(200),
  contact_name: trimmed(200).nullish().transform((v) => v ?? undefined),
  contact_email: z.string().trim().max(200).pipe(z.email()).nullish().transform((v) => v ?? undefined),
  contact_phone: trimmed(50).nullish().transform((v) => v ?? undefined),
  verification_level: z.enum(VERIFICATION_LEVELS).optional(),
  credit_tier: trimmed(40).optional(),
  sites: SitesInputSchema.optional(),
})

export type AccountPutBody = z.infer<typeof AccountPutBodySchema>

// ---------------------------------------------------------------------------
// Sites replace-set (pure)
// ---------------------------------------------------------------------------

/** Which of the account's current sites should be deleted for this PUT. */
export function planSiteReplacement(
  existingExternalIds: string[],
  incoming: { external_site_id: string }[],
): { toDelete: string[] } {
  const keep = new Set(incoming.map((s) => s.external_site_id))
  return { toDelete: existingExternalIds.filter((id) => !keep.has(id)) }
}

/**
 * Pure: the external_site_id to be the default, or null for an empty set.
 * Validation guarantees exactly one when `sites` is non-empty.
 */
export function defaultSiteId(sites: { external_site_id: string; is_default: boolean }[]): string | null {
  return sites.find((s) => s.is_default)?.external_site_id ?? null
}

// ---------------------------------------------------------------------------
// Mirroring rule (see file header)
// ---------------------------------------------------------------------------

/** Pure: PUT mirrors company/contact onto the linked client only while it is the one the portal created. */
export function isMirroring(account: { clientId: string; createdClientId: string | null }): boolean {
  return account.createdClientId !== null && account.clientId === account.createdClientId
}

// ---------------------------------------------------------------------------
// Response DTO
// ---------------------------------------------------------------------------

type AccountRow = { verificationLevel: string; creditTier: string }
type SiteRow = { externalSiteId: string; name: string; address: string | null; isDefault: boolean }

export type AccountResponseDto = {
  portal_account_id: string
  verification_level: string
  credit_tier: string
  sites: { external_site_id: string; label: string; address: string | null; is_default: boolean }[]
  client_linked: boolean
}

/** Explicit mapper (docs/portal-api-plan.md §1) — never a spread of a row. */
export function mapAccountResponse(
  portalAccountId: string,
  account: AccountRow,
  sites: SiteRow[],
  clientLinked: boolean,
): AccountResponseDto {
  const dto: AccountResponseDto = {
    portal_account_id: portalAccountId,
    verification_level: account.verificationLevel,
    credit_tier: account.creditTier,
    sites: [...sites]
      .sort((a, b) => a.externalSiteId.localeCompare(b.externalSiteId))
      .map((s) => ({
        external_site_id: s.externalSiteId,
        label: s.name,
        address: s.address,
        is_default: s.isDefault,
      })),
    client_linked: clientLinked,
  }
  assertClientSafe(dto)
  return dto
}

// ---------------------------------------------------------------------------
// PUT /v1/accounts/{portal_account_id}
// ---------------------------------------------------------------------------

const ACCOUNT_SELECT = {
  id: true,
  clientId: true,
  createdClientId: true,
  verificationLevel: true,
  creditTier: true,
} as const
type AccountForWrite = {
  id: string
  clientId: string
  createdClientId: string | null
  verificationLevel: string
  creditTier: string
}

async function replaceSites(tx: Prisma.TransactionClient, accountId: string, sites: SiteInput[]): Promise<void> {
  const existing = await tx.portalAccountSite.findMany({ where: { accountId }, select: { externalSiteId: true } })
  const { toDelete } = planSiteReplacement(
    existing.map((s) => s.externalSiteId),
    sites,
  )
  if (toDelete.length) {
    await tx.portalAccountSite.deleteMany({ where: { accountId, externalSiteId: { in: toDelete } } })
  }
  // The partial unique index ("portal_account_sites_one_default") is checked
  // per statement, so any other default must be cleared before the upserts
  // below set the new one.
  const newDefault = defaultSiteId(sites)
  await tx.portalAccountSite.updateMany({
    where: { accountId, isDefault: true, ...(newDefault ? { externalSiteId: { not: newDefault } } : {}) },
    data: { isDefault: false },
  })
  for (const site of sites) {
    const data = {
      name: site.label,
      address: site.address,
      isDefault: site.is_default,
    }
    await tx.portalAccountSite.upsert({
      where: { accountId_externalSiteId: { accountId, externalSiteId: site.external_site_id } },
      create: { accountId, externalSiteId: site.external_site_id, ...data },
      update: data,
    })
  }
}

/**
 * The whole PUT, in one transaction. Returns the internal PortalAccount id
 * (for the request log's `setAccountId`) alongside the response body.
 */
export async function putPortalAccount(
  db: PrismaClient,
  portalClientId: string,
  portalAccountId: string,
  rawBody: unknown,
): Promise<{ id: string; dto: AccountResponseDto }> {
  if (!portalAccountId?.trim()) throw badRequest('Missing portal_account_id')
  const body = AccountPutBodySchema.parse(rawBody)

  if (body.credit_tier !== undefined) {
    const tiers = await loadCreditTiers(db)
    if (!tiers.tiers[body.credit_tier]) throw badRequest(`Unknown credit_tier: ${body.credit_tier}`)
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.portalAccount.findUnique({
      where: { portalClientId_portalAccountId: { portalClientId, portalAccountId } },
      select: ACCOUNT_SELECT,
    })

    let account: AccountForWrite

    if (!existing) {
      const client = await tx.client.create({
        data: {
          name: body.company,
          companyName: body.company,
          email: body.contact_email ?? null,
          phone: body.contact_phone ?? null,
        },
        select: { id: true },
      })
      account = await tx.portalAccount.create({
        data: {
          portalClientId,
          portalAccountId,
          clientId: client.id,
          createdClientId: client.id,
          verificationLevel: body.verification_level ?? 'none',
          creditTier: body.credit_tier ?? 'standard',
        },
        select: ACCOUNT_SELECT,
      })
    } else {
      const accountData: Prisma.PortalAccountUpdateInput = {}
      if (body.verification_level !== undefined) accountData.verificationLevel = body.verification_level
      if (body.credit_tier !== undefined) accountData.creditTier = body.credit_tier
      account = Object.keys(accountData).length
        ? await tx.portalAccount.update({ where: { id: existing.id }, data: accountData, select: ACCOUNT_SELECT })
        : existing

      if (isMirroring(existing)) {
        const clientData: Prisma.ClientUpdateInput = { name: body.company, companyName: body.company }
        if (body.contact_email !== undefined) clientData.email = body.contact_email
        if (body.contact_phone !== undefined) clientData.phone = body.contact_phone
        await tx.client.update({ where: { id: existing.clientId }, data: clientData })
      }
      // Not mirroring: staff re-linked this account to a pre-existing
      // client. Its portal_accounts fields above still update; its client's
      // company/contact fields are staff's to own from here, so we leave
      // them alone.
    }

    if (body.sites !== undefined) await replaceSites(tx, account.id, body.sites)

    const sites = await tx.portalAccountSite.findMany({
      where: { accountId: account.id },
      select: { externalSiteId: true, name: true, address: true, isDefault: true },
    })

    return { id: account.id, dto: mapAccountResponse(portalAccountId, account, sites, isMirroring(account)) }
  })
}

// ---------------------------------------------------------------------------
// Staff panel (client record) + re-link
// ---------------------------------------------------------------------------

export type PortalAccountPanel =
  | { kind: 'none' }
  /** No live link, but the portal created this client and its account was re-linked elsewhere. */
  | { kind: 'origin_only' }
  | {
      kind: 'linked'
      id: string
      portalClientId: string
      portalClientName: string
      portalAccountId: string
      verificationLevel: VerificationLevel | string
      creditTier: string
      createdAt: Date
      updatedAt: Date
      sites: { externalSiteId: string; label: string; address: string | null; isDefault: boolean }[]
      /** Whether this is still the client the account created (see file header). */
      createdHere: boolean
    }

/** Everything the client-record "Portal account" panel needs, in one query. */
export async function getPortalAccountPanel(
  db: Pick<PrismaClient, 'client' | 'portalAccount'>,
  clientId: string,
): Promise<PortalAccountPanel> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      portalAccount: {
        select: {
          id: true,
          clientId: true,
          createdClientId: true,
          portalClientId: true,
          portalAccountId: true,
          verificationLevel: true,
          creditTier: true,
          createdAt: true,
          updatedAt: true,
          portalClient: { select: { name: true } },
          sites: {
            select: { externalSiteId: true, name: true, address: true, isDefault: true },
            orderBy: { externalSiteId: 'asc' },
          },
        },
      },
    },
  })
  if (!client) return { kind: 'none' }

  if (!client.portalAccount) {
    const created = await db.portalAccount.findFirst({ where: { createdClientId: clientId }, select: { id: true } })
    return created ? { kind: 'origin_only' } : { kind: 'none' }
  }

  const a = client.portalAccount
  return {
    kind: 'linked',
    id: a.id,
    portalClientId: a.portalClientId,
    portalClientName: a.portalClient.name,
    portalAccountId: a.portalAccountId,
    verificationLevel: a.verificationLevel,
    creditTier: a.creditTier,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    sites: a.sites.map((s) => ({
      externalSiteId: s.externalSiteId,
      label: s.name,
      address: s.address,
      isDefault: s.isDefault,
    })),
    createdHere: isMirroring(a),
  }
}

/**
 * Pure: the re-link refusal rule. `PortalAccount.clientId` is unique, so a
 * client that already has one can never take a second — this just turns
 * that into a clear message before the write is attempted, naming whether
 * it's the same portal client or a different one.
 */
export function assertRelinkAllowed(
  target: { portalAccount: { portalClientId: string } | null },
  movingPortalClientId: string,
): void {
  if (!target.portalAccount) return
  throw new Error(
    target.portalAccount.portalClientId === movingPortalClientId
      ? 'That client already has a portal account for this portal client.'
      : 'That client already has a portal account (a different portal client).',
  )
}

/** Moves an existing portal account onto a different, existing AMC client. */
export async function relinkPortalAccount(
  db: PrismaClient,
  accountId: string,
  targetClientId: string,
): Promise<{ fromClientId: string }> {
  return db.$transaction(async (tx) => {
    const account = await tx.portalAccount.findUnique({
      where: { id: accountId },
      select: { id: true, clientId: true, portalClientId: true },
    })
    if (!account) throw new Error('Portal account not found')
    const target = await tx.client.findUnique({
      where: { id: targetClientId },
      select: { id: true, portalAccount: { select: { portalClientId: true } } },
    })
    if (!target) throw new Error('Client not found')
    if (target.id === account.clientId) return { fromClientId: account.clientId }

    assertRelinkAllowed(target, account.portalClientId)
    // clientId only: createdClientId stays, so PUT stops mirroring onto the new client (isMirroring).
    await tx.portalAccount.update({ where: { id: account.id }, data: { clientId: target.id } })
    return { fromClientId: account.clientId }
  })
}
