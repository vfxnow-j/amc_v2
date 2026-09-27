import React from 'react'
import { revalidatePath } from 'next/cache'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { DOCUMENTS_ROOT, toRelativePath } from '@/lib/documents/paths'
import { getServerLogoDataUri } from '@/lib/actions/documents'
import { formatDate } from '@/lib/utils/format'
import type { PricingType } from '@/lib/types'
import { pricingTypeLabels, allDeliveryMethodLabels } from '@/lib/types'
import { formatTermLength, formatTermNote } from '@/lib/pricing/periods'
import { computeReservationFinancials } from '@/lib/pricing/financials'
import { lineTitle } from '@/lib/quotes/line-title'
import { paymentLineForOrder } from '@/lib/billing/order-payment-schedule'

/**
 * Internal-only signed-quote rendering, moved out of the 'use server' module
 * src/lib/actions/documents.ts.
 *
 * `generateSignedQuoteDocument` used to be a plain export of that file, which
 * made it directly callable from the browser as a server action with no auth
 * check: any caller who knew a reservationId could mark its proposal signed
 * under any name, with no re-check of the signature payload that its only
 * legitimate caller (`approveQuote` in quote-tokens.ts) already enforces
 * before calling it. `approveQuote` itself is intentionally unauthenticated
 * (a customer approving a quote via an emailed link isn't signed in), so the
 * fix isn't an auth check on this function — it's removing it from the
 * server-action surface entirely by moving it into a plain module. Only
 * server-side code can import it now.
 *
 * As defense in depth (in case a future caller forgets), the signature is
 * re-validated here as a `data:image/png;base64,...` URL — the same shape
 * `approveQuote` requires — before it's ever handed to the PDF renderer,
 * which would otherwise fetch an attacker-supplied remote URL (SSRF).
 */

const SIGNATURE_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
const MAX_SIGNATURE_LENGTH = 2_000_000

function sanitizeSignatureDataUrl(signatureDataUrl: string): string {
  if (!signatureDataUrl) return ''
  if (
    typeof signatureDataUrl !== 'string' ||
    signatureDataUrl.length > MAX_SIGNATURE_LENGTH ||
    !SIGNATURE_DATA_URL_RE.test(signatureDataUrl)
  ) {
    console.error('generateSignedQuoteDocument: rejected a signature that was not a data:image/png;base64,... URL')
    return ''
  }
  return signatureDataUrl
}

type SignedQuoteReservation = NonNullable<Awaited<ReturnType<typeof loadSignedQuoteReservation>>>

function loadSignedQuoteReservation(reservationId: string) {
  return prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      packages: {
        include: {
          items: {
            include: { asset: { include: { category: true } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      items: {
        include: { asset: { include: { category: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

/** The rental / sale / rent-to-own signed quote, rendered to a PDF buffer. */
async function renderSignedQuote(
  reservation: SignedQuoteReservation,
  signatureDataUrl: string,
  signerName: string,
  signedAt: string,
  approvalStamp?: { method: string; signerName: string; signedAtIso: string },
): Promise<Buffer> {
  // Use active package items if multi-package
  const activePackage = reservation.packages.find((p) => p.isActive)
  const items = activePackage ? activePackage.items : reservation.items

  // Derive rather than read the stored columns, so the PDF can never quote a total
  // the order page doesn't show. See src/lib/pricing/financials.ts.
  const financials = computeReservationFinancials({
    order: reservation,
    items,
    discountType: reservation.discountType,
    discountValue: reservation.discountValue,
    taxRate: reservation.taxRate,
    deliveryCost: activePackage?.deliveryCost ?? reservation.deliveryCost,
    returnCost: activePackage?.returnCost ?? reservation.returnCost,
    /* eslint-disable @typescript-eslint/no-explicit-any -- Prisma include shape doesn't carry these optional columns */
    shippingMarginType: (reservation as any).shippingMarginType,
    shippingMargin: (reservation as any).shippingMargin,
    rentalCreditAmount: (reservation as any).rentalCreditAmount,
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })

  const { QuotePDF } = await import('@/components/documents/quote-pdf')
  const payment = await paymentLineForOrder(reservation.id)

  const quoteData = {
    entityType: 'RESERVATION' as const,
    number: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    contactLabel: 'Prepared For',
    contactName: reservation.client.name,
    contactCompany: reservation.client.companyName || undefined,
    contactEmail: reservation.client.email || undefined,
    contactPhone: reservation.client.phone || undefined,
    contactAddress: reservation.client.address || undefined,
    dateLabel: reservation.reservationType === 'SALE' ? 'Order Date' : reservation.reservationType === 'RENT_TO_OWN' ? 'RTO Period' : 'Rental Period',
    startDate: formatDate(reservation.startDate),
    endDate: reservation.reservationType !== 'SALE' ? formatDate(reservation.endDate) : undefined,
    rtoTermMonths: reservation.reservationType === 'RENT_TO_OWN' ? reservation.rtoTermMonths ?? undefined : undefined,
    rtoMonthlyPayment: reservation.reservationType === 'RENT_TO_OWN' && reservation.rtoMonthlyPayment ? Number(reservation.rtoMonthlyPayment) : undefined,
    rtoBuyoutPrice: reservation.reservationType === 'RENT_TO_OWN' && reservation.rtoBuyoutPrice ? Number(reservation.rtoBuyoutPrice) : undefined,
    projectName: reservation.projectName || undefined,
    status: 'APPROVED',
    projectCode: reservation.projectCode || undefined,
    quoteExpiresAt: reservation.quoteExpiresAt ? formatDate(reservation.quoteExpiresAt) : undefined,
    termLength: reservation.reservationType !== 'SALE'
      ? formatTermLength(reservation.startDate, reservation.endDate)
      : undefined,
    items: items.map((item, index) => {
      const { title, spec } = lineTitle(item)
      return {
        description: title,
        spec,
        quantity: item.quantity || 1,
        pricingType: pricingTypeLabels[(item.pricingType as PricingType) || 'DAILY'] || item.pricingType,
        rate: Number(item.rate) || 0,
        amount: financials.itemAmounts[index],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy line shape without a joined asset
        category: item.asset?.category?.name || (item as any).category || undefined,
        termNote: formatTermNote(item, reservation),
      }
    }),
    subtotal: financials.itemsSubtotal,
    discountAmount: financials.discountAmount || undefined,
    taxRate: financials.taxRate || undefined,
    taxAmount: financials.taxAmount,
    deliveryCost: financials.deliveryCost || undefined,
    returnCost: financials.returnCost || undefined,
    deliveryMethod: reservation.deliveryMethod ? (allDeliveryMethodLabels[reservation.deliveryMethod] || reservation.deliveryMethod) : undefined,
    deliveryAddress: reservation.deliveryAddress || undefined,
    deliveryDate: reservation.deliveryDate ? formatDate(reservation.deliveryDate) : undefined,
    deliveryNotes: reservation.deliveryNotes || undefined,
    deliveryTrackingProvider: reservation.deliveryTrackingProvider || undefined,
    deliveryTrackingNumber: reservation.deliveryTrackingNumber || undefined,
    returnMethod: reservation.returnMethod ? (allDeliveryMethodLabels[reservation.returnMethod] || reservation.returnMethod) : undefined,
    returnDate: reservation.returnDate ? formatDate(reservation.returnDate) : undefined,
    returnTrackingProvider: reservation.returnTrackingProvider || undefined,
    returnTrackingNumber: reservation.returnTrackingNumber || undefined,
    total: financials.total,
    notes: reservation.notes || undefined,
    paymentLine: payment ?? undefined,
  }

  const logoDataUri = await getServerLogoDataUri()

  const { pdf } = await import('@react-pdf/renderer')
  const doc = React.createElement(QuotePDF, {
    data: quoteData,
    logoDataUri,
    // Re-validated here (see module docstring) rather than trusting the caller.
    signatureDataUrl: sanitizeSignatureDataUrl(signatureDataUrl) || undefined,
    signerName,
    signedAt,
    approvalStamp: approvalStamp
      ? { method: approvalStamp.method, signerName: approvalStamp.signerName, signedAt }
      : undefined,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @react-pdf/renderer's DocumentProps typing
  const stream = await pdf(doc as any).toBuffer()
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Generate a signed quote PDF and save it as a PROPOSAL document when a
 * customer approves via the public quote page.
 *
 * If `signatureDataUrl` is empty, an `approvalStamp` may be passed instead to
 * render an audit-trail stamp ("Approved via quote link by NAME at TIME").
 * That mode is used by `regenerateApprovedQuoteStamps()` to rebuild artifacts
 * for reservations whose original signed PDF was lost.
 */
export async function generateSignedQuoteDocument(
  reservationId: string,
  signatureDataUrl: string,
  signerName: string,
  approvalStamp?: { method: string; signerName: string; signedAtIso: string },
): Promise<void> {
  try {
    const reservation = await loadSignedQuoteReservation(reservationId)
    if (!reservation) return

    const stampDate = approvalStamp ? new Date(approvalStamp.signedAtIso) : new Date()
    const signedAt = stampDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    let buffer: Buffer
    if (reservation.reservationType === 'FLOW') {
      // Flow: the Flow quote — the payment schedule, never line prices or costs —
      // with the frozen terms, the signature and the autopay authorization.
      const { renderFlowQuotePdf } = await import('@/lib/flow/quote-pdf')
      const rendered = await renderFlowQuotePdf(reservationId, {
        signatureDataUrl: sanitizeSignatureDataUrl(signatureDataUrl) || undefined,
        signerName,
        signedAt,
        approvalStamp: approvalStamp
          ? { method: approvalStamp.method, signerName: approvalStamp.signerName, signedAt }
          : undefined,
      })
      if (!rendered.ok) {
        console.error(`Signed Flow quote not generated for ${reservationId}: ${rendered.problem}`)
        return
      }
      buffer = rendered.buffer
    } else {
      buffer = await renderSignedQuote(reservation, signatureDataUrl, signerName, signedAt, approvalStamp)
    }

    // Save to disk
    const folder = path.join(DOCUMENTS_ROOT, 'reservations', reservationId)
    await fs.mkdir(folder, { recursive: true })

    const clientName = reservation.client.name.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim()
    const suffix = approvalStamp ? '-approved' : '-signed'
    const filename = `${clientName}-${reservation.reservationNumber}${suffix}.pdf`
    const filePath = path.join(folder, filename)
    await fs.writeFile(filePath, buffer)

    // Find a system user to attribute the document to
    const systemUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
    })

    const recordedSignedAt = approvalStamp ? new Date(approvalStamp.signedAtIso) : new Date()

    // Update the existing PROPOSAL row in place if there's already one for this
    // reservation (preserves ID, audit references, soft-delete state); otherwise
    // create a fresh record. Never delete-then-create.
    const existing = await prisma.document.findFirst({
      where: {
        entityType: 'RESERVATION',
        entityId: reservationId,
        documentType: 'PROPOSAL',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      await prisma.document.update({
        where: { id: existing.id },
        data: {
          filename,
          filePath: toRelativePath(filePath),
          fileSize: buffer.length,
          isSigned: true,
          signedBy: signerName,
          signedAt: recordedSignedAt,
          metadata: approvalStamp
            ? { ...((existing.metadata as Record<string, unknown>) || {}), approvalStamp }
            : (existing.metadata ?? undefined) as object | undefined,
        },
      })
    } else {
      await prisma.document.create({
        data: {
          documentType: 'PROPOSAL',
          filename,
          filePath: toRelativePath(filePath),
          fileSize: buffer.length,
          entityType: 'RESERVATION',
          entityId: reservationId,
          isSigned: true,
          signedBy: signerName,
          signedAt: recordedSignedAt,
          metadata: approvalStamp ? { approvalStamp } : undefined,
          createdById: systemUser?.id || 'system',
        },
      })
    }

    revalidatePath(`/dashboard/orders/${reservationId}`)
  } catch (error) {
    console.error('Auto-generate signed quote document failed:', error)
  }
}
