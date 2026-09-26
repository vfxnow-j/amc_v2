/**
 * The internal economics of a Flow order that is not saved yet — the new-order
 * builder's staff-only strip: what the gear cost us, what it still owes on its
 * leases, the month-one net cash and the profit.
 *
 * flowInputsForOrder() answers this for a saved order; a builder draft has no
 * rows, so this reads the same things from the draft's lines instead:
 * - the knobs go through applyFlowDefaults() over the house defaults, exactly as
 *   createReservation fills a blank knob when the order is born;
 * - each line's true cost is its asset's landed-cost basis (loadFlowBases), and
 *   the pricing basis is floored at it, as createReservation stores them;
 * - the lease funding comes from loadFlowFunding(), with no units assigned (a
 *   draft has none), so every line draws from its asset's held pool.
 *
 * Economics only. The client's price never reads funding, and the builder prices
 * the lines itself with priceFlowLines — nothing here is sent to a client surface.
 *
 * Server-only (takes a Prisma client), NOT a 'use server' module.
 */
import type { PrismaClient } from '@/generated/prisma/client'
import { flowConfigFromSettings } from '@/lib/pricing/flow-lines'
import { flowOrder, type FlowOrderLine } from '@/lib/pricing/flow-order'
import { FLOW_LEASE_ASSUMPTION } from '@/lib/pricing/lease-funding'
import { applyFlowDefaults } from './defaults'
import { loadFlowBases } from './load-bases'
import { loadFlowFunding } from './load-funding'
import { loadFlowDefaults } from './order-inputs'

type Db = Pick<PrismaClient, 'setting' | 'assetUnit' | 'lease' | 'reservationItemUnit'>

export type FlowDraftLine = { assetId: string; quantity: number; costBasis?: number | null }

export type FlowDraftKnobs = {
  marginPct?: number
  financePct?: number
  purchaseTaxPct?: number
  taxExempt?: boolean
  recoverByMonth?: number
  deprPct?: number
  lifeMonths?: number
  stepPct?: number | null
}

export type FlowDraftEconomics = {
  /** What the gear cost us: true cost × quantity, summed. */
  hardware: number
  /** What the draft's gear still owes on its leases. */
  leaseBalance: number
  /** Month one's payment less the lease payments on the gear. */
  monthlyNet: number
  /** Contract, less what the gear cost us, less what the money costs over the term. */
  profit: number
  /** Profit as a % of the contract. */
  marginOnContract: number
  /** ≈ units whose lease terms are assumed rather than recorded. */
  assumedUnits: number
}

const finite = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

/** Null when the draft cannot be priced: no term, no lines, or gear without a full landed cost. */
export async function flowDraftEconomics(
  db: Db,
  termMonths: number,
  knobs: FlowDraftKnobs,
  draft: FlowDraftLine[],
  asOf: Date = new Date(),
): Promise<FlowDraftEconomics | null> {
  const term = Math.round(Number(termMonths) || 0)
  const lines = (draft || [])
    .filter((l) => l && typeof l.assetId === 'string' && l.assetId)
    .slice(0, 200)
    .map((l) => ({
      assetId: l.assetId,
      quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
      costBasis: finite(l.costBasis) ?? null,
    }))
  if (term <= 0 || !lines.length) return null

  const defaults = await loadFlowDefaults(db)
  const filled = applyFlowDefaults(
    {
      flowTermMonths: term,
      flowMarginPct: finite(knobs.marginPct) ?? null,
      flowFinancePct: finite(knobs.financePct) ?? null,
      flowPurchaseTaxPct: finite(knobs.purchaseTaxPct) ?? null,
      flowTaxExempt: typeof knobs.taxExempt === 'boolean' ? knobs.taxExempt : null,
      flowRecoverByMonth: finite(knobs.recoverByMonth) ?? null,
      flowDeprPct: finite(knobs.deprPct) ?? null,
      flowLifeMonths: finite(knobs.lifeMonths) ?? null,
      flowStepPct: finite(knobs.stepPct) ?? null,
    },
    defaults,
  )
  const config = flowConfigFromSettings(filled)
  if (!config) return null

  const bases = await loadFlowBases(db, lines.map((l) => l.assetId), asOf)
  const orderLines: FlowOrderLine[] = []
  let ageWeighted = 0
  let ageUnits = 0
  for (const l of lines) {
    const b = bases[l.assetId]
    if (!b || !(b.basis > 0) || b.incomplete) return null
    orderLines.push({
      costBasis: l.costBasis != null && l.costBasis > b.basis ? l.costBasis : b.basis,
      trueCost: b.basis,
      quantity: l.quantity,
    })
    if (b.consideredUnits) {
      ageWeighted += b.monthsInService * l.quantity
      ageUnits += l.quantity
    }
  }

  const funding = await loadFlowFunding(
    db,
    { id: 'draft', flowTermMonths: term, flowAssumedAprPct: null, flowAssumedNoteMonths: null },
    lines.map((l, i) => ({ id: `draft-${i}`, assetId: l.assetId, quantity: l.quantity })),
    asOf,
    { aprPct: defaults.assumedAprPct, noteMonths: FLOW_LEASE_ASSUMPTION.noteMonths },
  )

  const result = flowOrder(orderLines, {
    ...config,
    monthsInService: ageUnits ? Math.round(ageWeighted / ageUnits) : 0,
    funding: funding.loans.length ? funding.loans : null,
  })
  const e = result.quote.economics
  return {
    hardware: e.hardware,
    leaseBalance: Math.round(funding.lines.reduce((s, l) => s + l.balance, 0) * 100) / 100,
    monthlyNet: result.quote.cash.netByMonth[0] ?? 0,
    profit: e.profit,
    marginOnContract: e.marginOnContract,
    assumedUnits: funding.assumedCount,
  }
}
