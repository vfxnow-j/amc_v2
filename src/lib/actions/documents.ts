'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { formatDate } from '@/lib/utils/format'
import fs from 'fs/promises'
import path from 'path'
import type { DocumentType, PricingType } from '@/lib/types'
import { pricingTypeLabels, allDeliveryMethodLabels } from '@/lib/types'
import { formatTermLength, formatTermNote } from '@/lib/pricing/periods'
import { computeReservationFinancials } from '@/lib/pricing/financials'

// In standalone mode process.cwd() resolves to .next/standalone/ which gets
// wiped on every rebuild. Use a stable project-root path for persistent storage.
function getProjectRoot(): string {
  const cwd = process.cwd()
  // Standalone server runs from <project>/.next/standalone
  if (cwd.endsWith(path.join('.next', 'standalone'))) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

const DOCUMENTS_ROOT = path.join(getProjectRoot(), 'documents')

/**
 * Resolve a document filePath (stored in DB) to an absolute filesystem path.
 * Handles both old absolute paths and new relative paths transparently.
 */
export async function resolveDocPath(filePath: string): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    return path.join(DOCUMENTS_ROOT, filePath)
  }
  // Absolute path — extract relative portion after /documents/
  const docsIdx = filePath.indexOf('/documents/')
  if (docsIdx !== -1) {
    const relativePart = filePath.substring(docsIdx + '/documents/'.length)
    return path.join(DOCUMENTS_ROOT, relativePart)
  }
  return filePath
}

/**
 * Convert an absolute filePath to a relative path for DB storage.
 */
function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(DOCUMENTS_ROOT)) {
    return absolutePath.substring(DOCUMENTS_ROOT.length + 1)
  }
  const docsIdx = absolutePath.indexOf('/documents/')
  if (docsIdx !== -1) {
    return absolutePath.substring(docsIdx + '/documents/'.length)
  }
  return absolutePath
}

function getEntityFolder(entityType: string): string {
  switch (entityType) {
    case 'RESERVATION': return 'reservations'
    case 'ASSET': return 'assets'
    default: return 'purchase-orders'
  }
}

/**
 * Move a file to documents/.trash/<docId>/<originalName>. Files are NEVER
 * unlinked — soft-deleted documents can be restored at any time. If the source
 * file is already missing this is a no-op.
 */
async function archiveFile(absoluteSourcePath: string, docId: string, filename: string): Promise<string | null> {
  try {
    await fs.access(absoluteSourcePath)
  } catch {
    return null
  }
  const trashDir = path.join(DOCUMENTS_ROOT, '.trash', docId)
  await fs.mkdir(trashDir, { recursive: true })
  const target = path.join(trashDir, filename)
  // Use rename when possible (atomic), fall back to copy+unlink across devices.
  try {
    await fs.rename(absoluteSourcePath, target)
  } catch {
    await fs.copyFile(absoluteSourcePath, target)
    try { await fs.unlink(absoluteSourcePath) } catch { /* leave a copy on source — never destructive */ }
  }
  return toRelativePath(target)
}

export async function saveDocument(data: {
  documentType: DocumentType
  entityType: string
  entityId: string
  pdfBase64: string
  filename: string
}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error || 'Unauthorized')
  }

  const folder = path.join(
    DOCUMENTS_ROOT,
    getEntityFolder(data.entityType),
    data.entityId
  )
  await fs.mkdir(folder, { recursive: true })

  const filePath = path.join(folder, data.filename)
  const buffer = Buffer.from(data.pdfBase64, 'base64')

  await fs.writeFile(filePath, buffer)

  // Map client-only QUOTE type to Prisma's PROPOSAL enum value
  const prismaDocType = data.documentType === 'QUOTE' ? 'PROPOSAL' : data.documentType

  const document = await prisma.document.create({
    data: {
      documentType: prismaDocType as any,
      filename: data.filename,
      filePath: toRelativePath(filePath),
      fileSize: buffer.length,
      entityType: data.entityType,
      entityId: data.entityId,
      createdById: authResult.userId!,
    },
  })

  // When saving a PO document, auto-attach to any already-received assets
  if (data.entityType === 'PURCHASE_ORDER') {
    await attachPODocumentsToAssets(data.entityId, authResult.userId!)
  }

  const entityPath = data.entityType === 'RESERVATION'
    ? `/dashboard/orders/${data.entityId}`
    : data.entityType === 'ASSET'
    ? `/dashboard/assets/${data.entityId}`
    : `/dashboard/purchase-orders/${data.entityId}`
  revalidatePath(entityPath)

  return serialize(document)
}

export async function signDocument(
  documentId: string,
  signedPdfBase64: string,
  signerName: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error || 'Unauthorized')
  }

  const existing = await prisma.document.findUnique({
    where: { id: documentId },
  })

  if (!existing) {
    throw new Error('Document not found')
  }

  // Write signed PDF variant
  const signedFilename = existing.filename.replace('.pdf', '-signed.pdf')
  const resolvedFolder = path.dirname(await resolveDocPath(existing.filePath))
  const signedAbsPath = path.join(resolvedFolder, signedFilename)
  const buffer = Buffer.from(signedPdfBase64, 'base64')

  await fs.writeFile(signedAbsPath, buffer)

  const document = await prisma.document.update({
    where: { id: documentId },
    data: {
      isSigned: true,
      signedBy: signerName,
      signedAt: new Date(),
      filePath: toRelativePath(signedAbsPath),
      filename: signedFilename,
      fileSize: buffer.length,
    },
  })

  const entityPath = existing.entityType === 'RESERVATION'
    ? `/dashboard/orders/${existing.entityId}`
    : existing.entityType === 'ASSET'
    ? `/dashboard/assets/${existing.entityId}`
    : `/dashboard/purchase-orders/${existing.entityId}`
  revalidatePath(entityPath)

  return serialize(document)
}

/**
 * Server-side: read the company logo as a data URI for PDF rendering.
 */
export async function getServerLogoDataUri(): Promise<string> {
  try {
    const logoPath = path.join(getProjectRoot(), 'public', 'logo-black.png')
    const buffer = await fs.readFile(logoPath)
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return ''
  }
}

/**
 * Render a purchase order to a PDF Buffer server-side (no disk write, no
 * Document row). Shared by the on-disk generator and the email notification so
 * the attached PDF always matches the saved document. Returns null if the PO
 * can't be found.
 */
export async function renderPurchaseOrderPdf(
  poId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      vendor: true,
      shipToLocation: true,
      items: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!po) return null

  const { PurchaseOrderPDF } = await import(
    '@/components/documents/purchase-order-pdf'
  )

  const poData = {
    number: po.poNumber,
    vendorName: po.vendor.name,
    vendorEmail: po.vendor.contactEmail || undefined,
    vendorPhone: po.vendor.contactPhone || undefined,
    vendorAddress: po.vendor.address || undefined,
    shipToName: po.shipToLocation?.name || undefined,
    shipToAddress: po.shipToLocation?.address || undefined,
    orderDate: formatDate(po.orderDate),
    expectedDate: po.expectedDate ? formatDate(po.expectedDate) : undefined,
    status: po.status,
    creditTerms: po.purchaseMethod === 'VENDOR_CREDIT' ? (po.creditTerms || undefined) : undefined,
    items: po.items.map((item) => ({
      description: item.description || 'Unknown',
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
    })),
    subtotal: Number(po.subtotal),
    discountAmount: Number(po.discountAmount) || 0,
    freightAmount: Number(po.freightAmount) || 0,
    taxAmount: Number(po.taxAmount),
    taxExempt: po.taxExempt,
    total: Number(po.total),
    notes: po.notes || undefined,
  }

  const logoDataUri = await getServerLogoDataUri()

  // Render PDF server-side using @react-pdf/renderer
  const { pdf } = await import('@react-pdf/renderer')
  const doc = React.createElement(PurchaseOrderPDF, {
    data: poData,
    logoDataUri,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await pdf(doc as any).toBuffer()
  // Collect the readable stream into a Buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)

  const vendorName = po.vendor.name.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim()
  const filename = `${vendorName}-${po.poNumber}.pdf`
  return { buffer, filename }
}

/**
 * Auto-generate a PO PDF server-side and save it as a document.
 * Idempotent — skips if a PO document already exists for this purchase order,
 * unless `force` is set, in which case it rewrites the file and updates the
 * existing Document row in place (preserving its ID).
 */
export async function generateAndSavePODocument(
  poId: string,
  createdById: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  try {
    // Check if a PO document already exists — avoid duplicates
    const existing = await prisma.document.findFirst({
      where: {
        entityType: 'PURCHASE_ORDER',
        entityId: poId,
        documentType: 'PURCHASE_ORDER',
      },
    })
    if (existing && !opts.force) return

    const rendered = await renderPurchaseOrderPdf(poId)
    if (!rendered) return
    const { buffer, filename } = rendered

    // Save to disk
    const folder = path.join(DOCUMENTS_ROOT, 'purchase-orders', poId)
    await fs.mkdir(folder, { recursive: true })

    const filePath = path.join(folder, filename)
    await fs.writeFile(filePath, buffer)

    // Create or update the document record without losing identity.
    if (existing) {
      await prisma.document.update({
        where: { id: existing.id },
        data: {
          filename,
          filePath: toRelativePath(filePath),
          fileSize: buffer.length,
        },
      })
    } else {
      await prisma.document.create({
        data: {
          documentType: 'PURCHASE_ORDER',
          filename,
          filePath: toRelativePath(filePath),
          fileSize: buffer.length,
          entityType: 'PURCHASE_ORDER',
          entityId: poId,
          createdById,
        },
      })
    }

    revalidatePath(`/dashboard/purchase-orders/${poId}`)
  } catch (error) {
    // Non-critical — log but don't break the calling operation
    console.error('Auto-generate PO document failed:', error)
  }
}

/**
 * Server-side: generate a signed quote PDF and save it as a PROPOSAL document
 * when a customer approves via the public quote page.
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
    const reservation = await prisma.reservation.findUnique({
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
    if (!reservation) return

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
      shippingMarginType: (reservation as any).shippingMarginType,
      shippingMargin: (reservation as any).shippingMargin,
      rentalCreditAmount: (reservation as any).rentalCreditAmount,
    })

    const { QuotePDF } = await import('@/components/documents/quote-pdf')

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
      items: items.map((item, index) => ({
        description: item.asset?.name || item.description || 'Ad-hoc item',
        quantity: item.quantity || 1,
        pricingType: pricingTypeLabels[(item.pricingType as PricingType) || 'DAILY'] || item.pricingType,
        rate: Number(item.rate) || 0,
        amount: financials.itemAmounts[index],
        category: item.asset?.category?.name || (item as any).category || undefined,
        termNote: formatTermNote(item, reservation),
      })),
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
    }

    const logoDataUri = await getServerLogoDataUri()
    const stampDate = approvalStamp ? new Date(approvalStamp.signedAtIso) : new Date()
    const signedAt = stampDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const { pdf } = await import('@react-pdf/renderer')
    const doc = React.createElement(QuotePDF, {
      data: quoteData,
      logoDataUri,
      signatureDataUrl: signatureDataUrl || undefined,
      signerName,
      signedAt,
      approvalStamp: approvalStamp
        ? { method: approvalStamp.method, signerName: approvalStamp.signerName, signedAt }
        : undefined,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await pdf(doc as any).toBuffer()
    const chunks: Uint8Array[] = []
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)

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

/**
 * Scan every reservation whose status_history shows a customer approval via the
 * public quote link, and ensure each has a saved PROPOSAL document on disk. If
 * the original signed PDF is missing, regenerate it with an audit-trail stamp
 * derived from status_history (signer name + timestamp). Never deletes
 * anything, never overwrites a PDF that's already on disk.
 *
 * Returns a summary of what was rebuilt vs already healthy.
 */
export async function regenerateApprovedQuoteStamps() {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  // Pull every "Approved via quote link by ..." status_history entry. The
  // notes field is the only place the signer name is preserved if the
  // Document row was lost.
  const approvals = await prisma.statusHistory.findMany({
    where: {
      entityType: 'RESERVATION',
      toStatus: 'APPROVED',
      notes: { contains: 'Approved via quote link by' },
    },
    orderBy: { createdAt: 'asc' },
  })

  const result = {
    scanned: approvals.length,
    alreadyOk: 0,
    regenerated: 0,
    failed: [] as { reservationId: string; reason: string }[],
  }

  for (const ev of approvals) {
    const reservationId = ev.entityId
    if (!reservationId) continue

    // If a PROPOSAL document already exists on disk, leave it alone.
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
      try {
        await fs.access(await resolveDocPath(existing.filePath))
        result.alreadyOk += 1
        continue
      } catch {
        // File is missing — regenerate.
      }
    }

    const match = ev.notes?.match(/Approved via quote link by\s+(.+?)\s*$/)
    const signerName = match?.[1]?.trim() || 'Customer'

    try {
      await generateSignedQuoteDocument(
        reservationId,
        '',
        signerName,
        {
          method: 'Approved via secure quote link',
          signerName,
          signedAtIso: ev.createdAt.toISOString(),
        },
      )
      result.regenerated += 1
    } catch (err) {
      result.failed.push({
        reservationId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  revalidatePath('/dashboard/settings/documents')
  return result
}

/**
 * Auto-attach all PO documents to assets that have been received from that PO.
 * Idempotent — deduplicates by entityType + entityId + filename.
 */
export async function attachPODocumentsToAssets(
  poId: string,
  createdById: string
): Promise<void> {
  try {
    const poDocuments = await prisma.document.findMany({
      where: { entityType: 'PURCHASE_ORDER', entityId: poId },
    })

    if (poDocuments.length === 0) return

    // Find all assets that have received items from this PO
    const receivedItems = await prisma.pOItem.findMany({
      where: {
        purchaseOrderId: poId,
        assetId: { not: null },
        receivedQuantity: { gt: 0 },
      },
      select: { assetId: true },
    })

    const assetIds = [...new Set(receivedItems.map((i) => i.assetId!).filter(Boolean))]
    if (assetIds.length === 0) return

    for (const assetId of assetIds) {
      for (const doc of poDocuments) {
        const existing = await prisma.document.findFirst({
          where: {
            entityType: 'ASSET',
            entityId: assetId,
            filename: doc.filename,
          },
        })
        if (!existing) {
          await prisma.document.create({
            data: {
              documentType: doc.documentType,
              filename: doc.filename,
              filePath: doc.filePath,
              fileSize: doc.fileSize,
              entityType: 'ASSET',
              entityId: assetId,
              isSigned: doc.isSigned,
              signedBy: doc.signedBy,
              signedAt: doc.signedAt,
              createdById,
            },
          })
        }
      }
      revalidatePath(`/dashboard/assets/${assetId}`)
    }
  } catch {
    // Non-critical — don't break the calling operation
  }
}

export async function getDocuments(entityType: string, entityId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) {
    throw new Error(authResult.error || 'Unauthorized')
  }

  // For POs, auto-generate the document if it doesn't exist yet
  if (entityType === 'PURCHASE_ORDER') {
    try {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: entityId },
        select: { status: true },
      })
      if (po && po.status !== 'DRAFT' && po.status !== 'CANCELLED') {
        await generateAndSavePODocument(entityId, authResult.userId!)
      }
    } catch {
      // Non-critical
    }
  }

  // For assets, auto-generate any missing PO documents, then link them
  if (entityType === 'ASSET') {
    try {
      const [asset, poItems] = await Promise.all([
        prisma.asset.findUnique({
          where: { id: entityId },
          select: { purchaseOrderId: true },
        }),
        prisma.pOItem.findMany({
          where: { assetId: entityId, receivedQuantity: { gt: 0 } },
          select: { purchaseOrderId: true },
        }),
      ])
      const poIds = new Set<string>()
      if (asset?.purchaseOrderId) poIds.add(asset.purchaseOrderId)
      for (const item of poItems) poIds.add(item.purchaseOrderId)

      for (const poId of poIds) {
        await generateAndSavePODocument(poId, authResult.userId!)
        await attachPODocumentsToAssets(poId, authResult.userId!)
      }
    } catch {
      // Non-critical — don't block document loading
    }
  }

  const documents = await prisma.document.findMany({
    where: { entityType, entityId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(documents)
}

export async function getAllDocuments(filters: {
  documentType?: DocumentType
  search?: string
  trash?: boolean
} = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const { documentType, search, trash = false } = filters
  const where: Record<string, unknown> = {
    deletedAt: trash ? { not: null } : null,
  }

  if (documentType) where.documentType = documentType
  if (search) {
    where.filename = { contains: search, mode: 'insensitive' }
  }

  const documents = await prisma.document.findMany({
    where,
    orderBy: trash ? { deletedAt: 'desc' } : { createdAt: 'desc' },
  })

  // Enrich with entity labels (reservation number, PO number, client name) and
  // verify file presence on disk so the UI can flag broken records.
  const reservationIds = new Set<string>()
  const poIds = new Set<string>()
  const clientIds = new Set<string>()
  const assetIds = new Set<string>()
  for (const doc of documents) {
    if (doc.entityType === 'RESERVATION') reservationIds.add(doc.entityId)
    else if (doc.entityType === 'PURCHASE_ORDER') poIds.add(doc.entityId)
    else if (doc.entityType === 'CLIENT') clientIds.add(doc.entityId)
    else if (doc.entityType === 'ASSET') assetIds.add(doc.entityId)
  }

  const [reservations, pos, clients, assets] = await Promise.all([
    reservationIds.size
      ? prisma.reservation.findMany({
          where: { id: { in: [...reservationIds] } },
          select: {
            id: true,
            reservationNumber: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    poIds.size
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: [...poIds] } },
          select: {
            id: true,
            poNumber: true,
            vendor: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    clientIds.size
      ? prisma.client.findMany({
          where: { id: { in: [...clientIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    assetIds.size
      ? prisma.asset.findMany({
          where: { id: { in: [...assetIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])

  const resMap = new Map(reservations.map((r) => [r.id, r]))
  const poMap = new Map(pos.map((p) => [p.id, p]))
  const clientMap = new Map(clients.map((c) => [c.id, c]))
  const assetMap = new Map(assets.map((a) => [a.id, a]))

  // Verify file existence for every record. Fast on local volumes, and the
  // settings page already paginates the results visually.
  const fileExistsList = await Promise.all(
    documents.map(async (doc) => {
      try {
        await fs.access(await resolveDocPath(doc.filePath))
        return true
      } catch {
        return false
      }
    }),
  )

  const enriched = documents.map((doc, idx) => {
    let entityLabel = ''
    let entitySubLabel = ''
    if (doc.entityType === 'RESERVATION') {
      const r = resMap.get(doc.entityId)
      entityLabel = r?.reservationNumber || doc.entityId
      entitySubLabel = r?.client?.name || ''
    } else if (doc.entityType === 'PURCHASE_ORDER') {
      const p = poMap.get(doc.entityId)
      entityLabel = p?.poNumber || doc.entityId
      entitySubLabel = p?.vendor?.name || ''
    } else if (doc.entityType === 'CLIENT') {
      const c = clientMap.get(doc.entityId)
      entityLabel = c?.name || doc.entityId
    } else if (doc.entityType === 'ASSET') {
      const a = assetMap.get(doc.entityId)
      entityLabel = a?.name || doc.entityId
    }
    return {
      ...doc,
      entityLabel,
      entitySubLabel,
      fileExists: fileExistsList[idx],
    }
  })

  return serialize(enriched)
}

/**
 * Sweep the Document table for rows whose file is missing on disk and try to
 * regenerate the underlying PDF for types whose source data is still in the
 * database (currently: PURCHASE_ORDER documents linked to a PURCHASE_ORDER).
 *
 * This function is intentionally non-destructive — it never deletes Document
 * rows. Records that can't be regenerated stay in place as audit history
 * (signer name, timestamp, original filename) and can be removed individually
 * from the documents settings page if the user explicitly chooses to.
 */
export async function repairDocuments() {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const documents = await prisma.document.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const missing: typeof documents = []
  for (const doc of documents) {
    try {
      await fs.access(await resolveDocPath(doc.filePath))
    } catch {
      missing.push(doc)
    }
  }

  let regenerated = 0
  const unrecoverable: { id: string; filename: string; type: string }[] = []

  for (const doc of missing) {
    if (doc.documentType === 'PURCHASE_ORDER' && doc.entityType === 'PURCHASE_ORDER') {
      try {
        await generateAndSavePODocument(doc.entityId, authResult.userId!, { force: true })
        // Verify the file landed on disk before counting it as regenerated
        const fresh = await prisma.document.findUnique({ where: { id: doc.id } })
        if (fresh) {
          try {
            await fs.access(await resolveDocPath(fresh.filePath))
            regenerated += 1
            continue
          } catch {
            // fall through to unrecoverable
          }
        }
      } catch {
        // fall through
      }
    }
    unrecoverable.push({
      id: doc.id,
      filename: doc.filename,
      type: doc.documentType,
    })
  }

  revalidatePath('/dashboard/settings/documents')

  return {
    scanned: documents.length,
    missing: missing.length,
    regenerated,
    unrecoverable,
  }
}

/**
 * Snapshot a Document row into the audit log before any destructive change so
 * we always have a forensic trail of who/what/when. Never throws — audit
 * logging must not block the caller's operation.
 */
async function auditDocumentDeletion(
  doc: { id: string; documentType: string; filename: string; filePath: string; fileSize: number; entityType: string; entityId: string; isSigned: boolean; signedBy: string | null; signedAt: Date | null; createdById: string; createdAt: Date },
  userId: string | null,
  reason: string,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE',
        entityType: 'Document',
        entityId: doc.id,
        oldValues: {
          documentType: doc.documentType,
          filename: doc.filename,
          filePath: doc.filePath,
          fileSize: doc.fileSize,
          entityType: doc.entityType,
          entityId: doc.entityId,
          isSigned: doc.isSigned,
          signedBy: doc.signedBy,
          signedAt: doc.signedAt?.toISOString?.() || null,
          createdById: doc.createdById,
          createdAt: doc.createdAt?.toISOString?.() || null,
          reason,
        },
      },
    })
  } catch (err) {
    console.error('Failed to write document deletion audit log', err)
  }
}

/**
 * Soft-delete a document. The DB row is retained with `deletedAt` set, and the
 * underlying file is moved into documents/.trash/<id>/ — never unlinked. The
 * record stops appearing in normal listings but remains fully recoverable via
 * `restoreDocument`.
 */
export async function deleteDocument(id: string, reason?: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error || 'Unauthorized')
  }

  const document = await prisma.document.findUnique({
    where: { id },
  })

  if (!document) {
    throw new Error('Document not found')
  }
  if (document.deletedAt) {
    return serialize(document) // already in trash, nothing to do
  }

  // Always log who soft-deleted what and why.
  await auditDocumentDeletion(
    document,
    authResult.userId ?? null,
    reason || 'Soft delete from Settings → Documents',
  )

  const absolutePath = await resolveDocPath(document.filePath)
  const archivedRelative = await archiveFile(absolutePath, document.id, document.filename)

  const updated = await prisma.document.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedById: authResult.userId,
      deleteReason: reason || null,
      // If the file was archived, point filePath at its new home so a future
      // restore knows where to find it. If the file was already missing, keep
      // the original path for forensic value.
      ...(archivedRelative ? { filePath: archivedRelative } : {}),
    },
  })

  const entityPath = document.entityType === 'RESERVATION'
    ? `/dashboard/orders/${document.entityId}`
    : document.entityType === 'ASSET'
    ? `/dashboard/assets/${document.entityId}`
    : `/dashboard/purchase-orders/${document.entityId}`
  revalidatePath(entityPath)
  revalidatePath('/dashboard/settings/documents')

  return serialize(updated)
}

/**
 * Restore a soft-deleted document. Moves the file back from documents/.trash/
 * to its original entity folder and clears the deletedAt fields.
 */
export async function restoreDocument(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) {
    throw new Error(authResult.error || 'Unauthorized')
  }

  const document = await prisma.document.findUnique({ where: { id } })
  if (!document) throw new Error('Document not found')
  if (!document.deletedAt) return serialize(document)

  // Try to move the file back to its entity folder if it's currently archived.
  let restoredRelative = document.filePath
  const currentAbs = await resolveDocPath(document.filePath)
  const isInTrash = document.filePath.startsWith('.trash/') ||
    document.filePath.includes('/.trash/')
  if (isInTrash) {
    try {
      await fs.access(currentAbs)
      const restoreFolder = path.join(
        DOCUMENTS_ROOT,
        getEntityFolder(document.entityType),
        document.entityId,
      )
      await fs.mkdir(restoreFolder, { recursive: true })
      const target = path.join(restoreFolder, document.filename)
      try {
        await fs.rename(currentAbs, target)
      } catch {
        await fs.copyFile(currentAbs, target)
      }
      restoredRelative = toRelativePath(target)
    } catch {
      // File no longer in trash — leave filePath as-is so the row still
      // surfaces with a "missing" indicator rather than silently failing.
    }
  }

  const restored = await prisma.document.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedById: null,
      deleteReason: null,
      filePath: restoredRelative,
    },
  })

  try {
    await prisma.auditLog.create({
      data: {
        userId: authResult.userId,
        action: 'RESTORE',
        entityType: 'Document',
        entityId: id,
        newValues: { filename: document.filename, restoredAt: new Date().toISOString() },
      },
    })
  } catch { /* non-critical */ }

  const entityPath = document.entityType === 'RESERVATION'
    ? `/dashboard/orders/${document.entityId}`
    : document.entityType === 'ASSET'
    ? `/dashboard/assets/${document.entityId}`
    : `/dashboard/purchase-orders/${document.entityId}`
  revalidatePath(entityPath)
  revalidatePath('/dashboard/settings/documents')

  return serialize(restored)
}
