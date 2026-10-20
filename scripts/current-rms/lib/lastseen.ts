/**
 * Where each unit was last seen in Current: the latest rental order it was attached to, the
 * client, and whether Current recorded it coming back. "Booked Out" on a finished order means
 * Current never saw it return — the strongest lead for a "Not in warehouse" unit. Pure.
 */
import type { Opp, OppLine, StockUnit } from './sales'

export type LastSeen = { barcode: string; oppId: number; number: string; memberId: number | null; starts: string | null; ends: string | null; orderStatus: string; assetStatus: string; returned: boolean; orders: number }

const RETURNED = ['Completed', 'Checked In']

export function lastSeen(lines: OppLine[], opps: Opp[], stockUnits: StockUnit[]): Map<string, LastSeen> {
  const oppById = new Map(opps.map((o) => [o.id, o]))
  const byStock = new Map(stockUnits.map((u) => [u.stockId, u]))
  const out = new Map<string, LastSeen>()
  const count = new Map<string, number>()
  for (const l of lines) {
    if (l.txnType !== 'Rental') continue
    const o = oppById.get(l.oppId)
    if (!o || o.state !== 'Order' || o.status === 'Cancelled') continue
    for (const a of l.assets) {
      const u = byStock.get(a.stockId)
      if (!u) continue
      count.set(u.barcode, (count.get(u.barcode) ?? 0) + 1)
      const prev = out.get(u.barcode)
      if (prev && (prev.starts ?? '') > (o.starts ?? '')) continue
      if (prev && prev.starts === o.starts && prev.oppId > o.id) continue
      out.set(u.barcode, { barcode: u.barcode, oppId: o.id, number: o.number, memberId: o.memberId, starts: o.starts, ends: o.ends, orderStatus: o.status, assetStatus: a.status,
        returned: RETURNED.includes(a.status) || (a.qtyReturned ?? 0) > 0, orders: 0 })
    }
  }
  for (const [bc, v] of out) v.orders = count.get(bc) ?? 1
  return out
}
