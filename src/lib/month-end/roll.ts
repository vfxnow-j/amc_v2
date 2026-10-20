/**
 * Month-end fixed-asset roll-forward.
 *
 * Policy (see depreciation.ts): 60-month straight line, $0 salvage, starting at
 * the received date (purchase date fallback), full-month convention — the
 * month a unit goes into service counts in full and each month is booked at
 * its month-end. So for month M:
 *   opening  = balances as of the first instant of M   (months through M−1)
 *   closing  = balances as of the first instant of M+1 (months through M)
 *   a unit disposed in M leaves at its opening book value (no M depreciation)
 *
 *   closing NBV = opening NBV + additions − NBV of disposals − depreciation
 *
 * Units whose only date is an AMC import stamp have no known in-service date.
 * They are carried at cost in their own bucket — held from the start, never
 * depreciated, never counted as additions — so the main roll-forward stays
 * clean. Disposed units with no disposal date are left out of every period
 * and listed as exceptions.
 */
import { calculateDepreciatedValue, depreciationMonthsElapsed, type DepreciationMethod } from '@/lib/utils/depreciation'

export const IMPORT_STAMPS = new Set(['2026-02-07', '2026-02-20'])
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
export const r2 = (n: number) => Math.round(n * 100) / 100

export type MEUnit = {
  id: string
  barcode: string
  cost: number
  purchaseDate: Date
  receivedDate: Date | null
  method: DepreciationMethod
  lifeMonths: number
  salvage: number
  disposed: boolean
  disposedAt: Date | null
  reacquiredAt: Date | null
  /** Proceeds before fees (sales only). */
  salePrice: number | null
  saleFees: number | null
}

/** First instant (UTC) of a YYYY-MM month, and of the month after. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) throw new Error(`Bad month: ${month}`)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

export function inService(u: Pick<MEUnit, 'purchaseDate' | 'receivedDate'>) {
  if (u.receivedDate) return { date: u.receivedDate, known: true, source: 'Received' as const }
  if (IMPORT_STAMPS.has(ymd(u.purchaseDate)!)) return { date: null, known: false, source: 'Unknown (AMC import stamp)' as const }
  return { date: u.purchaseDate, known: true, source: 'Purchase date' as const }
}

/**
 * Bought-back units are treated as never having left: their sale still shows
 * on disposal reports, but the asset is in the fleet, so the roll-forward
 * keeps carrying it (and the exception list says so).
 */
function effectiveDisposal(u: MEUnit): { at: Date | null; undated: boolean } {
  if (!u.disposed || u.reacquiredAt) return { at: null, undated: false }
  return { at: u.disposedAt, undated: !u.disposedAt }
}

export function heldAt(u: MEUnit, t: Date): boolean {
  const svc = inService(u)
  const d = effectiveDisposal(u)
  if (d.undated) return false
  if (svc.known && !(svc.date! < t)) return false
  return !(d.at && d.at < t)
}

/** Book value as of instant t (known in-service date only). */
export function bookAt(u: MEUnit, t: Date): number {
  const svc = inService(u)
  if (!svc.known || !u.cost) return u.cost
  return r2(calculateDepreciatedValue(u.cost, u.purchaseDate, u.method, u.lifeMonths, u.salvage, u.receivedDate, t))
}

export function monthsDepreciated(u: MEUnit, t: Date): number | null {
  const svc = inService(u)
  if (!svc.known) return null
  return Math.min(u.lifeMonths, depreciationMonthsElapsed(svc.date!, t))
}

type Bal = { count: number; cost: number; accum: number; nbv: number }
const bal = (): Bal => ({ count: 0, cost: 0, accum: 0, nbv: 0 })
function addBal(b: Bal, cost: number, nbv: number) {
  b.count++; b.cost += cost; b.nbv += nbv; b.accum += cost - nbv
}
const roundBal = (b: Bal): Bal => ({ count: b.count, cost: r2(b.cost), accum: r2(b.accum), nbv: r2(b.nbv) })

export type MonthRoll = {
  month: string
  opening: Bal
  additions: { count: number; cost: number }
  disposals: Bal & { proceeds: number; fees: number; net: number; gainLoss: number }
  depreciation: number
  closing: Bal
  /** Opening + additions − disposals − depreciation − closing; should be 0. */
  check: number
  unknownDate: { openCount: number; openCost: number; disposedCount: number; disposedCost: number; closeCount: number; closeCost: number }
}

export function rollMonth(units: MEUnit[], month: string): MonthRoll {
  const { start, end } = monthBounds(month)
  const opening = bal(), closing = bal(), disp = { ...bal(), proceeds: 0, fees: 0, net: 0, gainLoss: 0 }
  const additions = { count: 0, cost: 0 }
  const unknown = { openCount: 0, openCost: 0, disposedCount: 0, disposedCost: 0, closeCount: 0, closeCost: 0 }
  let depreciation = 0

  for (const u of units) {
    const svc = inService(u)
    const atStart = heldAt(u, start)
    const atEnd = heldAt(u, end)
    const d = effectiveDisposal(u)
    const disposedInMonth = !!d.at && d.at >= start && d.at < end && (atStart || (svc.known && svc.date! >= start))

    if (!svc.known) {
      if (atStart) { unknown.openCount++; unknown.openCost += u.cost }
      if (atEnd) { unknown.closeCount++; unknown.closeCost += u.cost }
      if (disposedInMonth) { unknown.disposedCount++; unknown.disposedCost += u.cost }
      continue
    }

    const openNbv = atStart ? bookAt(u, start) : 0
    if (atStart) addBal(opening, u.cost, openNbv)
    const addedInMonth = svc.date! >= start && svc.date! < end
    if (addedInMonth) { additions.count++; additions.cost += u.cost }
    if (atEnd) {
      const closeNbv = bookAt(u, end)
      addBal(closing, u.cost, closeNbv)
      depreciation += (atStart ? openNbv : u.cost) - closeNbv
    }
    if (disposedInMonth) {
      const nbv = bookAt(u, d.at!)
      addBal(disp, u.cost, nbv)
      // Depreciation to the disposal date (0 under full-month convention, kept for safety).
      depreciation += (atStart ? openNbv : u.cost) - nbv
      const proceeds = u.salePrice ?? 0
      const fees = u.saleFees ?? 0
      disp.proceeds += proceeds; disp.fees += fees; disp.net += proceeds - fees
      disp.gainLoss += proceeds - fees - nbv
    }
  }

  const check = r2(opening.nbv + additions.cost - disp.nbv - depreciation - closing.nbv)
  return {
    month,
    opening: roundBal(opening),
    additions: { count: additions.count, cost: r2(additions.cost) },
    disposals: { ...roundBal(disp), proceeds: r2(disp.proceeds), fees: r2(disp.fees), net: r2(disp.net), gainLoss: r2(disp.gainLoss) },
    depreciation: r2(depreciation),
    closing: roundBal(closing),
    check,
    unknownDate: {
      openCount: unknown.openCount, openCost: r2(unknown.openCost), disposedCount: unknown.disposedCount,
      disposedCost: r2(unknown.disposedCost), closeCount: unknown.closeCount, closeCost: r2(unknown.closeCost),
    },
  }
}

/** Months from January of `month`'s year through `month`, as YYYY-MM. */
export function yearToMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  return Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
}

export type DeprInfo = {
  start: Date | null
  /** Last month that takes depreciation (start month + life − 1), YYYY-MM. */
  endMonth: string | null
  lifeMonths: number
  /** Calendar months in service as of t, not capped at the useful life. */
  ageMonths: number | null
  monthsDepreciated: number | null
  monthsRemaining: number | null
  fullyDepreciated: boolean | null
  monthly: number | null
  bookValue: number | null
}

/** Depreciation term and position as of instant t (full-month convention). */
export function deprInfo(u: MEUnit, t: Date): DeprInfo {
  const svc = inService(u)
  if (!svc.known) {
    return { start: null, endMonth: null, lifeMonths: u.lifeMonths, ageMonths: null, monthsDepreciated: null, monthsRemaining: null, fullyDepreciated: null, monthly: null, bookValue: null }
  }
  const s = svc.date!
  const age = depreciationMonthsElapsed(s, t)
  const done = Math.min(u.lifeMonths, age)
  const end = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + u.lifeMonths - 1, 1))
  return {
    start: s,
    endMonth: monthKey(end),
    lifeMonths: u.lifeMonths,
    ageMonths: age,
    monthsDepreciated: done,
    monthsRemaining: u.lifeMonths - done,
    fullyDepreciated: done >= u.lifeMonths,
    monthly: u.cost ? r2((u.cost - u.salvage) / u.lifeMonths) : null,
    bookValue: bookAt(u, t),
  }
}
