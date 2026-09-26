/**
 * What a Flow line prices off, and how old the gear is.
 *
 * Flow prices owned stock off LANDED COST — `purchasePrice + landedCostAdjustment`,
 * averaged over the asset's live units. `Asset.salePrice` is deliberately not
 * consulted: an audit of the live catalog (scripts/flow-basis-audit.ts) found only
 * 19 of 237 assets carry one, the `monthlyRate × 10` fallback was wrong more often
 * than right (median 8.7×, range 1.1×–18.7×), and 34 assets would have quoted a
 * basis BELOW what the gear cost — which, since recovery targets the basis, meant
 * recovering half the capital and never getting the money back.
 *
 * The data behind this is imperfect and the caller has to know it: 16% of live units
 * carry no purchase price at all. So an uncosted unit is never averaged in as a zero
 * — it is excluded and reported, and a line with nothing costed comes back at zero
 * basis with `incomplete` set, for the UI to refuse rather than quietly quote free
 * hardware.
 *
 * Client-safe: no server-only imports, so the order form and the detail page resolve
 * the same basis the server stored.
 */

/** The unit fields this reads. A plain shape, so it is testable without Prisma. */
export type FlowBasisUnit = {
  purchasePrice: number | null
  landedCostAdjustment: number | null
  receivedDate: Date | null
  purchaseDate: Date | null
  soldAt: Date | null
  retiredAt: Date | null
}

export type FlowBasis = {
  /** Per-unit landed cost to price off. 0 when nothing is costed. */
  basis: number
  /** Live units that carried a cost and fed the average. */
  costedUnits: number
  /** Live units considered at all. */
  consideredUnits: number
  /** Average age in months, for residual. */
  monthsInService: number
  /** Live units with no usable date, so contributing 0 to the age. */
  undatedUnits: number
  /** True when any live unit lacked a cost, so the basis is partial or absent. */
  incomplete: boolean
}

/**
 * The AMC port date. Units stamped with it were imported, not bought that day —
 * reading it as a purchase date would make two-year-old gear look new and overstate
 * every residual on the order.
 */
export const AMC_IMPORT_STAMP = '2026-02-07'

const MS_PER_DAY = 86_400_000
const DAYS_PER_MONTH = 30.4375

function num(v: number | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function isUsableDate(d: Date | null): boolean {
  if (!d) return false
  return d.toISOString().slice(0, 10) !== AMC_IMPORT_STAMP
}

function monthsBetween(from: Date, to: Date): number {
  const months = (to.getTime() - from.getTime()) / MS_PER_DAY / DAYS_PER_MONTH
  return Math.max(0, Math.round(months))
}

/**
 * Resolve the basis and age for one asset's units.
 *
 * @param units every unit of the asset — sold and retired ones are filtered here
 * @param asOf  the date to age against, passed in so this stays deterministic
 */
export function resolveFlowBasis(units: FlowBasisUnit[], asOf: Date): FlowBasis {
  const live = (units || []).filter((u) => !u.soldAt && !u.retiredAt)

  const costed = live.filter((u) => num(u.purchasePrice) > 0)
  const basis = costed.length
    ? costed.reduce((s, u) => s + num(u.purchasePrice) + num(u.landedCostAdjustment), 0) / costed.length
    : 0

  let ageSum = 0
  let undated = 0
  for (const u of live) {
    const from = isUsableDate(u.receivedDate)
      ? u.receivedDate
      : isUsableDate(u.purchaseDate)
        ? u.purchaseDate
        : null
    if (from) ageSum += monthsBetween(from, asOf)
    else undated++
  }

  return {
    basis: Math.round(basis * 100) / 100,
    costedUnits: costed.length,
    consideredUnits: live.length,
    monthsInService: live.length ? Math.round(ageSum / live.length) : 0,
    undatedUnits: undated,
    incomplete: costed.length < live.length || costed.length === 0,
  }
}
