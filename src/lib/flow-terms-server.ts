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
import {
  mergeFlowTermsSettings,
  renderFlowTerms,
  type FlowTermsSettings,
  type RenderedFlowTerms,
} from '@/lib/pricing/flow-terms'
import { applyFlowDefaults } from '@/lib/flow/defaults'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

export const FLOW_TERMS_SETTING_KEY = 'flow_subscription_terms'

export async function loadFlowTermsSettings(): Promise<FlowTermsSettings> {
  const row = await prisma.setting.findUnique({ where: { key: FLOW_TERMS_SETTING_KEY } })
  return mergeFlowTermsSettings(row?.value)
}

async function renderLive(reservationId: string): Promise<RenderedFlowTerms | null> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      packages: {
        include: { items: { include: { asset: { include: { category: true } } }, orderBy: { sortOrder: 'asc' } } },
      },
      items: { include: { asset: { include: { category: true } } }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!reservation || reservation.reservationType !== 'FLOW' || !reservation.flowTermMonths) return null
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
  // The knobs the order left blank take the house defaults, exactly as the
  // repricer does (lib/flow/order-inputs.ts), so the terms quote the stored price.
  const defaults = await loadFlowDefaults(prisma)
  const { quote, problem } = flowQuoteForOrder(applyFlowDefaults(reservation, defaults), items, {
    discountAmount: financials.discountAmount,
    taxRate: financials.taxRate,
    deliveryCost: financials.deliveryCost,
    returnCost: financials.returnCost,
  })
  if (problem || !quote.feasible) return null
  const settings = await loadFlowTermsSettings()
  return renderFlowTerms(settings, {
    termMonths: reservation.flowTermMonths,
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
