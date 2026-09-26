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
import type { FlowBasis } from '@/lib/pricing/flow-basis'
import { applyFlowDefaults, type FlowPricingDefaults } from './defaults'
import type { OrderFunding } from './funding'
import { flowKnobsProblem } from './knob-bounds'
import { loadFlowBases } from './load-bases'
import { loadFlowFunding } from './load-funding'
import { loadFlowDefaults } from './order-inputs'
import { isFlowTerm } from './terms'

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

export type FlowDraftResolvedLine = { assetId: string; quantity: number; costBasis: number | null }

/**
 * The pure half of flowDraftEconomics: given the term, the order's raw knobs, its
 * lines, the gear's already-loaded landed cost (loadFlowBases), its already-loaded
 * lease funding (loadFlowFunding) and the house pricing defaults (loadFlowDefaults),
 * price the draft. No Prisma, no clock — everything it needs is a parameter, so it
 * is testable without a database.
 *
 * A blank knob resolves to `defaults` exactly as applyFlowDefaults fills a blank
 * knob when an order is born, so the preview matches what createReservation would
 * store. Funding shapes leaseBalance and monthlyNet only — the client's price
 * (hardware, profit, marginOnContract) never reads it.
 *
 * Null when the knobs can't be resolved to a config, or a line's gear has no basis
 * in `bases` or its landed cost is incomplete (nothing costed, so it can't be
 * priced as Flow).
 */
export function computeFlowDraftEconomics(
  termMonths: number,
  knobs: FlowDraftKnobs,
  lines: FlowDraftResolvedLine[],
  bases: Record<string, FlowBasis>,
  funding: OrderFunding,
  defaults: FlowPricingDefaults,
): FlowDraftEconomics | null {
  const filled = applyFlowDefaults(
    {
      flowTermMonths: termMonths,
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

/** Null when the draft cannot be priced: no term, no lines, or gear without a full landed cost. */
export async function flowDraftEconomics(
  db: Db,
  termMonths: number,
  knobs: FlowDraftKnobs,
  draft: FlowDraftLine[],
  asOf: Date = new Date(),
): Promise<FlowDraftEconomics | null> {
  // Not merely "positive": termMonths drives O(termMonths) loops through the Flow
  // pricing engine (lib/pricing/flow.ts), so it must be one of the offered terms.
  if (!isFlowTerm(termMonths)) return null
  const term = termMonths
  const lines = (draft || [])
    .filter((l) => l && typeof l.assetId === 'string' && l.assetId)
    .slice(0, 200)
    .map((l) => ({
      assetId: l.assetId,
      // Bounded above too: a draft line's quantity is typed by hand, not looked up.
      quantity: Math.min(999, Math.max(1, Math.round(Number(l.quantity) || 1))),
      costBasis: (() => {
        const n = finite(l.costBasis)
        return n != null && n >= 0 ? n : null
      })(),
    }))
  if (!lines.length) return null

  if (
    flowKnobsProblem({
      marginPct: finite(knobs.marginPct) ?? null,
      financePct: finite(knobs.financePct) ?? null,
      purchaseTaxPct: finite(knobs.purchaseTaxPct) ?? null,
      recoverByMonth: finite(knobs.recoverByMonth) ?? null,
      deprPct: finite(knobs.deprPct) ?? null,
      lifeMonths: finite(knobs.lifeMonths) ?? null,
      stepPct: finite(knobs.stepPct) ?? null,
    })
  ) {
    return null
  }

  const defaults = await loadFlowDefaults(db)
  const bases = await loadFlowBases(db, lines.map((l) => l.assetId), asOf)
  const funding = await loadFlowFunding(
    db,
    { id: 'draft', flowTermMonths: term, flowAssumedAprPct: null, flowAssumedNoteMonths: null },
    lines.map((l, i) => ({ id: `draft-${i}`, assetId: l.assetId, quantity: l.quantity })),
    asOf,
    { aprPct: defaults.assumedAprPct, noteMonths: FLOW_LEASE_ASSUMPTION.noteMonths },
  )

  return computeFlowDraftEconomics(term, knobs, lines, bases, funding, defaults)
}
