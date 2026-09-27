import { createHash } from 'node:crypto'
import type { ReservationFormData } from '@/lib/actions/reservations'
import type { ReservationStatus } from '@/generated/prisma/client'
import type { QuoteLine, QuoteLineInternal } from './quote'

/**
 * The pure half of POST /v1/orders (docs/portal-api.md, Phase 2): request
 * checks, the order built from a stored rate, the re-price comparison and the
 * customer-facing status. No database; orders.ts does the reads and writes.
 *
 * Agreed with the portal (2026-09-26): an order is exactly its rate. The body
 * names the rate, the account and the site — never dates, lines or prices. An
 * order is all-or-nothing and one solution at a time.
 */

export type OrderRequest = { rateId: string; accountId: string; siteId: string; poNumber: string | null; notes: string | null }

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const KEY_RE = /^[A-Za-z0-9_-]{1,120}$/

export function parseIdempotencyKey(raw: string | null): string | null {
  const key = raw?.trim() ?? ''
  return KEY_RE.test(key) ? key : null
}

export function parseOrderRequest(body: unknown):
  | { ok: true; value: OrderRequest }
  | { ok: false; field: string; message: string } {
  const fail = (field: string, message: string) => ({ ok: false as const, field, message })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body', 'The body must be a JSON object.')
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) {
    if (!['rate_id', 'account_id', 'site_id', 'po_number', 'notes'].includes(key)) {
      return fail(key, `${key} is not accepted: an order is exactly its rate — re-quote to change dates, lines or prices.`)
    }
  }
  if (typeof b.rate_id !== 'string' || !ID_RE.test(b.rate_id)) return fail('rate_id', 'rate_id must be the id a quote returned.')
  if (typeof b.account_id !== 'string' || !ID_RE.test(b.account_id)) return fail('account_id', 'account_id must be a string id.')
  if (typeof b.site_id !== 'string' || !b.site_id.trim() || b.site_id.length > 120) return fail('site_id', 'site_id must be one of the account\'s external_site_id values.')
  const text = (v: unknown, field: string, max: number): string | null | { error: string } => {
    if (v == null || v === '') return null
    if (typeof v !== 'string') return { error: `${field} must be a string.` }
    const t = v.trim()
    if (t.length > max) return { error: `${field} must be at most ${max} characters.` }
    return t || null
  }
  const po = text(b.po_number, 'po_number', 60)
  if (po && typeof po === 'object') return fail('po_number', po.error)
  const notes = text(b.notes, 'notes', 2000)
  if (notes && typeof notes === 'object') return fail('notes', notes.error)
  return {
    ok: true,
    value: { rateId: b.rate_id, accountId: b.account_id, siteId: b.site_id.trim(), poNumber: po as string | null, notes: notes as string | null },
  }
}

/** The same key with a different body is refused; this is what "different" means. */
export function orderRequestHash(r: OrderRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([r.rateId, r.accountId, r.siteId, r.poNumber ?? '', r.notes ?? '']))
    .digest('hex')
}

/** What portal_rate_quotes stores (quote.ts quoteSnapshotLines / the quote route). */
export type StoredRate = {
  request: { window: { start: string; end: string | null }; lines: { offer_id: string; qty: number; solution: string; term_months: number | null }[] }
  lines: { tier: string; client: QuoteLine[]; internal: QuoteLineInternal[] }
}

export type OrderProblem = { code: 'conflict'; message: string; details?: unknown }

/** Every line allowed, one solution, one Flow term. Null when orderable. */
export function orderableProblem(rate: StoredRate): OrderProblem | null {
  const client = rate.lines.client
  if (!client.length) return { code: 'conflict', message: 'The rate has no lines.' }
  const refused = client.map((l, line) => ({ line, reason: l.reason })).filter((_, i) => !client[i].allowed)
  if (refused.length) {
    return { code: 'conflict', message: 'Every line must be allowed; re-quote without the refused lines.', details: refused }
  }
  const solutions = new Set(client.map((l) => l.solution))
  if (solutions.size > 1) return { code: 'conflict', message: 'An order is one solution; quote rental, Flow and sale separately.' }
  if (client[0].solution === 'flow' && new Set(client.map((l) => l.term_months)).size > 1) {
    return { code: 'conflict', message: 'A Flow order has one term; quote each term separately.' }
  }
  return null
}

/**
 * The re-price must match the stored rate line for line: allowed, at the same
 * line total (to the cent). Returns the refusal, or null when it matches.
 */
export function repriceProblem(stored: QuoteLine[], now: QuoteLine[]): OrderProblem | { code: 'rate_mismatch'; message: string } | null {
  const capacity = now.map((l, line) => ({ line, reason: l.reason })).filter((l) => l.reason === 'insufficient_capacity')
  if (capacity.length) {
    return { code: 'conflict', message: 'Some lines are no longer available; re-quote.', details: capacity.map((c) => ({ ...c, reason: 'insufficient_capacity' })) }
  }
  const refused = now.map((l, line) => ({ line, reason: l.reason })).filter((_, i) => !now[i].allowed)
  if (refused.length) return { code: 'conflict', message: 'Some lines can no longer be ordered; re-quote.', details: refused }
  const moved = stored.some((s, i) => Math.abs((s.line_total ?? 0) - (now[i]?.line_total ?? 0)) >= 0.01)
  if (moved || stored.length !== now.length) {
    return { code: 'rate_mismatch', message: 'Prices have changed since this rate was quoted; re-quote.' }
  }
  return null
}

const day = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00.000Z` : s)

/**
 * The staff order a rate becomes, line for line from the snapshot — rates are
 * copied, never re-derived (quote.ts SnapshotComponent). Flow lines carry their
 * assets and quantities; the shared core derives Flow cost and every Flow rate
 * from the order's knobs, as it does for a staff order.
 */
export function reservationInputFromRate(
  rate: StoredRate,
  ctx: { clientId: string; site: { label: string; address: string | null }; poNumber: string | null; notes: string | null; orderRef: string },
): ReservationFormData {
  const solution = rate.lines.client[0].solution
  const start = day(rate.request.window.start)
  const internalNote = [`Placed through the client portal (quote ${ctx.orderRef}).`, `Site: ${ctx.site.label}.`, ctx.poNumber ? `Client PO: ${ctx.poNumber}.` : '']
    .filter(Boolean)
    .join(' ')
  const common = {
    clientId: ctx.clientId,
    startDate: start,
    projectName: ctx.poNumber ? `PO ${ctx.poNumber}` : undefined,
    notes: ctx.notes ?? undefined,
    internalNotes: internalNote,
    deliveryAddress: ctx.site.address ?? undefined,
  }

  if (solution === 'flow') {
    const first = rate.lines.internal[0].flow!
    const k = first.knobs
    const n = (v: unknown) => (v == null ? undefined : Number(v))
    return {
      ...common,
      reservationType: 'FLOW',
      endDate: start, // the core sets start + term
      flowTermMonths: rate.lines.client[0].term_months ?? undefined,
      flowMarginPct: n(k.flowMarginPct),
      flowFinancePct: n(k.flowFinancePct),
      flowPurchaseTaxPct: n(k.flowPurchaseTaxPct),
      flowTaxExempt: k.flowTaxExempt ?? undefined,
      flowRecoverByMonth: k.flowRecoverByMonth ?? undefined,
      flowDeprPct: n(k.flowDeprPct),
      flowLifeMonths: k.flowLifeMonths ?? undefined,
      flowStepPct: k.flowStepPct == null ? null : Number(k.flowStepPct),
      items: rate.lines.internal.flatMap((line) =>
        (line.flow?.lines ?? []).map((l) => ({
          assetId: l.assetId,
          description: l.name,
          pricingType: 'MONTHLY' as const,
          rate: 0,
          quantity: l.quantity,
        })),
      ),
    }
  }

  const items = rate.lines.internal.flatMap((line, i) =>
    (line.components ?? []).map((c) => ({
      assetId: c.assetId,
      serviceId: c.serviceId,
      description: c.name,
      pricingType: c.pricingType as ReservationFormData['items'][number]['pricingType'],
      rate: c.rate,
      isOneTime: c.isOneTime,
      quantity: c.quantity * rate.lines.client[i].qty,
    })),
  )
  if (solution === 'sale') {
    return { ...common, reservationType: 'SALE', endDate: start, items }
  }
  return {
    ...common,
    reservationType: 'RENTAL',
    endDate: day(rate.request.window.end!),
    billingCycleType: 'MONTHLY',
    items,
  }
}

/** The fixed customer-facing list (agreed with the portal). */
export type CustomerStatus = 'pending_review' | 'approved' | 'preparing' | 'shipped' | 'active' | 'completed' | 'cancelled'

export function customerStatus(status: ReservationStatus): CustomerStatus {
  switch (status) {
    case 'APPROVED':
      return 'approved'
    case 'PREPARING':
      return 'preparing'
    case 'SHIPPED':
      return 'shipped'
    case 'ACTIVE':
      return 'active'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELLED':
    case 'LOST':
      return 'cancelled'
    default:
      return 'pending_review'
  }
}

/** Solution of a stored order, from its type. */
export function solutionOf(type: string): 'rental' | 'flow' | 'sale' | 'other' {
  return type === 'RENTAL' ? 'rental' : type === 'FLOW' ? 'flow' : type === 'SALE' ? 'sale' : 'other'
}
