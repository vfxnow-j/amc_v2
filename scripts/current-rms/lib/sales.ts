/**
 * Sale evidence from Current for AMC units, strongest first:
 *   1. sale_line_asset — the unit is attached to a Sale line (sold qty / completed)
 *   2. sell_txn        — a Current stock "Sell" movement on the unit (to a client or via an order)
 *   3. buyout          — a sale line with no asset; the unit sat on that client's rental open at the sale
 *   4. text_mention    — the unit's barcode is written in a sale order's text
 * Sale lines left with unexplained quantity are returned as holes. Pure: no I/O.
 */
import { modelOverlap } from './classify'
import { normalizeBarcode } from './normalize'

export type SaleKind = 'sale_line_asset' | 'sell_txn' | 'buyout' | 'text_mention'
/** A stock Sell movement. For sourceType 'Member' the member is the STAFF user who entered it, not the buyer. */
export type SellTxn = { stockId: number; date: string; sourceType: string; sourceId: number; by?: string | null }
export type Opp = { id: number; number: string; subject: string; memberId: number | null; starts: string | null; ends: string | null; state: string; status: string; text: string; saleTotal: number }
export type OppLine = { id: number; oppId: number; name: string; description: string; txnType: string; lineType: string; qty: number; price: number; assets: { stockId: number; status: string; qtySold: number; qtyReturned?: number }[] }
/** A Current stock item matched to an AMC unit. */
export type StockUnit = { stockId: number; barcode: string; assetName: string; itemName: string }
/** Any AMC unit (for barcodes written in text, and hole candidates). */
export type AmcRef = { barcode: string; assetName: string; bucket: string }

export type SaleEvidence = {
  barcode: string; kind: SaleKind; date: string | null; buyerId: number | null; oppId: number | null; lineId: number | null
  price: number | null; salePct: number; pricePct: number | null; reasons: string[]
}
export type Hole = { line: OppLine; opp: Opp; unexplained: number; candidates: string[] }

const SALE_STATUSES = ['Completed', 'Active', 'Open', 'Postponed']
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5
/** A sale line fits a unit only when they share a model token (P620, 3080Ti, A5000) — not generic words. */
const lineMatches = (l: OppLine, names: string[]) => names.some((n) => n && modelOverlap(`${l.name} ${l.description}`, n).length > 0)
const SALE_WORDS = /(\bsale\b|sold|buy ?out|purchase|\bsell)/i
const BUYOUT_MIN_PRICE = 200 // below this a sale line is an accessory (drive carrier, SSD), not the rented unit
/** Barcodes written by hand: 6-digit, VFX####, or a short number after AID/asset/tag/#. */
const TOKEN_RE = /(?:\b(?:aid|asset|tag)\s*#?\s*:?\s*|#\s*)(\d{3,6})\b|\b(\d{6})\b|\b(VFX\d{3,4})\b/gi

export function barcodeTokens(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TOKEN_RE)) out.add(normalizeBarcode(m[1] ?? m[2] ?? m[3]))
  return [...out]
}

export function findSales(i: { sells: SellTxn[]; opps: Opp[]; lines: OppLine[]; stockUnits: StockUnit[]; amc: AmcRef[]; windowDays?: number }) {
  const window = i.windowDays ?? 45
  const oppById = new Map(i.opps.map((o) => [o.id, o]))
  const isOrder = (o: Opp | undefined) => !!o && o.state === 'Order' && SALE_STATUSES.includes(o.status)
  /** An order that is actually selling something (not just a rental that lists its units). */
  const isSaleOrder = (o: Opp | undefined) => isOrder(o) && (o!.saleTotal > 0 || SALE_WORDS.test(o!.subject))
  const saleLines = i.lines.filter((l) => l.txnType === 'Sale' && l.lineType === 'Principal' && isOrder(oppById.get(l.oppId)))
  const byStock = new Map(i.stockUnits.map((u) => [u.stockId, u]))
  const amcByNorm = new Map(i.amc.map((a) => [normalizeBarcode(a.barcode), a]))
  const used = new Map<number, number>() // sale line id → units attributed
  const remaining = (l: OppLine) => Math.max(0, Math.round(l.qty) - (used.get(l.id) ?? 0))
  const take = (l: OppLine) => used.set(l.id, (used.get(l.id) ?? 0) + 1)
  const ev = new Map<string, SaleEvidence>()
  const note = (bc: string, r: string) => ev.get(bc)?.reasons.push(r)

  /** Price a unit from sale lines on candidate orders: one fitting line → confident; several → weak. */
  const priceFrom = (orders: Opp[], names: string[], high: number, low: number) => {
    const fits = saleLines.filter((l) => orders.some((o) => o.id === l.oppId) && remaining(l) > 0 && lineMatches(l, names))
    if (!fits.length) return null
    const prices = new Set(fits.map((l) => l.price))
    const line = fits.sort((a, b) => days(oppById.get(a.oppId)!.starts ?? '', orders[0].starts ?? '') - days(oppById.get(b.oppId)!.starts ?? '', orders[0].starts ?? ''))[0]
    return { line, pct: prices.size === 1 ? high : low }
  }

  // 1. Units attached to a sale line.
  for (const l of saleLines) {
    const o = oppById.get(l.oppId)!
    for (const a of l.assets) {
      const u = byStock.get(a.stockId)
      if (!u || !(a.qtySold > 0 || a.status === 'Completed') || ev.has(u.barcode)) continue
      ev.set(u.barcode, { barcode: u.barcode, kind: 'sale_line_asset', date: o.starts, buyerId: o.memberId, oppId: o.id, lineId: l.id, price: l.price || null, salePct: 95, pricePct: l.price ? 95 : null, reasons: [`attached to sale line on ${o.number}`] })
      take(l)
    }
  }

  // 2. Stock "Sell" movements.
  for (const t of [...i.sells].sort((a, b) => a.date.localeCompare(b.date))) {
    const u = byStock.get(t.stockId)
    if (!u) continue
    if (ev.has(u.barcode)) { note(u.barcode, `Current Sell movement ${t.date} agrees`); continue }
    const names = [u.assetName, u.itemName]
    if (t.sourceType === 'Opportunity') {
      const o = oppById.get(t.sourceId)
      const p = o ? priceFrom([o], names, 90, 60) : null
      if (p) take(p.line)
      ev.set(u.barcode, { barcode: u.barcode, kind: 'sell_txn', date: t.date, buyerId: o?.memberId ?? null, oppId: o?.id ?? null, lineId: p?.line.id ?? null, price: p?.line.price || null, salePct: 95, pricePct: p?.line.price ? p.pct : null, reasons: [`Current Sell movement via ${o?.number ?? `order #${t.sourceId}`}`] })
    } else {
      // Staff-entered Sell: find the client from sale orders near the date with a line naming this model.
      const orders = i.opps.filter((o) => isSaleOrder(o) && o.starts && days(o.starts, t.date) <= window)
      const fits = saleLines.filter((l) => orders.some((o) => o.id === l.oppId) && remaining(l) > 0 && lineMatches(l, names))
      const fitOrders = [...new Set(fits.map((l) => l.oppId))].map((id) => oppById.get(id)!)
      const one = fitOrders.length === 1 ? fits.filter((l) => l.oppId === fitOrders[0].id).sort((a, b) => b.price - a.price)[0] : null
      if (one) take(one)
      const o = one ? oppById.get(one.oppId)! : null
      const by = t.by ? ` (entered by ${t.by})` : ''
      ev.set(u.barcode, { barcode: u.barcode, kind: 'sell_txn', date: t.date, buyerId: o?.memberId ?? null, oppId: o?.id ?? null, lineId: one?.id ?? null, price: one?.price || null, salePct: 90, pricePct: one?.price ? 65 : null,
        reasons: [`Current Sell movement ${t.date}${by}`, o ? `buyer + price from ${o.number}, the only sale order within ±${window} days naming this model` : fitOrders.length ? `fits ${fitOrders.length} sale orders (${fitOrders.slice(0, 4).map((x) => x.number).join(', ')}) — buyer not assigned` : `no sale order within ±${window} days names this model — buyer unknown`] })
    }
  }

  // 3. Buyouts: unassetted sale line ← same client's rental still open at the sale.
  const rentalLines = i.lines.filter((l) => l.txnType === 'Rental')
  for (const l of saleLines) {
    const o = oppById.get(l.oppId)!
    if (!remaining(l) || !o.starts || o.memberId == null || l.price < BUYOUT_MIN_PRICE) continue
    const rentals = i.opps.filter((r) => r.id !== o.id && r.memberId === o.memberId && r.state === 'Order' && r.status !== 'Cancelled' && r.starts && r.starts <= o.starts! && (!r.ends || days(r.ends, o.starts!) <= 7 || r.ends >= o.starts!))
    const rentalIds = new Set(rentals.map((r) => r.id))
    const cands = rentalLines.filter((rl) => rentalIds.has(rl.oppId)).flatMap((rl) => rl.assets.map((a) => ({ rl, u: byStock.get(a.stockId) })))
      .filter((x): x is { rl: OppLine; u: StockUnit } => !!x.u && !ev.has(x.u.barcode) && lineMatches(l, [x.u.assetName, x.u.itemName]))
    const uniq = [...new Map(cands.map((c) => [c.u.barcode, c])).values()]
    for (const c of uniq.slice(0, remaining(l))) {
      const r = oppById.get(c.rl.oppId)!
      ev.set(c.u.barcode, { barcode: c.u.barcode, kind: 'buyout', date: o.starts, buyerId: o.memberId, oppId: o.id, lineId: l.id, price: l.price || null, salePct: uniq.length <= Math.round(l.qty) ? 65 : 50, pricePct: l.price ? 60 : null,
        reasons: [`buyout: was on ${r.number} (rental) when ${o.number} sold "${l.name}"`, ...(uniq.length > Math.round(l.qty) ? [`${uniq.length} rented units fit ${Math.round(l.qty)} sold`] : [])] })
      take(l)
    }
  }

  // 4. Barcodes written in sale-order text.
  for (const o of i.opps.filter(isSaleOrder)) {
    const oLines = saleLines.filter((l) => l.oppId === o.id)
    const mentions = [...barcodeTokens(o.text).map((t) => ({ t, line: null as OppLine | null })), ...oLines.flatMap((l) => barcodeTokens(`${l.name} ${l.description}`).map((t) => ({ t, line: l })))]
    for (const { t, line } of mentions) {
      const a = amcByNorm.get(t)
      if (!a) continue
      if (ev.has(a.barcode)) { note(a.barcode, `barcode also written on ${o.number}`); continue }
      const priced = line && line.price && remaining(line) ? line : null
      if (priced) take(priced)
      ev.set(a.barcode, { barcode: a.barcode, kind: 'text_mention', date: o.starts, buyerId: o.memberId, oppId: o.id, lineId: priced?.id ?? null, price: priced?.price ?? null, salePct: line ? 55 : 45, pricePct: priced ? 55 : null,
        reasons: [`barcode written in ${line ? 'sale line' : 'order text'} of ${o.number}: "${(line ? line.name : o.subject).slice(0, 60)}"`] })
    }
  }

  // Holes: sale quantity nothing above explains.
  const sold = new Set(ev.keys())
  const holes: Hole[] = saleLines.filter((l) => remaining(l) > 0 && l.price > 0).map((l) => {
    const names = i.amc.filter((a) => !sold.has(a.barcode) && a.bucket !== 'SOLD' && lineMatches(l, [a.assetName]))
    const rank = (b: string) => (b.startsWith('RETIRED') ? 0 : b.startsWith('ACTIVE') ? 1 : 2)
    return { line: l, opp: oppById.get(l.oppId)!, unexplained: remaining(l), candidates: names.sort((a, b) => rank(a.bucket) - rank(b.bucket)).slice(0, 5).map((a) => `${a.barcode} (${a.bucket})`) }
  })
  return { evidence: ev, holes }
}
