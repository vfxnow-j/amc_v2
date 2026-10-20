/**
 * Build groups on sales orders: a named heading line (e.g. "Threadripper PRO
 * Workstation") that hosts priced parts. The group has no price of its own — its
 * total is the sum of its parts, and the parts are stored already multiplied by
 * the number of machines.
 *
 * Storage convention (ported from v1 c06a7e3), so totals, checkout and invoicing
 * keep working on rows they already understand:
 *   - the group row: isGroup, rate 0, subtotal 0, quantity = number of machines
 *   - each part row: parentId = the group, quantity = per-machine quantity × machines
 * Order subtotal, tax and margin sum the parts; the group row is never counted
 * twice. Only the screens that show a build as one thing (the order record, the
 * online quote, the quote PDF) roll the parts up for display.
 *
 * Pure — no prisma, no 'use server', no next/*.
 */

/**
 * Statuses in which a build's structure may change. After that the parts are
 * being scanned out, and moving one between builds would leave a machine's
 * counters describing a different machine.
 */
export const BUILD_EDITABLE_STATUSES = ['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED']

/**
 * Statuses in which lines may be reordered: only while the quote is still ours.
 * Once it goes out, what was quoted and what the client approves must read the
 * same, so the order is locked completely (owner, 2026-10-20). A revision
 * reopens it. Deliberately narrower than BUILD_EDITABLE_STATUSES.
 */
export const REORDER_STATUSES = ['DRAFT', 'REVISION']

const qtyOf = (i: { quantity?: number | null }) => i.quantity || 1

const cents = (n: number) => Math.round(n * 100) / 100

/** A part's stored quantity for a given per-machine quantity. */
export function storedPartQuantity(perMachine: number, machines: number): number {
  return Math.max(1, perMachine) * Math.max(1, machines)
}

/**
 * A part's quantity per machine (stored quantity ÷ the group's), or its stored
 * quantity when it does not divide evenly — an uneven part was edited by hand and
 * is better shown as it is than rounded.
 */
export function perMachineQty(part: { quantity?: number | null }, group: { quantity?: number | null }): number {
  const q = qtyOf(part)
  const g = qtyOf(group)
  return q % g === 0 ? q / g : q
}

/** A part's stored quantity after its group goes from `from` machines to `to`. */
export function rescaledPartQuantity(partQuantity: number, from: number, to: number): number {
  return Math.max(1, Math.round((partQuantity * Math.max(1, to)) / Math.max(1, from)))
}

/** Client-facing figures for a group row: its total and the per-machine price. */
export function groupRollup(partAmounts: number[], groupQuantity: number): { amount: number; rate: number } {
  const amount = cents(partAmounts.reduce((s, a) => s + a, 0))
  return { amount, rate: cents(amount / Math.max(1, groupQuantity)) }
}

export function groupIdsOf(items: Array<{ id?: string; isGroup?: boolean | null }>): Set<string> {
  return new Set(items.filter((i) => i.isGroup && i.id).map((i) => i.id!))
}

/**
 * Lines that must be checked out of stock before a sales order ships: real stock
 * (asset-backed, not a service or a cloud config row) that is either top-level or
 * a build group's part. Group headings and manual parts need no checkout. An
 * ordinary component (a RAM option on a machine) is pricing detail on its parent.
 */
export function isCheckoutLine(
  item: { parentId?: string | null; isGroup?: boolean | null; assetId?: string | null; serviceId?: string | null; cloudProductId?: string | null },
  groupIds: Set<string>,
): boolean {
  if (item.isGroup) return false
  if (!item.assetId || item.serviceId || item.cloudProductId) return false
  return !item.parentId || groupIds.has(item.parentId)
}

/** Spec-line label for a part whose price is hidden, e.g. "4× 32GB DDR5". */
export function specLabel(name: string, qty: number): string {
  return qty > 1 ? `${qty}× ${name}` : name
}

export type ArrangedLine<T> = {
  item: T
  /** Amount to show: for a group, the sum of its parts; otherwise the line's own. */
  amount: number
  /** Price to show: for a group, per machine; otherwise undefined (leave the line's own). */
  rate?: number
  isGroup: boolean
  isGroupPart: boolean
  /** Section a part belongs to — a group's parts always sit under the group's heading. */
  category?: string
  /** Part of a group whose part prices are hidden: a spec line with no price. */
  priceHidden?: boolean
  /** Hidden part: its per-machine quantity, so the spec list reads "4× 32GB DDR5". */
  perMachineQty?: number
}

export const BUILD_CATEGORY = 'Custom Builds'

/**
 * Lay lines out for a client-facing document: each build group followed by its
 * parts, the group showing its rolled-up total. `amounts[i]` is the already
 * derived amount of `items[i]`. Orders without groups come back in their original
 * order, untouched.
 */
export function arrangeBuildGroups<
  T extends { id: string; parentId?: string | null; isGroup?: boolean | null; quantity?: number | null; category?: string | null },
>(items: T[], amounts: number[], opts: { hidePartPrices?: boolean } = {}): Array<ArrangedLine<T>> {
  const groupIds = groupIdsOf(items)
  const plain = (item: T, i: number): ArrangedLine<T> => ({ item, amount: amounts[i], isGroup: false, isGroupPart: false })
  if (groupIds.size === 0) return items.map(plain)

  const out: Array<ArrangedLine<T>> = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.parentId && groupIds.has(item.parentId)) continue // emitted under its group
    if (!item.isGroup) {
      out.push(plain(item, i))
      continue
    }
    const partIdx = items.map((o, oi) => (o.parentId === item.id ? oi : -1)).filter((oi) => oi >= 0)
    const { amount, rate } = groupRollup(partIdx.map((oi) => amounts[oi]), qtyOf(item))
    const category = item.category || BUILD_CATEGORY
    out.push({ item, amount, rate, isGroup: true, isGroupPart: false, category })
    for (const oi of partIdx) {
      out.push(
        opts.hidePartPrices
          ? { item: items[oi], amount: 0, rate: 0, isGroup: false, isGroupPart: true, category, priceHidden: true, perMachineQty: perMachineQty(items[oi], item) }
          : { item: items[oi], amount: amounts[oi], isGroup: false, isGroupPart: true, category },
      )
    }
  }
  return out
}

/**
 * Move one id a step up or down a list of siblings, returning the new order or
 * null when it is already at that end (or not in the list). The order page lists
 * a build's parts under their heading, so a top-level line moves among top-level
 * lines (its parts travel with it, being children) and a part among its siblings.
 * Order is presentation only: it never touches a quantity, rate or total.
 */
export function movedWithin(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0) return null
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= ids.length) return null
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
