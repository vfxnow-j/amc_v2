/**
 * A fingerprint of the Flow schedule a client is shown: every monthly row, the
 * one-time charges, the totals, the term, and the extension figures. The quote
 * page is sent it with the schedule and hands it back on approval; approveQuote
 * recomputes it from the order as it stands and refuses a mismatch, so a schedule
 * re-priced after the client opened the page is never frozen onto their order.
 *
 * Pure (node crypto only) — no prisma, no 'use server', no next/*.
 */
import { createHash } from 'crypto'
import type { FlowClientQuote } from './flow-client-quote'
import type { RenderedFlowTerms } from './flow-terms'

/** JSON with object keys sorted at every depth, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // JSON.stringify(undefined) is undefined; treat it as null so the text is always JSON.
    return JSON.stringify(value === undefined ? null : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export const FLOW_SCHEDULE_HASH_PATTERN = /^[0-9a-f]{64}$/

/** SHA-256 hex of the client-facing schedule and extension figures. */
export function flowScheduleHash(quote: FlowClientQuote, extension: RenderedFlowTerms['extension']): string {
  const basis = {
    termMonths: quote.termMonths,
    rows: quote.rows.map((r) => ({ month: r.month, payment: r.payment, tax: r.tax, total: r.total, remaining: r.remaining })),
    oneTime: quote.oneTime.map((o) => ({ label: o.label, amount: o.amount })),
    totals: quote.totals,
    extension: { pct: extension.pct, monthly: extension.monthly, finalMonthly: extension.finalMonthly },
  }
  return createHash('sha256').update(canonicalJson(basis)).digest('hex')
}
