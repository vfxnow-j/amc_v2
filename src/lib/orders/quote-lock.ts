/**
 * The quote lock: once a quote is sent, what was quoted is what the client
 * approves. Pure — no prisma, no 'use server'.
 *
 * Anything that changes what the client was quoted (lines, quantities, rates,
 * options, discount, tax, shipping price, the term's dates) is allowed on a
 * DRAFT or a REVISION only (owner, 2026-10-20: "only in revision can a sent
 * quote be changed"). A staff "Request revision" or a client "Request changes"
 * moves the order to REVISION, which reopens it; re-sending moves it back.
 *
 * Operational changes are never gated by this: shipping details and tracking,
 * notes, scanning units out and in, stage moves, billing and payments, the
 * client's approval.
 *
 * One deliberate exception: a live Flow or Cloud subscription (ACTIVE) keeps
 * being managed — Flow adds lines co-terminously and a cloud order's hosts and
 * environment are changed while it runs — and an ACTIVE order has no revision
 * path to reopen it. Listed for the owner in the build-groups report.
 */

export const QUOTE_EDITABLE_STATUSES = ['DRAFT', 'REVISION']

export const QUOTE_LOCKED_MESSAGE = 'This quote has been sent. Request a revision to change it.'

/** Whether the quote itself can change on an order in this status (and of this type). */
export function quoteEditable(status: string, type?: string | null): boolean {
  if (QUOTE_EDITABLE_STATUSES.includes(status)) return true
  return status === 'ACTIVE' && (type === 'FLOW' || type === 'CLOUD')
}

/** The kinds of change an action makes, for the policy table. */
export type ChangeCategory =
  | 'line-rate'
  | 'line-quantity'
  | 'line-add'
  | 'line-remove'
  | 'line-detail'
  | 'line-order'
  | 'option'
  | 'discount-tax'
  | 'shipping-price'
  | 'dates'
  | 'build'
  | 'shipping-details'
  | 'notes'
  | 'checkout'
  | 'status'
  | 'billing'
  | 'approval'

const QUOTE_CHANGING: ChangeCategory[] = [
  'line-rate', 'line-quantity', 'line-add', 'line-remove', 'line-detail', 'line-order',
  'option', 'discount-tax', 'shipping-price', 'dates', 'build',
]

export function changesQuote(category: ChangeCategory): boolean {
  return QUOTE_CHANGING.includes(category)
}

/** The policy in one place: may this kind of change be made on this order now? */
export function mayChange(category: ChangeCategory, status: string, type?: string | null): boolean {
  return !changesQuote(category) || quoteEditable(status, type)
}

type Existing = {
  startDate?: Date | string | null
  endDate?: Date | string | null
  discountType?: string | null
  discountValue?: unknown
  taxRate?: unknown
  deliveryCost?: unknown
  returnCost?: unknown
  shippingMarginType?: string | null
  shippingMargin?: unknown
  rtoTermMonths?: unknown
  flowTermMonths?: unknown
  flowMarginPct?: unknown
  flowFinancePct?: unknown
  flowPurchaseTaxPct?: unknown
  flowTaxExempt?: unknown
  flowRecoverByMonth?: unknown
  flowStepPct?: unknown
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v))
const day = (v: unknown) => (v == null ? null : new Date(v as Date).getTime())

/**
 * Whether a general order update changes the quote, given what it sends and what
 * the order already holds. A field sent back unchanged (a form posting the whole
 * record) is not a change. `ignoreDates` is for orders already out of the door,
 * whose dates move only through Extend.
 */
export function updateChangesQuote(
  input: Record<string, unknown>,
  existing: Existing,
  opts: { ignoreDates?: boolean } = {},
): boolean {
  if (input.items !== undefined) return true
  if (!opts.ignoreDates) {
    if (input.startDate !== undefined && day(input.startDate) !== day(existing.startDate)) return true
    if (input.endDate !== undefined && day(input.endDate) !== day(existing.endDate)) return true
  }
  if (input.discountType !== undefined && (input.discountType || null) !== (existing.discountType || null)) return true
  if (input.shippingMarginType !== undefined && (input.shippingMarginType || null) !== (existing.shippingMarginType || null)) return true
  if (input.flowTaxExempt !== undefined && Boolean(input.flowTaxExempt) !== Boolean(existing.flowTaxExempt)) return true
  const numeric: Array<keyof Existing> = [
    'discountValue', 'taxRate', 'deliveryCost', 'returnCost', 'shippingMargin', 'rtoTermMonths',
    'flowTermMonths', 'flowMarginPct', 'flowFinancePct', 'flowPurchaseTaxPct', 'flowRecoverByMonth', 'flowStepPct',
  ]
  return numeric.some((k) => input[k] !== undefined && input[k] !== null && num(input[k]) !== num(existing[k]))
}
