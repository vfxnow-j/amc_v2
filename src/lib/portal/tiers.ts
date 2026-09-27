/**
 * Portal credit tiers — what an account may be quoted, and at what adjustment.
 *
 * The owner's answer (2026-09-26): ONE tier for now. Everyone gets list price and
 * every solution the portal can price (not RTO yet — see QUOTABLE_SOLUTIONS).
 * The `portal_credit_tiers` Setting keeps the shape so tiers can be added later
 * without an API change; a stored row is merged over the coded default (as
 * mergeFlowDefaults does for Flow), never replaces it.
 *
 * Verification (decision 3, default): `none` may browse and quote; `id_verified`
 * may hold; `agreement_and_coi` may order and take Flow. So a Flow line quoted to a
 * less-verified account is priced but not `allowed` (reason verification_required).
 *
 * Pure except loadCreditTiers, which reads one Setting row. Not a 'use server' module.
 */
import type { PrismaClient } from '@/generated/prisma/client'
import { FLOW_TERMS } from '@/lib/flow/terms'

export const PORTAL_CREDIT_TIERS_KEY = 'portal_credit_tiers'

export const PORTAL_SOLUTIONS = ['rental', 'rto', 'flow', 'sale'] as const
export type PortalSolution = (typeof PORTAL_SOLUTIONS)[number]

/**
 * The solutions the portal may actually price. RTO is NOT one of them.
 *
 * The app's rent-to-own payment is the ORDER TOTAL ÷ rtoTermMonths, with the buyout
 * equal to that total (reservations.ts maybeRecalcRto / createReservation; the
 * builder shows total ÷ term). The portal has no order total to divide — what the
 * RTO "total" should be for a portal offer (a sale price? the rental over the
 * term?) is the owner's call, and AMC is the only price authority, so the portal
 * does not invent one. Until then an RTO line is refused as solution_not_allowed,
 * RTO never appears in an offer's solutions or its public bands, and a stored tier
 * or offer that lists it is ignored.
 *
 * TODO(owner decision: portal RTO basis) — once the owner defines what an RTO
 * quote is priced from, price it with the same total ÷ term the order uses and add
 * 'rto' back here.
 */
// Sale added 2026-09-26 (owner): a one-time price from the product's sale price.
export const QUOTABLE_SOLUTIONS: readonly PortalSolution[] = ['rental', 'flow', 'sale']

/** The contract offers Flow 12–48 months: the app's FLOW_TERMS without 60. */
export const PORTAL_FLOW_TERMS: readonly number[] = FLOW_TERMS.filter((t) => t <= 48)
/** Rent-to-own terms, matching the order builder's RTO_TERMS. Not quotable yet (QUOTABLE_SOLUTIONS). */
export const PORTAL_RTO_TERMS: readonly number[] = [3, 6, 12, 24, 36]

/** Solutions that take a term in months. Rental is priced over its window instead. */
export type TermedSolution = 'rto' | 'flow'
export const ALL_TERMS: Record<TermedSolution, readonly number[]> = {
  rto: PORTAL_RTO_TERMS,
  flow: PORTAL_FLOW_TERMS,
}

export const VERIFICATION_LEVELS = ['none', 'id_verified', 'agreement_and_coi'] as const
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number]

export type CreditTier = {
  id: string
  label: string
  solutions: PortalSolution[]
  terms: Record<TermedSolution, number[]>
  /** Applied to rental rates. 0 = list price. */
  priceAdjustPct: number
  /** Overrides the house Flow margin for this tier. Null = the house default. */
  flowMarginPct: number | null
  /** Null = no limit. */
  maxOrderTotal: number | null
  /** The least verification each solution needs before a quote line is `allowed`. */
  requiresVerification: Record<PortalSolution, VerificationLevel>
}

export type CreditTiers = { defaultTier: string; tiers: Record<string, CreditTier> }

export const STANDARD_TIER: CreditTier = {
  id: 'standard',
  label: 'Standard',
  solutions: [...QUOTABLE_SOLUTIONS],
  terms: { rto: [...PORTAL_RTO_TERMS], flow: [...PORTAL_FLOW_TERMS] },
  priceAdjustPct: 0,
  flowMarginPct: null,
  maxOrderTotal: null,
  requiresVerification: { rental: 'none', rto: 'none', flow: 'agreement_and_coi', sale: 'none' },
}

export const CREDIT_TIERS_DEFAULT: CreditTiers = {
  defaultTier: 'standard',
  tiers: { standard: STANDARD_TIER },
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function mergeTier(id: string, raw: unknown, base: CreditTier): CreditTier {
  if (!isObj(raw)) return { ...base, id }
  const solutions = Array.isArray(raw.solutions)
    ? QUOTABLE_SOLUTIONS.filter((s) => (raw.solutions as unknown[]).includes(s))
    : base.solutions
  const terms = { ...base.terms }
  if (isObj(raw.terms)) {
    for (const s of ['rto', 'flow'] as const) {
      const list = raw.terms[s]
      // A stored term outside the contract's set is dropped, never trusted.
      if (Array.isArray(list)) terms[s] = ALL_TERMS[s].filter((t) => list.includes(t))
    }
  }
  const adj = finite(raw.priceAdjustPct)
  const margin = finite(raw.flowMarginPct)
  const max = finite(raw.maxOrderTotal)
  const requiresVerification = { ...base.requiresVerification }
  if (isObj(raw.requiresVerification)) {
    for (const s of PORTAL_SOLUTIONS) {
      const v = raw.requiresVerification[s]
      if ((VERIFICATION_LEVELS as readonly unknown[]).includes(v)) requiresVerification[s] = v as VerificationLevel
    }
  }
  return {
    id,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : base.label,
    solutions,
    terms,
    // Bounded so a typo in the Setting cannot give gear away or quote 10x.
    priceAdjustPct: adj != null && adj >= -50 && adj <= 100 ? adj : base.priceAdjustPct,
    // An explicit null clears the field; anything else unusable keeps the base.
    flowMarginPct: raw.flowMarginPct === null ? null : margin != null && margin >= 0 && margin <= 200 ? margin : base.flowMarginPct,
    maxOrderTotal: raw.maxOrderTotal === null ? null : max != null && max > 0 ? max : base.maxOrderTotal,
    requiresVerification,
  }
}

/** A Setting row's value merged over the coded default — the default tier always exists. */
export function mergeCreditTiers(value: unknown): CreditTiers {
  const tiers: Record<string, CreditTier> = { standard: { ...STANDARD_TIER } }
  let defaultTier = CREDIT_TIERS_DEFAULT.defaultTier
  if (isObj(value)) {
    if (isObj(value.tiers)) {
      for (const [id, raw] of Object.entries(value.tiers)) {
        if (!/^[a-z0-9_-]{1,40}$/.test(id)) continue
        tiers[id] = mergeTier(id, raw, tiers[id] ?? STANDARD_TIER)
      }
    }
    if (typeof value.defaultTier === 'string' && tiers[value.defaultTier]) defaultTier = value.defaultTier
  }
  return { defaultTier, tiers }
}

/** The account's tier, or the default tier for an unknown name. */
export function tierFor(tiers: CreditTiers, id: string | null | undefined): CreditTier {
  return (id && tiers.tiers[id]) || tiers.tiers[tiers.defaultTier] || STANDARD_TIER
}

export function isVerificationLevel(v: unknown): v is VerificationLevel {
  return (VERIFICATION_LEVELS as readonly unknown[]).includes(v)
}

/** True when `have` is at least `need`. An unknown level counts as `none`. */
export function verificationMeets(have: string | null | undefined, need: VerificationLevel): boolean {
  const rank = (l: unknown) => Math.max(0, VERIFICATION_LEVELS.indexOf(l as VerificationLevel))
  return rank(have) >= rank(need)
}

export async function loadCreditTiers(db: Pick<PrismaClient, 'setting'>): Promise<CreditTiers> {
  const row = await db.setting.findUnique({ where: { key: PORTAL_CREDIT_TIERS_KEY } })
  return mergeCreditTiers(row?.value)
}
