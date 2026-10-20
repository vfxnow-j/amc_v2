/**
 * Current -> proposal mapping shared by workbook.ts (Proposed sheet) and apply-high-confidence.ts, so
 * the sheet and the apply script can never disagree. Lifted unchanged from v1's workbook.ts (inline
 * proposalFor / saleFor); only made importable.
 */
import type { Proposal, SaleProposal } from './proposed'
import { combined } from './confidence'

const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10)

export function proposalFor(m: any, min: number): Proposal | undefined {
  if (!m) return undefined
  const date = (m.date_grade === 'yellow' || m.date_grade === 'orange') && m.candidate_date && (m.date_pct ?? 0) >= min ? iso(m.candidate_date) : null
  const cost = m.cost_grade === 'yellow' && m.current_cost != null && (m.cost_pct ?? 0) >= min ? Number(m.current_cost) : null
  return date || cost != null ? { date, datePct: m.date_pct, cost, costPct: m.cost_pct } : undefined
}

export function saleFor(x: any, identityPct: number, min: number): SaleProposal | undefined {
  if (!x || !(x.apply_mark_sold || x.apply_date || x.apply_buyer || x.apply_price)) return undefined
  const pct = combined(identityPct, x.sale_pct)
  if (pct < min) return undefined
  const pricePct = x.price_pct != null ? combined(identityPct, x.price_pct) : null
  return { markSold: x.apply_mark_sold, date: x.apply_date && x.sale_date ? iso(x.sale_date) : null, buyer: x.apply_buyer ? x.buyer : null,
    price: x.apply_price && x.price != null && (pricePct ?? 0) >= min ? Number(x.price) : null, pct, pricePct, label: x.kind }
}
