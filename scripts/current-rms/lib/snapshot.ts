/**
 * Point-in-time stock: which units were held on a date, valued as of that date.
 * Works off (proposed) Full Inventory rows. Unknowns are kept, not dropped:
 *  - acquired date unknown: purchase date is missing or an import stamp → assumed held
 *  - disposal undated: SOLD/RETIRED with no disposal date → assumed still held
 */
import { calculateDepreciatedValue, type DepreciationMethod } from '../../../src/lib/utils/depreciation'
import { depreciationMethodLabels } from '../../../src/lib/types'
import type { FullInventoryRow } from './full-inventory-rows'
import { IMPORT_STAMPS } from './grade'

export type Basis = 'dated' | 'acquired date unknown' | 'disposal undated' | 'both unknown'
export type SnapshotRow = { row: FullInventoryRow; basis: Basis; bookValue: number; accumulated: number }

const METHOD_BY_LABEL = Object.fromEntries(Object.entries(depreciationMethodLabels).map(([k, v]) => [v, k])) as Record<string, DepreciationMethod>
const round2 = (n: number) => Math.round(n * 100) / 100
const s = (v: unknown) => (v == null ? '' : String(v))

export function heldAt(row: FullInventoryRow, asOf: string): Basis | null {
  const bought = s(row['Purchase Date'])
  const acqUnknown = !bought || IMPORT_STAMPS.includes(bought)
  const disposed = !!s(row['Disposition']) || ['SOLD', 'RETIRED'].includes(s(row['Status']))
  const disposedOn = s(row['Disposed On'])
  if (!acqUnknown && bought > asOf) return null
  if (disposed && disposedOn && disposedOn <= asOf) return null
  const dispUnknown = disposed && !disposedOn
  return acqUnknown && dispUnknown ? 'both unknown' : acqUnknown ? 'acquired date unknown' : dispUnknown ? 'disposal undated' : 'dated'
}

/** @param received barcode → AMC receivedDate (depreciation start when real) */
export function snapshot(units: FullInventoryRow[], asOf: string, received: Map<string, string | null>): SnapshotRow[] {
  const at = new Date(`${asOf}T23:59:59Z`)
  const out: SnapshotRow[] = []
  for (const row of units) {
    const basis = heldAt(row, asOf)
    if (!basis) continue
    const cost = Number(row['Total Cost']) || 0
    const rd = received.get(s(row['Barcode'])) ?? null
    const start = rd && !IMPORT_STAMPS.includes(rd) && rd <= asOf ? new Date(rd) : null
    const bought = s(row['Purchase Date'])
    let book = cost
    if (cost > 0 && bought && basis !== 'acquired date unknown' && basis !== 'both unknown') {
      book = calculateDepreciatedValue(cost, new Date(bought), METHOD_BY_LABEL[s(row['Depreciation Method'])] ?? 'STRAIGHT_LINE',
        Number(row['Useful Life (months)']) || 60, Number(row['Salvage Value']) || 0, start, at)
    }
    out.push({ row, basis, bookValue: round2(book), accumulated: round2(cost - book) })
  }
  return out
}
