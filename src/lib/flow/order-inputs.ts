/**
 * Everything flowOrder() needs to price one Flow order, read from the database
 * with nothing written: the config (order knobs over the house defaults, with the
 * lease funding and the gear's age), the lines, and the per-line funding.
 *
 * The repricing path and the order page both call this, so the stored numbers and
 * the numbers on screen come from the same inputs.
 *
 * Server-only (takes a Prisma client or transaction), NOT a 'use server' module.
 * Read-only: a line with no true cost yet is costed in memory from the landed-cost
 * basis, exactly as v1's repriceFlowTx snapshots it, but nothing is stored here —
 * snapshotting is the repricing path's job.
 */
import type { PrismaClient } from '@/generated/prisma/client'
import { flowConfigFromSettings, type FlowLineInput } from '@/lib/pricing/flow-lines'
import type { FlowOrderConfig } from '@/lib/pricing/flow-order'
import type { FlowBasis } from '@/lib/pricing/flow-basis'
import { FLOW_LEASE_ASSUMPTION } from '@/lib/pricing/lease-funding'
import { applyFlowDefaults, mergeFlowDefaults, FLOW_DEFAULTS_KEY, type FlowPricingDefaults } from './defaults'
import { loadFlowBases } from './load-bases'
import { loadFlowFunding, type OrderFunding } from './load-funding'

type Db = Pick<PrismaClient, 'reservation' | 'package' | 'reservationItem' | 'setting' | 'lease' | 'assetUnit' | 'reservationItemUnit'>

export type FlowInputLine = FlowLineInput & {
  itemId: string
  assetId: string | null
  parentId: string | null
  quantity: number
}

export type FlowOrderInputs = {
  /** Null when the order has no term: nothing can be priced without one. */
  config: FlowOrderConfig | null
  lines: FlowInputLine[]
  funding: OrderFunding
  /** Landed-cost basis per asset on the order, for snapshotting and the form. */
  bases: Record<string, FlowBasis>
  defaults: FlowPricingDefaults
}

/** The house Flow defaults: the settings row merged over the engine's. */
export async function loadFlowDefaults(db: Pick<PrismaClient, 'setting'>): Promise<FlowPricingDefaults> {
  const row = await db.setting.findUnique({ where: { key: FLOW_DEFAULTS_KEY } })
  return mergeFlowDefaults(row?.value)
}

/** Null when the order does not exist or is not a Flow order. */
export async function flowInputsForOrder(db: Db, orderId: string, asOf: Date = new Date()): Promise<FlowOrderInputs | null> {
  const order = await db.reservation.findUnique({ where: { id: orderId } })
  if (!order || order.reservationType !== 'FLOW') return null

  const activePackage = await db.package.findFirst({ where: { reservationId: orderId, isActive: true } })
  const items = await db.reservationItem.findMany({
    where: { reservationId: orderId, ...(activePackage ? { packageId: activePackage.id } : {}) },
    include: { asset: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  const defaults = await loadFlowDefaults(db)
  const bases = await loadFlowBases(db, items.map((i) => i.assetId).filter((a): a is string => !!a), asOf)

  const lines: FlowInputLine[] = items.map((i) => {
    const b = i.assetId ? bases[i.assetId] : undefined
    const usable = b && b.basis > 0 && !b.incomplete ? b.basis : null
    // As v1's repriceFlowTx: true cost is the snapshot, else the landed-cost basis;
    // the pricing basis may be raised but never sits below true cost.
    const trueCost = i.trueCost != null ? Number(i.trueCost) : usable
    const stored = i.costBasis != null ? Number(i.costBasis) : null
    const costBasis = stored == null || (trueCost != null && stored < trueCost) ? trueCost : stored
    return {
      itemId: i.id,
      assetId: i.assetId,
      parentId: i.parentId,
      name: i.description || i.asset?.name || 'Item',
      costBasis,
      trueCost,
      quantity: i.quantity,
      addedAtMonth: i.flowAddedAtMonth,
    }
  })

  const funding = await loadFlowFunding(
    db,
    order,
    items.map((i) => ({ id: i.id, assetId: i.assetId, quantity: i.quantity })),
    asOf,
    { aprPct: defaults.assumedAprPct, noteMonths: FLOW_LEASE_ASSUMPTION.noteMonths },
  )

  // The gear's age, averaged over the line units (v1 computed it and never passed it on).
  let ageWeighted = 0
  let ageUnits = 0
  for (const l of lines) {
    const b = l.assetId ? bases[l.assetId] : undefined
    if (!b || !b.consideredUnits) continue
    ageWeighted += b.monthsInService * l.quantity
    ageUnits += l.quantity
  }
  const monthsInService = ageUnits ? Math.round(ageWeighted / ageUnits) : 0

  const base = flowConfigFromSettings(applyFlowDefaults(order, defaults))
  const config = base ? { ...base, monthsInService, funding: funding.loans.length ? funding.loans : null } : null

  return { config, lines, funding, bases, defaults }
}
