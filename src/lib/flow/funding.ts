/**
 * Turn each held unit's lease funding into what a Flow order needs: per-line
 * figures for the economics panel, and one FlowLoan per lease for flowOrder().
 *
 * Which units a line's funding comes from:
 * - the units assigned to it (still out on the order), as themselves;
 * - for any quantity not yet assigned, the average over the asset's HELD units —
 *   owned-outright units count as zero, so the average is the debt a typical unit
 *   of that asset carries.
 *
 * Economics only: the client's price never reads any of this. Pure.
 */
import { interestOver, type FlowLoan } from '@/lib/pricing/flow'
import { FLOW_LEASE_ASSUMPTION, type Assumption, type UnitFunding } from '@/lib/pricing/lease-funding'

type NumLike = number | string | { toString(): string } | null | undefined

const toNum = (v: NumLike): number | null => {
  if (v == null || v === '') return null
  const n = Number(typeof v === 'object' ? v.toString() : v)
  return Number.isFinite(n) ? n : null
}
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * A unit's cost: landed cost, `purchasePrice + landedCostAdjustment` — the same
 * figure flow-basis.ts averages as true cost. A unit with no purchase price is
 * uncosted (flow-basis excludes it), so it is 0 here rather than its bare
 * adjustment.
 */
export function unitCost(u: { purchasePrice: NumLike; landedCostAdjustment: NumLike }): number {
  const price = toNum(u.purchasePrice) ?? 0
  if (price <= 0) return 0
  return price + (toNum(u.landedCostAdjustment) ?? 0)
}

/** The order's assumed note for leases with no terms; otherwise the fallback. */
export function orderAssumption(
  order: { flowAssumedAprPct: NumLike; flowAssumedNoteMonths: number | null },
  fallback: Assumption = FLOW_LEASE_ASSUMPTION,
): Assumption {
  const apr = toNum(order.flowAssumedAprPct)
  const months = order.flowAssumedNoteMonths
  return {
    aprPct: apr != null && apr >= 0 ? apr : fallback.aprPct,
    noteMonths: months != null && months > 0 ? Math.round(months) : fallback.noteMonths,
  }
}

export type FundingLineInput = {
  itemId: string
  assetId: string | null
  quantity: number
  /** Units assigned to this line and still out. */
  assignedUnitIds: string[]
}

export type LineFunding = {
  itemId: string
  units: number
  /** What this line's units still owe, summed. */
  balance: number
  /** Their monthly lease payment, summed. */
  payment: number
  /** Interest those balances pay over the order's term. */
  interestOverTerm: number
  leases: { leaseId: string; label: string; assumed: boolean }[]
}

export type OrderFunding = { loans: FlowLoan[]; lines: LineFunding[]; assumedCount: number }

type LeaseSlice = { leaseId: string; label: string; assumed: boolean; aprPct: number; monthsLeft: number; balance: number; payment: number; interest: number }

function add(into: Map<string, LeaseSlice>, f: UnitFunding, weight: number, termMonths: number) {
  const s = into.get(f.leaseId) ?? {
    leaseId: f.leaseId, label: f.leaseLabel, assumed: f.assumed, aprPct: f.aprPct, monthsLeft: f.monthsLeft,
    balance: 0, payment: 0, interest: 0,
  }
  s.balance += f.balance * weight
  s.payment += f.payment * weight
  // interestOver is linear in principal, so weighting the result is exact.
  s.interest += interestOver(f.balance, f.aprPct, f.monthsLeft, termMonths) * weight
  into.set(f.leaseId, s)
}

/**
 * @param funding     each held unit's part of its lease (lease-funding.ts unitFunding)
 * @param heldByAsset every held unit id per asset, leased or not, for the average
 * @param termMonths  the order's term, for interest over the term
 */
export function groupLineFunding(
  lines: FundingLineInput[],
  funding: Map<string, UnitFunding>,
  heldByAsset: Map<string, string[]>,
  termMonths: number | null,
): OrderFunding {
  const T = Math.max(0, Math.round(termMonths ?? 0))
  const loans = new Map<string, LeaseSlice>()
  let assumedUnits = 0
  const out: LineFunding[] = []

  for (const line of lines) {
    const qty = Math.max(0, Math.round(Number(line.quantity) || 0))
    if (!line.assetId) {
      out.push({ itemId: line.itemId, units: qty, balance: 0, payment: 0, interestOverTerm: 0, leases: [] })
      continue
    }
    const slices = new Map<string, LeaseSlice>()
    const assigned = [...new Set(line.assignedUnitIds)]
    for (const id of assigned) {
      const f = funding.get(id)
      if (!f) continue
      add(slices, f, 1, T)
      if (f.assumed) assumedUnits += 1
    }
    const rest = Math.max(0, qty - assigned.length)
    const held = heldByAsset.get(line.assetId) ?? []
    if (rest > 0 && held.length > 0) {
      const w = rest / held.length
      let assumedHeld = 0
      for (const id of held) {
        const f = funding.get(id)
        if (!f) continue
        add(slices, f, w, T)
        if (f.assumed) assumedHeld += 1
      }
      if (assumedHeld > 0) assumedUnits += Math.ceil(rest * (assumedHeld / held.length))
    }

    let balance = 0, pmt = 0, interest = 0
    const leases: LineFunding['leases'] = []
    for (const s of slices.values()) {
      balance += s.balance
      pmt += s.payment
      interest += s.interest
      if (s.balance > 0) leases.push({ leaseId: s.leaseId, label: s.label, assumed: s.assumed })
      const m = loans.get(s.leaseId)
      if (m) { m.balance += s.balance; m.payment += s.payment; m.interest += s.interest }
      else loans.set(s.leaseId, { ...s })
    }
    out.push({
      itemId: line.itemId,
      units: assigned.length + rest,
      balance: round2(balance),
      payment: round2(pmt),
      interestOverTerm: round2(interest),
      leases,
    })
  }

  return {
    loans: [...loans.values()]
      .filter((l) => round2(l.balance) > 0)
      .map((l) => ({ balance: round2(l.balance), aprPct: l.aprPct, monthsLeft: l.monthsLeft, label: l.label })),
    lines: out,
    assumedCount: assumedUnits,
  }
}
