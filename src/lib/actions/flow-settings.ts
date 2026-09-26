'use server'

/**
 * The house Flow pricing defaults, and the landed-cost basis the order form prices
 * a Flow line from. Ported from v1 (src/lib/actions/flow-settings.ts).
 *
 * A 'use server' module exports async functions only (v1 eb12bb2 took production
 * down by exporting a constant from one). Types are erased, so they are fine; the
 * fallback and key live in lib/flow/defaults.ts.
 */
import { prisma } from '@/lib/prisma'
import { requireAuth, requireAdmin, requireEditor } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { FLOW_DEFAULTS_KEY, mergeFlowDefaults, type FlowPricingDefaults } from '@/lib/flow/defaults'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * The starting position every Flow order inherits and may override. Deliberately
 * excludes the term, gear age, funding and current month: those belong to an order.
 */
export async function getFlowDefaults(): Promise<FlowPricingDefaults> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  return loadFlowDefaults(prisma)
}

export async function setFlowDefaults(next: FlowPricingDefaults): Promise<void> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  // Merged over the fallback like v1, then reduced to the known keys, so a stray
  // field from the caller is never stored and a missing one keeps its default.
  const merged = mergeFlowDefaults(next)
  const value: FlowPricingDefaults = {
    marginPct: Number(merged.marginPct),
    financePct: Number(merged.financePct),
    purchaseTaxPct: Number(merged.purchaseTaxPct),
    taxExempt: Boolean(merged.taxExempt),
    recoverByMonth: Number(merged.recoverByMonth),
    deprPct: Number(merged.deprPct),
    lifeMonths: Number(merged.lifeMonths),
    assumedAprPct: Number(merged.assumedAprPct),
  }
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${key} must be a number.`)
  }

  const before = await prisma.setting.findUnique({ where: { key: FLOW_DEFAULTS_KEY } })
  await prisma.setting.upsert({
    where: { key: FLOW_DEFAULTS_KEY },
    create: { key: FLOW_DEFAULTS_KEY, value },
    update: { value },
  })
  try {
    await logAudit({
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: FLOW_DEFAULTS_KEY,
      oldValues: (before?.value as Record<string, unknown> | undefined) ?? undefined,
      newValues: value,
      userId: authResult.userId,
    })
  } catch {
    // Audit is best-effort, as elsewhere.
  }
}

/** What the order form needs to price a Flow line off an asset. */
export type FlowAssetBasis = {
  /** Per-unit landed cost, averaged over live costed units. 0 when nothing is costed. */
  basis: number
  /** True when any live unit lacks a cost — the form refuses the line. */
  incomplete: boolean
  costedUnits: number
  consideredUnits: number
}

/**
 * Landed-cost basis for each asset, resolved server-side through resolveFlowBasis()
 * so the form prices a Flow line off exactly what the server will store.
 */
export async function getFlowBasesForAssets(assetIds: string[]): Promise<Record<string, FlowAssetBasis>> {
  // Unit costs are only needed to build an order, so require the same role as editing one.
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  if (!Array.isArray(assetIds)) return {}

  const { loadFlowBases } = await import('@/lib/flow/load-bases')
  const bases = await loadFlowBases(prisma, assetIds.filter((id) => typeof id === 'string').slice(0, 200))
  const out: Record<string, FlowAssetBasis> = {}
  for (const [id, b] of Object.entries(bases)) {
    out[id] = {
      basis: b.basis,
      incomplete: b.incomplete,
      costedUnits: b.costedUnits,
      consideredUnits: b.consideredUnits,
    }
  }
  return out
}
