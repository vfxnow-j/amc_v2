/**
 * The whole of what a client's Flow quote page is sent, built field by field from
 * the order so nothing internal can ride along: the schedule (flowClientQuote),
 * the terms, the gear as names and quantities, and the order's public details.
 * No line rate or amount (a Flow line's rate is its whole-term contract value),
 * no cost basis, true cost, lease, funding, margin or economics.
 *
 * Pure — no prisma, no 'use server', no next/*. buildQuote (lib/actions/quote-tokens)
 * reads the order and the terms, then shapes them here; the client-safe test
 * exercises this same function.
 */
import { flowQuoteForOrder, type FlowQuoteExtras, type FlowQuoteOrderLine } from './flow-quote-view'
import type { RenderedFlowTerms } from './flow-terms'
import { lineTitle } from '@/lib/quotes/line-title'

export const FLOW_QUOTE_UNAVAILABLE = 'This quote is being updated. Please contact VFXnow for a new link.'

type DateLike = Date | string

export type FlowPayloadOrder = {
  reservationNumber: string
  reservationType: string
  status: string
  quoteExpiresAt?: DateLike | null
  client: { name: string; companyName?: string | null }
  projectName?: string | null
  flowStartDate?: DateLike | null
  startDate: DateLike
  endDate: DateLike
  deliveryMethod?: string | null
  deliveryAddress?: string | null
  deliveryDate?: DateLike | null
  deliveryNotes?: string | null
  returnMethod?: string | null
  returnDate?: DateLike | null
  notes?: string | null
  // The order's stored Flow knobs are read by flowQuoteForOrder.
  [knob: string]: unknown
}

export type FlowPayloadLine = FlowQuoteOrderLine & {
  id: string
  quantity: number
  parentId?: string | null
  asset?: { name?: string | null; category?: { name?: string | null } | null } | null
  category?: string | null
}

export function flowQuotePayload(input: {
  order: FlowPayloadOrder
  lines: FlowPayloadLine[]
  extras: FlowQuoteExtras
  terms: RenderedFlowTerms | null
  issuedAt: DateLike | null
  tokenExpiresAt: DateLike | null
}) {
  const { order, lines, extras, terms } = input
  const { quote: flow, problem } = flowQuoteForOrder(order, lines, extras)
  if (problem || !flow.feasible || !terms) return { error: FLOW_QUOTE_UNAVAILABLE } as const

  const groups = new Map<string, { id: string; name: string; spec?: string; quantity: number; isComponent: boolean }[]>()
  for (const line of lines) {
    const category = line.asset?.category?.name || line.category || 'Uncategorized'
    const { title, spec } = lineTitle({ description: line.description, asset: line.asset?.name ? { name: line.asset.name } : null })
    const list = groups.get(category) ?? []
    list.push({ id: line.id, name: title, ...(spec ? { spec } : {}), quantity: line.quantity, isComponent: !!line.parentId })
    groups.set(category, list)
  }
  const flowGear = [...groups.entries()].map(([category, items]) => ({ category, items }))

  return {
    reservationNumber: order.reservationNumber,
    reservationType: order.reservationType,
    status: order.status,
    issuedAt: input.issuedAt,
    expiresAt: order.quoteExpiresAt ?? input.tokenExpiresAt,
    clientName: order.client.name,
    companyName: order.client.companyName ?? null,
    projectName: order.projectName ?? null,
    startDate: order.flowStartDate ?? order.startDate,
    endDate: order.endDate,
    // The priced line list is for rentals; a Flow quote lists its gear in flowGear.
    itemsByCategory: [] as never[],
    subtotal: flow.totals.contract,
    discountAmount: flow.totals.discount,
    taxRate: extras.taxRate,
    taxAmount: flow.totals.tax,
    total: flow.totals.total,
    // Delivery and return reach the client as the schedule's one-time charges
    // (flow.oneTime); the rental page's deliveryCost/returnCost keys are not sent.
    deliveryMethod: order.deliveryMethod ?? null,
    deliveryAddress: order.deliveryAddress ?? null,
    deliveryDate: order.deliveryDate ?? null,
    deliveryNotes: order.deliveryNotes ?? null,
    returnMethod: order.returnMethod ?? null,
    returnDate: order.returnDate ?? null,
    billingCycleType: 'MONTHLY',
    isRecurring: true,
    notes: order.notes ?? null,
    rtoTermMonths: null,
    rtoMonthlyPayment: null,
    rtoBuyoutPrice: null,
    packages: undefined,
    // The rental payment line never applies (paymentSchedule is null for FLOW);
    // the schedule is the Flow payment line.
    paymentLine: null,
    flow,
    flowTerms: terms,
    flowGear,
  }
}
