/**
 * eBay Transaction report (Seller Hub → Payments → Reports): parse orders and
 * plan which AMC units get which price / fees / date. Pure — no DB access —
 * shared by scripts/apply-ebay-transactions.ts and the Current RMS review workbook.
 *
 * Rules:
 *   saleFees = eBay fees on the order row + shipping labels bought for it
 *              (eBay deducts both from the payout), so soldPrice − saleFees is
 *              what we actually received.
 *   Bundles (one listing, several units) split evenly; a multi-quantity row
 *   splits per item (subtotal ÷ quantity).
 *   Existing prices are kept and must agree with the order, else the order is held.
 *   Orders with refunds, or listed in HOLD, are skipped.
 */
import { readFileSync } from 'node:fs'
import { parseCsv } from './csv'

export const DEFAULT_FILE = 'import_tmp/Transaction_report_20240101_20261015.csv'
export const ORDER_RE = /\b(\d{2}-\d{5}-\d{5})\b/
const FEE_COLS = [
  'Final Value Fee - fixed', 'Final Value Fee - variable', 'Regulatory operating fee',
  'Very high "item not as described" fee', 'Below standard performance fee',
  'International fee', 'Charity donation', 'Deposit processing fee',
]
// P520 workstation listings where only the GPU cites the order — the tower that
// went with it is unknown, so the price can't be split cleanly.
export const HOLD: Record<string, string> = {
  '06-13122-33235': 'P520 workstation listing; only the GPU (006028) cites it — tower unknown',
  '01-14080-78406': 'P520 workstation listing; only the GPU (006030) cites it — tower unknown',
}

// Units that don't name their order but are tied to it by count + date. Each
// entry needs evidence that leaves no other candidate.
export const MANUAL_LINKS: Record<string, { barcodes: string[]; evidence: string }> = {
  '23-12185-51581': {
    // 005482 cites this order (qty 9). All 9 AMC Quadro RTX 4000 eBay units were
    // marked sold the same day (2024-10-24), and no other Quadro RTX 4000 order exists.
    barcodes: ['005139', '005141', '005142', '005474', '005476', '005480', '005481', '005509'],
    evidence: 'same 2024-10-24 batch as 005482 on this qty-9 order; no other RTX 4000 order in report',
  },
  '15-12102-42286': {
    // Only iMac Pro order in the report: qty 4, 2024-09-23. Exactly 4 AMC iMac Pro
    // eBay units, all marked sold 2024-10-04.
    barcodes: ['004018', '004036', '004057', '004537'],
    evidence: 'only iMac Pro order in report (qty 4); exactly 4 iMac Pro eBay units, all marked sold 2024-10-04',
  },
}

const num = (s: string | undefined) => (!s || s === '--' ? 0 : Number(s.replace(/[,$]/g, '')))
const r2 = (n: number) => Math.round(n * 100) / 100
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
/** "6-Jul-26" → noon UTC that day (matches sellAssetUnit). */
function parseDate(s: string): Date {
  const [d, m, y] = s.split('-')
  return new Date(Date.UTC(2000 + Number(y), MONTHS[m], Number(d), 12))
}

export type Order = {
  orderNo: string; date: Date; title: string; qty: number; subtotal: number
  shipping: number; fees: number; labels: number; refunds: number; payoutNet: number
}

export function loadTransactions(file: string): Map<string, Order> {
  const raw = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const hi = raw.findIndex((r) => r[0] === 'Transaction creation date')
  if (hi < 0) throw new Error('Not an eBay Transaction report (header row not found)')
  const H = raw[hi].map((h) => h.trim())
  const rows = raw.slice(hi + 1).filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(H.map((h, i) => [h, (r[i] ?? '').trim()])))
  const orders = new Map<string, Order>()
  const get = (o: string) => orders.get(o) ?? orders.set(o, {
    orderNo: o, date: new Date(0), title: '', qty: 0, subtotal: 0, shipping: 0,
    fees: 0, labels: 0, refunds: 0, payoutNet: 0,
  }).get(o)!
  for (const r of rows) {
    const o = r['Order number']
    if (!ORDER_RE.test(o)) continue
    const e = get(o)
    const net = num(r['Net amount'])
    if (r.Type === 'Order') {
      e.date = parseDate(r['Transaction creation date'])
      e.title = r['Item title']
      e.qty += num(r.Quantity)
      e.subtotal += num(r['Item subtotal'])
      e.shipping += num(r['Shipping and handling'])
      e.fees += -FEE_COLS.reduce((s, c) => s + num(r[c]), 0)
    } else if (r.Type === 'Shipping label') e.labels += -net
    else if (r.Type === 'Refund') e.refunds += -net
    e.payoutNet += net
  }
  return orders
}

export type PlanUnit = {
  id: string; barcode: string; soldAt: Date | null; soldPrice: unknown; saleFees: unknown
  notes: string | null; soldNotes: string | null; retiredTo: string | null
}

export type PlannedUpdate = {
  u: PlanUnit; orderNo: string; price: number; fees: number; net: number; date: Date
  breakdown: Record<string, unknown>
}

/** Match units to orders and work out each unit's share. */
export function planEbayApply(units: PlanUnit[], orders: Map<string, Order>) {
  const cited = new Map<string, any[]>()
  for (const u of units) {
    const m = ORDER_RE.exec([u.notes, u.soldNotes, u.retiredTo].filter(Boolean).join(' | '))
    if (m) cited.set(m[1], [...(cited.get(m[1]) ?? []), u])
  }
  const linkedBy = new Map<string, string>()
  for (const [orderNo, { barcodes, evidence }] of Object.entries(MANUAL_LINKS)) {
    for (const b of barcodes) {
      const u = units.find((x: any) => x.barcode === b)
      if (!u) throw new Error(`MANUAL_LINKS: ${b} is not an eBay-sold unit`)
      if ([...cited.values()].flat().includes(u)) throw new Error(`MANUAL_LINKS: ${b} already cites an order`)
      cited.set(orderNo, [...(cited.get(orderNo) ?? []), u])
      linkedBy.set(u.id, evidence)
    }
  }

  const updates: any[] = []
  const held: string[] = []
  for (const [orderNo, us] of cited) {
    const o = orders.get(orderNo)
    if (!o || !o.qty) { held.push(`${orderNo}: not in this report (${us.map((u) => u.barcode).join('+')})`); continue }
    if (HOLD[orderNo]) { held.push(`${orderNo}: ${HOLD[orderNo]}`); continue }
    if (o.refunds) { held.push(`${orderNo}: has a refund of $${o.refunds}`); continue }
    if (o.qty > 1 && us.length > o.qty) { held.push(`${orderNo}: qty ${o.qty} but ${us.length} units — too many`); continue }
    // qty>1 → each cited unit is one of qty items; qty 1 → bundle split across cited units.
    const shares = o.qty > 1 ? o.qty : us.length
    const price = r2(o.subtotal / shares)
    const fees = r2((o.fees + o.labels) / shares)
    const mismatch = us.find((u) => u.soldPrice != null && Math.abs(Number(u.soldPrice) - price) > 0.01)
    if (mismatch) { held.push(`${orderNo}: ${mismatch.barcode} has $${mismatch.soldPrice}, order gives $${price}`); continue }
    for (const u of us) {
      updates.push({
        u, orderNo, price, fees, net: r2(price - fees), date: o.date,
        breakdown: { orderNo, orderDate: o.date.toISOString().slice(0, 10), title: o.title, qty: o.qty, unitsOnOrder: us.length,
          link: linkedBy.get(u.id) ? `count/date match: ${linkedBy.get(u.id)}` : 'unit text cites order',
          subtotal: o.subtotal, shippingCharged: o.shipping, ebayFees: r2(o.fees), shippingLabels: r2(o.labels), payoutNet: r2(o.payoutNet) },
      })
    }
  }

  return { updates, held, cited }
}

/** Coarse product family from an eBay title or AMC asset name, for proposing candidates only. */
const FAMILIES: [RegExp, string][] = [
  [/2080\s?ti/i, 'RTX 2080 Ti'], [/2080\s?s(uper)?\b|2080s/i, 'RTX 2080 Super'], [/2080/i, 'RTX 2080'],
  [/3060\s?ti/i, 'RTX 3060 Ti'], [/3070\s?ti/i, 'RTX 3070 Ti'], [/3070/i, 'RTX 3070'], [/3080\s?ti/i, 'RTX 3080 Ti'],
  [/3090/i, 'RTX 3090'], [/1080\s?ti/i, 'GTX 1080 Ti'], [/rtx\s?4000/i, 'Quadro RTX 4000'], [/rtx\s?5000/i, 'Quadro RTX 5000'],
  [/p620/i, 'P620'], [/p520/i, 'P520'], [/5820/i, 'Precision 5820'], [/7810/i, 'T7810'],
  [/imac\s?pro/i, 'iMac Pro'], [/mac\s?pro/i, 'Mac Pro'], [/intuos|pth651/i, 'Intuos Pro'],
]
export function productFamily(text: string): string | null {
  return FAMILIES.find(([re]) => re.test(text))?.[1] ?? null
}
