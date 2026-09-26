/**
 * Render a Flow order's client quote to a PDF: the payment schedule, the gear
 * (names and quantities only), the subscription terms, and — for the signed
 * copy — the client's signature and autopay authorization. Ported from v1's
 * Flow branches in documents.ts (~704) and the quote download route.
 *
 * Server-only and NOT a 'use server' module: it renders whatever order id it is
 * given, so callers (a session-checked route, the signed-quote generator) do
 * their own auth. Never import it from a client component.
 */
import React from 'react'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/utils/format'
import { lineTitle } from '@/lib/quotes/line-title'
import { flowClientQuoteForReservation, flowTermsForReservation } from '@/lib/flow-terms-server'
import type { FlowQuotePdfData } from '@/components/documents/flow-quote-pdf'

export type FlowQuotePdfSigning = {
  signatureDataUrl?: string
  signerName?: string
  signedAt?: string
  approvalStamp?: { method: string; signerName: string; signedAt: string }
}

export async function renderFlowQuotePdf(
  reservationId: string,
  signing: FlowQuotePdfSigning = {},
): Promise<{ ok: true; buffer: Buffer; filename: string } | { ok: false; problem: string }> {
  const state = await flowClientQuoteForReservation(reservationId)
  if (!state) return { ok: false, problem: 'Not a Flow order.' }
  if (state.problem || !state.quote.feasible) {
    return { ok: false, problem: state.problem ?? 'This Flow schedule cannot be quoted.' }
  }
  const { reservation, items, quote: flow } = state

  const [client, terms] = await Promise.all([
    prisma.client.findUnique({
      where: { id: reservation.clientId },
      select: { name: true, companyName: true, email: true, phone: true, address: true },
    }),
    flowTermsForReservation(reservationId),
  ])
  if (!client) return { ok: false, problem: 'The order has no client.' }

  const data: FlowQuotePdfData = {
    number: reservation.reservationNumber,
    contactName: client.name,
    contactCompany: client.companyName || undefined,
    contactEmail: client.email || undefined,
    contactPhone: client.phone || undefined,
    contactAddress: client.address || undefined,
    startDate: formatDate(reservation.flowStartDate ?? reservation.startDate),
    projectName: reservation.projectName || undefined,
    quoteExpiresAt: reservation.quoteExpiresAt ? formatDate(reservation.quoteExpiresAt) : undefined,
    notes: reservation.notes || undefined,
    gear: items.map((item) => {
      const { title, spec } = lineTitle(item)
      return { description: title, spec, quantity: item.quantity || 1, isComponent: !!item.parentId }
    }),
  }

  const autopay =
    reservation.flowAutopayMethod && reservation.flowAutopayAuthorizedBy && reservation.flowAutopayAuthorizedAt
      ? {
          method: reservation.flowAutopayMethod,
          authorizedBy: reservation.flowAutopayAuthorizedBy,
          authorizedAt: formatDate(reservation.flowAutopayAuthorizedAt),
        }
      : undefined

  const { getServerLogoDataUri } = await import('@/lib/actions/documents')
  const { FlowQuotePDF } = await import('@/components/documents/flow-quote-pdf')
  const { pdf } = await import('@react-pdf/renderer')
  const doc = React.createElement(FlowQuotePDF, {
    data,
    flow,
    logoDataUri: await getServerLogoDataUri(),
    signatureDataUrl: signing.signatureDataUrl || undefined,
    signerName: signing.signerName,
    signedAt: signing.signedAt,
    approvalStamp: signing.approvalStamp,
    terms: terms ?? undefined,
    autopay,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await pdf(doc as any).toBuffer()
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(chunk)
  return {
    ok: true,
    buffer: Buffer.concat(chunks),
    filename: `${reservation.reservationNumber} - Flow Quote.pdf`,
  }
}
