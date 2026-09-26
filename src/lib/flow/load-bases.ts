/**
 * Read the unit cost fields resolveFlowBasis() needs, for a set of assets.
 *
 * Server-only (takes a Prisma client or transaction), but deliberately NOT a
 * 'use server' module: it takes a db handle, so it must never be exposed as an
 * action. The action wrapper lives in src/lib/actions/flow-settings.ts.
 */
import type { PrismaClient } from '@/generated/prisma/client'
import { resolveFlowBasis, type FlowBasis, type FlowBasisUnit } from '@/lib/pricing/flow-basis'

type Db = Pick<PrismaClient, 'assetUnit'>

export async function loadFlowBases(
  db: Db,
  assetIds: string[],
  asOf: Date = new Date(),
): Promise<Record<string, FlowBasis>> {
  const ids = [...new Set(assetIds.filter(Boolean))]
  if (!ids.length) return {}
  const units = await db.assetUnit.findMany({
    where: { assetId: { in: ids } },
    select: {
      assetId: true,
      purchasePrice: true,
      landedCostAdjustment: true,
      receivedDate: true,
      purchaseDate: true,
      soldAt: true,
      retiredAt: true,
    },
  })
  const byAsset = new Map<string, FlowBasisUnit[]>()
  for (const u of units) {
    const list = byAsset.get(u.assetId) || []
    list.push({
      purchasePrice: u.purchasePrice == null ? null : Number(u.purchasePrice),
      landedCostAdjustment: u.landedCostAdjustment == null ? null : Number(u.landedCostAdjustment),
      receivedDate: u.receivedDate,
      purchaseDate: u.purchaseDate,
      soldAt: u.soldAt,
      retiredAt: u.retiredAt,
    })
    byAsset.set(u.assetId, list)
  }
  const out: Record<string, FlowBasis> = {}
  for (const id of ids) out[id] = resolveFlowBasis(byAsset.get(id) || [], asOf)
  return out
}
