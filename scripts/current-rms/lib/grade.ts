export type Grade = 'none' | 'green' | 'yellow' | 'orange'
export type CurrentState = 'held' | 'sold' | 'written_off' | 'not_held'
type Graded = { grade: Grade; reason: string | null }

const RANK: Record<Grade, number> = { none: 0, green: 1, yellow: 2, orange: 3 }
export const worst = (...g: Grade[]): Grade => g.reduce<Grade>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none')

export const IMPORT_STAMPS = ['2026-02-07', '2026-02-20']
export const BULK_DAY_MIN = 25
const ACTIVE = ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED']
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5

/** Candidate = linked PO order date, else Current opening-balance date. */
export function gradeDate(i: { amc: string | null; poDate: string | null; openingDate: string | null; openingIsBulkDay: boolean }): Graded & { candidate: string | null; source: 'po' | 'opening' | null } {
  const candidate = i.poDate ?? i.openingDate
  const source = i.poDate ? 'po' : i.openingDate ? 'opening' : null
  const r = (grade: Grade, reason: string | null) => ({ grade, reason, candidate, source }) as const
  if (!candidate) return r('none', null)
  if (i.amc && days(i.amc, candidate) <= 3) return r('green', null)
  if (source === 'opening' && i.openingIsBulkDay) return r('orange', `Current date ${candidate} is a bulk-entry day`)
  if (!i.amc) return r('yellow', 'fills blank date')
  if (IMPORT_STAMPS.includes(i.amc)) return r('yellow', `replaces import stamp ${i.amc}`)
  if (source === 'po' && i.openingDate && days(i.amc, i.openingDate) <= 3) return r('yellow', `AMC has the in-stock date; PO ordered ${candidate}`)
  return r('yellow', 'date differs')
}

export function gradeCost(i: { amc: number | null; current: number | null; estimated: boolean }): Graded {
  if (i.current == null) return { grade: 'none', reason: null }
  if (!i.amc) return { grade: 'yellow', reason: 'fills blank cost' }
  if (Math.abs(i.amc - i.current) <= 1) return { grade: 'green', reason: null }
  return { grade: 'yellow', reason: `cost differs${i.estimated ? '; Current may replace an estimate' : ''}` }
}

export function gradeStatus(i: { amcStatus: string; state: CurrentState }): Graded {
  const active = ACTIVE.includes(i.amcStatus)
  if (active && (i.state === 'sold' || i.state === 'written_off')) return { grade: 'orange', reason: `Current shows ${i.state.replace('_', ' ')}; AMC ${i.amcStatus}` }
  // Expected: Current stopped being maintained before most disposals. Noted, not graded.
  if (!active && i.state === 'held') return { grade: 'none', reason: `AMC ${i.amcStatus}; Current never recorded the disposal` }
  return { grade: 'none', reason: null }
}
