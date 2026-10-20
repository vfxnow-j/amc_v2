/**
 * "What it could look like": a Full Inventory row with Current's proposed date/cost applied and
 * every derived figure (total cost, depreciable base, book value, accumulated depreciation,
 * gain/loss) recomputed with AMC's own depreciation function. Totals rows are rebuilt the same
 * way the report builds them.
 */
import { calculateDepreciatedValue, type DepreciationMethod } from '../../../src/lib/utils/depreciation'
import { depreciationMethodLabels } from '../../../src/lib/types'
import type { FullInventoryRow } from './full-inventory-rows'
import { IMPORT_STAMPS } from './grade'

export type Proposal = { date: string | null; datePct: number | null; cost: number | null; costPct: number | null }
export type Proposed = { row: FullInventoryRow; changed: string[]; changes: string[]; pct: number | null }

const METHOD_BY_LABEL = Object.fromEntries(Object.entries(depreciationMethodLabels).map(([k, v]) => [v, k])) as Record<string, DepreciationMethod>
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v))
const money = (v: unknown) => (v === '' || v == null ? 'blank' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

/** A Current sale applied to the unit. `markSold` moves an active / loosely-retired unit to SOLD. */
export type SaleProposal = {
  markSold: boolean; date: string | null; buyer: string | null; price: number | null
  pct: number; pricePct: number | null; label: string
}

/**
 * @param receivedDate AMC receivedDate (YYYY-MM-DD) — depreciation starts there when it is real;
 *   when it is missing or an import stamp, it starts at the (proposed) purchase date.
 */
export function proposeRow(row: FullInventoryRow, p: Proposal | undefined, receivedDate: string | null, sale?: SaleProposal): Proposed {
  const out = { ...row }
  const changed: string[] = []
  const changes: string[] = []
  const pcts: number[] = []
  const set = (k: string, v: string | number, pct: number | null, label = k) => {
    changes.push(`${label} ${row[k] === '' || row[k] == null ? 'blank' : typeof row[k] === 'number' && /Price/.test(k) ? money(row[k]) : row[k]} → ${typeof v === 'number' && /Price/.test(k) ? money(v) : v}${pct != null ? ` (${pct}%)` : ''}`)
    out[k] = v
    changed.push(k)
    if (pct != null) pcts.push(pct)
  }
  if (p?.date && p.date !== row['Purchase Date']) set('Purchase Date', p.date, p.datePct)
  if (p?.cost != null && round2(p.cost) !== round2(num(row['Purchase Price']))) set('Purchase Price', round2(p.cost), p.costPct)
  if (sale) {
    if (sale.markSold && row['Status'] !== 'SOLD') set('Status', 'SOLD', sale.pct, `Status (${sale.label})`)
    if (sale.markSold && row['Disposition'] !== 'Sold') set('Disposition', 'Sold', null)
    if (sale.date && sale.date !== row['Disposed On']) { set('Disposed On', sale.date, sale.markSold ? null : sale.pct); out['Book Value As Of'] = sale.date }
    if (sale.buyer && sale.buyer !== row['Disposed To']) set('Disposed To', sale.buyer, null)
    if (sale.price != null && round2(sale.price) !== round2(num(row['Sale Price']))) set('Sale Price', round2(sale.price), sale.pricePct)
  }
  if (!changed.length) return { row: out, changed, changes, pct: null }

  const price = num(out['Purchase Price'])
  const cost = round2(price + num(out['Landed Cost Adj.']))
  const salvage = num(out['Salvage Value'])
  const life = num(out['Useful Life (months)']) || 60
  const method = METHOD_BY_LABEL[String(out['Depreciation Method'])] ?? 'STRAIGHT_LINE'
  const start = receivedDate && !IMPORT_STAMPS.includes(receivedDate) ? new Date(receivedDate) : null
  const asOf = new Date(String(out['Book Value As Of']))
  let book = cost
  if (out['Purchase Date'] && cost > 0) book = calculateDepreciatedValue(cost, new Date(String(out['Purchase Date'])), method, life, salvage, start, asOf)
  book = round2(book)

  out['Total Cost'] = cost || ''
  out['Depreciable Base'] = cost - salvage > 0 ? cost - salvage : ''
  out['Current Book Value'] = book
  out['Accumulated Depreciation'] = round2(cost - book)
  out['Gain / Loss'] = out['Disposition'] === 'Sold' && out['Sale Price'] !== '' && out['Sale Price'] != null ? round2(num(out['Sale Price']) - book) : row['Gain / Loss']
  for (const k of ['Total Cost', 'Current Book Value', 'Accumulated Depreciation', 'Gain / Loss', 'Book Value As Of']) if (out[k] !== row[k] && !changed.includes(k)) changed.push(k)
  return { row: out, changed, changes, pct: pcts.length ? Math.min(...pcts) : null }
}

/**
 * Re-split unit rows into the report's two sections after statuses change: live units, the
 * totals row, a blank, the SOLD / RETIRED header, disposed units, their totals. Order is kept.
 */
export function resection(rows: FullInventoryRow[]): FullInventoryRow[] {
  const name = (r: FullInventoryRow) => String(r['Asset Name'] ?? '')
  const units = rows.filter((r) => r['Barcode'])
  const isActive = (r: FullInventoryRow) => !r['Disposition'] && r['Status'] !== 'SOLD' && r['Status'] !== 'RETIRED'
  const active = units.filter(isActive)
  const disposed = units.filter((r) => !isActive(r))
  const blank = Object.fromEntries(Object.keys(rows[0] ?? {}).map((k) => [k, ''])) as FullInventoryRow
  const totals = rows.find((r) => name(r).startsWith('--- TOTALS')) ?? { ...blank }
  const dTotals = rows.find((r) => name(r).startsWith('--- SOLD / RETIRED TOTALS')) ?? { ...blank, 'Asset Name': '--- SOLD / RETIRED TOTALS ---' }
  const out: FullInventoryRow[] = [...active, { ...totals, 'Asset Name': `--- TOTALS (${active.length} active units) ---` }]
  if (disposed.length) {
    out.push({ ...blank }, { ...blank, 'Asset Name': `=== SOLD / RETIRED (${disposed.length} units — not in the totals above; book value as of disposal) ===` }, ...disposed, { ...dTotals })
  }
  return recomputeTotals(out)
}

const ACTIVE_SUMS = ['Purchase Price', 'Landed Cost Adj.', 'Total Cost', 'Salvage Value', 'Current Book Value', 'Accumulated Depreciation', 'Lifetime Revenue', 'Maintenance Cost']
const DISPOSED_SUMS = ['Purchase Price', 'Landed Cost Adj.', 'Total Cost', 'Current Book Value', 'Accumulated Depreciation', 'Lifetime Revenue', 'Sale Price', 'Gain / Loss']

/** Rebuild the two totals rows over (possibly changed) unit rows — same sums as the report. */
export function recomputeTotals(rows: FullInventoryRow[]): FullInventoryRow[] {
  const out = rows.map((r) => ({ ...r }))
  const name = (r: FullInventoryRow) => String(r['Asset Name'] ?? '')
  const sum = (list: FullInventoryRow[], k: string) => round2(list.reduce((a, r) => a + (Number(r[k]) || 0), 0))
  const ti = out.findIndex((r) => name(r).startsWith('--- TOTALS'))
  if (ti >= 0) {
    const active = out.slice(0, ti)
    for (const k of ACTIVE_SUMS) out[ti][k] = sum(active, k)
    out[ti]['Depreciable Base'] = round2(num(out[ti]['Total Cost']) - num(out[ti]['Salvage Value']))
    out[ti]['Net Profit'] = round2(num(out[ti]['Lifetime Revenue']) - num(out[ti]['Maintenance Cost']))
  }
  const hi = out.findIndex((r) => name(r).startsWith('=== SOLD / RETIRED'))
  const di = out.findIndex((r) => name(r).startsWith('--- SOLD / RETIRED TOTALS'))
  if (hi >= 0 && di > hi) {
    const disposed = out.slice(hi + 1, di)
    for (const k of DISPOSED_SUMS) out[di][k] = sum(disposed, k)
  }
  return out
}
