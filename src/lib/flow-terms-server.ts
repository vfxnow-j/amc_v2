/**
 * Server-side Flow terms: the settings row and the rendered terms for one order.
 * Ported from v1 (src/lib/flow-terms-server.ts).
 *
 * A plain module, NOT 'use server': callers are server components, API routes and
 * server actions that have already done their own auth. Never import it from a
 * client component.
 */
import { prisma } from '@/lib/prisma'
import { computeReservationFinancials } from '@/lib/pricing/financials'
import { flowQuoteForOrder } from '@/lib/pricing/flow-quote-view'
import type { FlowClientQuote } from '@/lib/pricing/flow-client-quote'
import {
  mergeFlowTermsSettings,
  renderFlowTerms,
  type FlowTermsSettings,
  type RenderedFlowTerms,
} from '@/lib/pricing/flow-terms'

export const FLOW_TERMS_SETTING_KEY = 'flow_subscription_terms'

export async function loadFlowTermsSettings(): Promise<FlowTermsSettings> {
  const row = await prisma.setting.findUnique({ where: { key: FLOW_TERMS_SETTING_KEY } })
  return mergeFlowTermsSettings(row?.value)
}

const FLOW_QUOTE_INCLUDE = {
  packages: {
    include: { items: { include: { asset: { include: { category: true } } }, orderBy: { sortOrder: 'asc' } } },
  },
  items: { include: { asset: { include: { category: true } } }, orderBy: { sortOrder: 'asc' } },
} as const

/**
 * The client-safe Flow quote for a stored order, priced from its stored knobs and
 * lines exactly as the terms are (flowQuoteForOrder), with the extras (discount,
 * tax, delivery, return) from the same derived financials the order page shows.
 * Null when the order is missing or not a Flow order. `problem` is set, and the
 * quote infeasible, when the order cannot be put in front of a client.
 */
export async function flowClientQuoteForReservation(reservationId: string): Promise<{
  quote: FlowClientQuote
  problem?: string
  reservation: NonNullable<Awaited<ReturnType<typeof loadForQuote>>>
  items: NonNullable<Awaited<ReturnType<typeof loadForQuote>>>['items']
} | null> {
  const reservation = await loadForQuote(reservationId)
  if (!reservation || reservation.reservationType !== 'FLOW') return null
  const activePackage = reservation.packages.find((p) => p.isActive)
  const items = activePackage ? activePackage.items : reservation.items
  const financials = computeReservationFinancials({
    order: reservation,
    items,
    discountType: reservation.discountType,
    discountValue: reservation.discountValue,
    taxRate: reservation.taxRate,
    deliveryCost: activePackage?.deliveryCost ?? reservation.deliveryCost,
    returnCost: activePackage?.returnCost ?? reservation.returnCost,
    shippingMarginType: reservation.shippingMarginType,
    shippingMargin: reservation.shippingMargin,
    rentalCreditAmount: reservation.rentalCreditAmount,
  })
  // Priced from the order's stored knobs alone, exactly as the repricer does
  // (lib/flow/defaults.ts storedFlowConfig), so the quote is the stored price:
  // a legacy null knob takes the engine default, never the live settings row.
  const { quote, problem } = flowQuoteForOrder(reservation, items, {
    discountAmount: financials.discountAmount,
    taxRate: financials.taxRate,
    deliveryCost: financials.deliveryCost,
    returnCost: financials.returnCost,
  })
  if (!problem && !reservation.flowTermMonths) {
    return { quote, problem: 'This Flow order has no term yet.', reservation, items }
  }
  return { quote, problem: problem ?? (quote.feasible ? undefined : 'This Flow schedule cannot be quoted.'), reservation, items }
}

function loadForQuote(reservationId: string) {
  return prisma.reservation.findUnique({ where: { id: reservationId }, include: FLOW_QUOTE_INCLUDE })
}

/**
 * Why a Flow order cannot be quoted to its client, or null when it can. Every
 * client-quote path (link, send, preview, signed PDF) gates on this one answer.
 */
export async function flowQuoteProblem(reservationId: string): Promise<string | null> {
  const state = await flowClientQuoteForReservation(reservationId)
  if (!state) return 'Not a Flow order.'
  return state.problem ?? null
}

async function renderLive(reservationId: string): Promise<RenderedFlowTerms | null> {
  const state = await flowClientQuoteForReservation(reservationId)
  if (!state || state.problem || !state.quote.feasible) return null
  const { reservation, quote } = state
  const settings = await loadFlowTermsSettings()
  return renderFlowTerms(settings, {
    termMonths: reservation.flowTermMonths!,
    startDate: reservation.flowStartDate ?? reservation.startDate,
    endDate: reservation.endDate,
    extensionPct: reservation.flowExtensionPct == null ? null : Number(reservation.flowExtensionPct),
    quote,
  })
}

/** The terms to show for an order: its frozen snapshot once approved, otherwise a live render. */
export async function flowTermsForReservation(reservationId: string): Promise<RenderedFlowTerms | null> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { reservationType: true, flowTermsSnapshot: true },
  })
  if (!r || r.reservationType !== 'FLOW') return null
  if (r.flowTermsSnapshot) return r.flowTermsSnapshot as unknown as RenderedFlowTerms
  return renderLive(reservationId)
}

/** A fresh render stamped with the acceptance time — what approval freezes onto the order. */
export async function buildFlowTermsSnapshot(reservationId: string): Promise<RenderedFlowTerms> {
  const live = await renderLive(reservationId)
  if (!live) throw new Error('This Flow order cannot be approved until its schedule can be quoted.')
  return { ...live, acceptedAt: new Date().toISOString() }
}
