/**
 * What a Flow line keeps when updateReservation rebuilds the order's lines.
 *
 * The rebuild deletes the active package's lines and creates them again from the
 * caller's rows, so anything a row omits would be lost. For Flow that is money: a
 * line's cost basis may have been raised above true cost, and its co-term month
 * (flowAddedAtMonth) shapes the schedule. So each incoming row is matched to the
 * line it edits and carries those forward when the caller omits them; and once
 * the order is locked (agreed by the client, or anything billed) a row may not
 * change them on an existing line at all.
 *
 * Pure and client-safe.
 */

/** A number, a numeric string, or a Prisma Decimal. */
type NumLike = number | string | { toString(): string } | null | undefined

export type FlowCarryIncoming = {
  /** The existing line this row edits, when the caller knows it. */
  id?: string | null
  uid?: string | null
  assetId?: string | null
  costBasis?: number | null
  /** Undefined = omitted (carry forward); null = explicitly from the start. */
  flowAddedAtMonth?: number | null
}

export type FlowCarryExisting = {
  id: string
  assetId: string | null
  costBasis: NumLike
  trueCost: NumLike
  flowAddedAtMonth: number | null
}

const num = (v: NumLike): number | null => {
  if (v == null || v === '') return null
  const n = Number(typeof v === 'object' ? v.toString() : v)
  return Number.isFinite(n) ? n : null
}
const cents = (n: number | null) => (n == null ? null : Math.round(n * 100))

/**
 * Pair each incoming row (by index) with the existing line it edits: first by line
 * id (or a uid that is one), then — for a row that names no id — the next
 * unmatched line on the same asset, in the existing lines' order. A row that
 * swaps its line's asset is a new line and matches nothing.
 */
export function matchFlowLines<E extends FlowCarryExisting>(incoming: FlowCarryIncoming[], existing: E[]): Map<number, E> {
  const match = new Map<number, E>()
  const used = new Set<string>()
  incoming.forEach((item, i) => {
    const hit = existing.find((e) => !used.has(e.id) && (e.id === item.id || e.id === item.uid)
      && (e.assetId ?? null) === (item.assetId ?? null))
    if (hit) { used.add(hit.id); match.set(i, hit) }
  })
  incoming.forEach((item, i) => {
    if (match.has(i) || item.id || !item.assetId) return
    const hit = existing.find((e) => !used.has(e.id) && e.assetId === item.assetId)
    if (hit) { used.add(hit.id); match.set(i, hit) }
  })
  return match
}

export type FlowLineCarry =
  | { ok: true; costBasis: number | null; trueCost: number | null; flowAddedAtMonth: number | null }
  /** Which locked thing the row tried to change, for assertFlowTermsOpen's message. */
  | { ok: false; changed: 'cost basis' | 'co-term months' }

/**
 * The basis, true cost and co-term month a rebuilt Flow line stores.
 *
 * True cost is the matched line's snapshot, else the one already snapshotted for
 * the asset on this order (`assetTrueCost`); never the caller's. The basis is the
 * caller's when sent, else the matched line's, floored at true cost either way.
 * The co-term month is the caller's when sent (null included), else the matched
 * line's. When `locked`, a row that sends a basis or co-term month different from
 * the matched line's is refused.
 */
export function carryFlowLine(
  item: FlowCarryIncoming,
  prev: FlowCarryExisting | undefined,
  assetTrueCost: number | null,
  locked: boolean,
): FlowLineCarry {
  const trueCost = !item.assetId ? null : num(prev?.trueCost) ?? assetTrueCost
  const floored = (n: number | null) => (trueCost != null ? Math.max(n ?? trueCost, trueCost) : n)
  const prevBasis = num(prev?.costBasis)
  const costBasis = floored(item.costBasis != null ? item.costBasis : prevBasis)
  const flowAddedAtMonth = item.flowAddedAtMonth !== undefined ? item.flowAddedAtMonth : prev?.flowAddedAtMonth ?? null

  if (locked && prev) {
    if (item.costBasis != null && cents(costBasis) !== cents(floored(prevBasis))) {
      return { ok: false, changed: 'cost basis' }
    }
    if (item.flowAddedAtMonth !== undefined && (flowAddedAtMonth ?? null) !== (prev.flowAddedAtMonth ?? null)) {
      return { ok: false, changed: 'co-term months' }
    }
  }
  return { ok: true, costBasis, trueCost, flowAddedAtMonth }
}
