/**
 * Which open quotes are the same deal, and which version of it counts.
 *
 * Staff rework a deal by copying the order — as a rental, then rent-to-own,
 * then Flow, then a sale — and leave every version open. Summing them counts
 * one deal five times (2026-10-01: one client had six open versions of the same
 * 40-system deal, ~$2.7M of pipeline that is really one sale or none).
 *
 * Two open orders for the same client are versions of one deal when their names
 * match once "(copy)" and "Flow -" are stripped, or when most of the smaller
 * one's assets are on the other. Of a deal's versions, one counts: the furthest
 * along (sent beats draft), then the most recently touched — and never a stale
 * one while a fresh one exists. The owner can overrule any order: count it, leave
 * it out, or call it a separate deal.
 *
 * A quote that is a version of an order already booked counts for nothing: the
 * booked order carries the deal (2026-10-01: RES-2026-00090, a smaller re-quote
 * of Ramsey's live RES-2026-00001, added ~$89k on top of it).
 *
 * Pure — no prisma, no next.
 */

export type ChoiceMode = 'COUNT' | 'SKIP' | 'SEPARATE'

export type GroupableOrder = {
  id: string
  clientId: string
  name: string | null
  assetIds: string[]
  status: string
  updatedAt: Date
  stale: boolean
  choice: ChoiceMode | null
  /** Orders the owner linked as one job: same id, same deal, whatever the client or name. */
  dealGroupId?: string | null
}

export type DealGroup<T extends GroupableOrder> = {
  /** Every version, the counted one(s) first. */
  orders: T[]
  counted: Set<string>
  /** Why each uncounted order is out, by id. */
  reasons: Map<string, string>
}

const STAGE_RANK: Record<string, number> = { REVISION: 3, QUOTE_SENT: 3, DRAFT: 1 }

/** The tolerance for "most of": share of the smaller order's distinct assets found on the other. */
export const ASSET_OVERLAP = 0.6

export function normalizeDealName(name: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\(copy\)/g, ' ')
    .replace(/^\s*flow\s*[-–:]\s*/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function sameDeal(a: GroupableOrder, b: GroupableOrder): boolean {
  // The owner's link is the whole answer: linked together is one deal, and a
  // linked order is never folded into another by name or assets.
  if (a.dealGroupId || b.dealGroupId) return !!a.dealGroupId && a.dealGroupId === b.dealGroupId && a.choice !== 'SEPARATE' && b.choice !== 'SEPARATE'
  if (a.clientId !== b.clientId) return false
  if (a.choice === 'SEPARATE' || b.choice === 'SEPARATE') return false
  const na = normalizeDealName(a.name)
  const nb = normalizeDealName(b.name)
  if (na && na === nb) return true
  const sa = new Set(a.assetIds)
  const sb = new Set(b.assetIds)
  const small = Math.min(sa.size, sb.size)
  if (small === 0) return false
  let shared = 0
  for (const id of sa) if (sb.has(id)) shared++
  return shared / small >= ASSET_OVERLAP
}

function better(a: GroupableOrder, b: GroupableOrder): number {
  if (a.stale !== b.stale) return a.stale ? 1 : -1
  const rank = (STAGE_RANK[b.status] ?? 0) - (STAGE_RANK[a.status] ?? 0)
  if (rank !== 0) return rank
  return b.updatedAt.getTime() - a.updatedAt.getTime()
}

export type Period = { start: Date; end: Date }

/**
 * The booked order an open quote is a version of, if any: same deal (as sameDeal)
 * and for the same dates. Dates matter here — a repeat client quoting the same
 * models again months later is new business, not a version (AV Squad's October
 * render nodes vs its May rental). Skipped when the owner said count it or keep it separate.
 */
export function bookedVersionOf<B extends Pick<GroupableOrder, 'clientId' | 'name' | 'assetIds'> & { period: Period }>(
  quote: GroupableOrder & { period: Period },
  booked: B[],
): B | null {
  if (quote.choice === 'COUNT' || quote.choice === 'SEPARATE') return null
  const overlaps = (a: Period, b: Period) => a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime()
  return booked.find((b) =>
    overlaps(quote.period, b.period) &&
    sameDeal(quote, { ...b, id: '', status: 'BOOKED', updatedAt: quote.updatedAt, stale: false, choice: null }),
  ) ?? null
}

export function groupDeals<T extends GroupableOrder>(orders: T[]): DealGroup<T>[] {
  // Union-find over every pair: versions chain (A≈B, B≈C) even when A and C differ.
  const parent = orders.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      if (sameDeal(orders[i], orders[j])) parent[find(i)] = find(j)
    }
  }
  const buckets = new Map<number, T[]>()
  orders.forEach((o, i) => {
    const root = find(i)
    buckets.set(root, [...(buckets.get(root) ?? []), o])
  })

  return [...buckets.values()].map((members) => {
    const counted = new Set<string>()
    const reasons = new Map<string, string>()
    const live = members.filter((o) => o.choice !== 'SKIP')
    const forced = live.filter((o) => o.choice === 'COUNT')
    if (forced.length) {
      for (const o of forced) counted.add(o.id)
    } else {
      const best = [...live].sort(better)[0]
      if (best && !best.stale) counted.add(best.id)
    }
    const lead = members.find((o) => counted.has(o.id))
    for (const o of members) {
      if (counted.has(o.id)) continue
      reasons.set(
        o.id,
        o.choice === 'SKIP' ? 'left out by you'
          : o.stale && !lead ? 'stale — untouched for 90 days'
          : 'another version of this deal counts',
      )
    }
    const ordered = [...members].sort((a, b) => Number(counted.has(b.id)) - Number(counted.has(a.id)) || better(a, b))
    return { orders: ordered, counted, reasons }
  })
}
