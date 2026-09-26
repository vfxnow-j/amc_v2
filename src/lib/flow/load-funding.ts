/**
 * Load what the gear on a Flow order still owes on its leases.
 *
 * Server-only (takes a Prisma client or transaction), NOT a 'use server' module.
 * The reads are thin; the rules live in the pure modules:
 * - lease-funding.ts splits each open lease across EVERY held unit it still
 *   covers, fleet-wide, not only this order's gear — a lease's balance is spread
 *   over all the hardware it financed that we still hold;
 * - funding.ts turns that per-unit split into per-line figures and one FlowLoan
 *   per lease.
 */
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import {
  unitFunding,
  FLOW_LEASE_ASSUMPTION,
  type Assumption,
  type HeldUnit,
  type LeaseTerms,
} from '@/lib/pricing/lease-funding'
import { groupLineFunding, orderAssumption, unitCost, type OrderFunding } from './funding'

export type { LineFunding, OrderFunding } from './funding'

type Db = Pick<PrismaClient, 'lease' | 'assetUnit' | 'reservationItemUnit'>

/** A unit we still hold: not sold or retired by status, and no retirement date. */
export const HELD_UNIT_WHERE: Prisma.AssetUnitWhereInput = {
  status: { notIn: ['SOLD', 'RETIRED'] },
  retiredAt: null,
}

/** Every open lease, as lease-funding.ts reads it. `interestRate` is a fraction. */
export async function loadLeaseTerms(db: Pick<PrismaClient, 'lease'>): Promise<LeaseTerms[]> {
  const leases = await db.lease.findMany({
    where: { status: { not: 'PAID_OFF' } },
    select: { id: true, leaseNumber: true, status: true, monthlyPayment: true, interestRate: true, startDate: true, termMonths: true },
  })
  return leases.map((l) => ({
    id: l.id,
    label: l.leaseNumber,
    status: l.status,
    monthlyPayment: Number(l.monthlyPayment) || 0,
    aprPct: (Number(l.interestRate) || 0) * 100,
    startDate: l.startDate,
    termMonths: l.termMonths,
  }))
}

/** Every held unit on a lease, fleet-wide, with its landed cost. */
export async function loadLeasedHeldUnits(db: Pick<PrismaClient, 'assetUnit'>): Promise<HeldUnit[]> {
  const units = await db.assetUnit.findMany({
    where: { ...HELD_UNIT_WHERE, leaseId: { not: null } },
    select: { id: true, assetId: true, leaseId: true, purchasePrice: true, landedCostAdjustment: true },
  })
  return units.map((u) => ({ unitId: u.id, assetId: u.assetId, leaseId: u.leaseId, cost: unitCost(u) }))
}

export async function loadFlowFunding(
  db: Db,
  order: { id: string; flowTermMonths: number | null; flowAssumedAprPct: unknown; flowAssumedNoteMonths: number | null },
  items: { id: string; assetId: string | null; quantity: number }[],
  asOf: Date = new Date(),
  fallback: Assumption = FLOW_LEASE_ASSUMPTION,
): Promise<OrderFunding> {
  const assetIds = [...new Set(items.map((i) => i.assetId).filter((a): a is string => !!a))]
  if (!assetIds.length) return groupLineFunding(items.map((i) => ({ itemId: i.id, assetId: null, quantity: i.quantity, assignedUnitIds: [] })), new Map(), new Map(), order.flowTermMonths)

  const [leases, leasedHeld, assetHeld, assigned] = await Promise.all([
    loadLeaseTerms(db),
    loadLeasedHeldUnits(db),
    db.assetUnit.findMany({ where: { ...HELD_UNIT_WHERE, assetId: { in: assetIds } }, select: { id: true, assetId: true } }),
    db.reservationItemUnit.findMany({
      where: { reservationItemId: { in: items.map((i) => i.id) }, checkedInAt: null },
      select: { reservationItemId: true, assetUnitId: true },
    }),
  ])

  const assume = orderAssumption(
    { flowAssumedAprPct: order.flowAssumedAprPct as Parameters<typeof orderAssumption>[0]['flowAssumedAprPct'], flowAssumedNoteMonths: order.flowAssumedNoteMonths },
    fallback,
  )
  const funding = unitFunding(leases, leasedHeld, asOf, assume)

  const heldByAsset = new Map<string, string[]>()
  for (const u of assetHeld) heldByAsset.set(u.assetId, [...(heldByAsset.get(u.assetId) ?? []), u.id])
  const assignedByItem = new Map<string, string[]>()
  for (const a of assigned) assignedByItem.set(a.reservationItemId, [...(assignedByItem.get(a.reservationItemId) ?? []), a.assetUnitId])

  return groupLineFunding(
    items.map((i) => ({ itemId: i.id, assetId: i.assetId, quantity: i.quantity, assignedUnitIds: assignedByItem.get(i.id) ?? [] })),
    funding,
    heldByAsset,
    order.flowTermMonths,
  )
}
