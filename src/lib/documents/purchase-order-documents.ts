import { revalidatePath } from 'next/cache'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { DOCUMENTS_ROOT, toRelativePath } from '@/lib/documents/paths'
import { renderPurchaseOrderPdf } from '@/lib/actions/documents'

/**
 * Internal-only PO document helpers.
 *
 * These used to live in src/lib/actions/documents.ts, a 'use server' module,
 * which made every export here directly callable from the browser as a
 * server action with no auth check of its own — `generateAndSavePODocument`
 * would write a PDF + Document row for any `poId`, and
 * `attachPODocumentsToAssets` would create Document rows for any `assetId`
 * from any `poId`'s existing documents. Neither took a request-scoped
 * session, only a caller-supplied `createdById` string.
 *
 * Every caller of both functions is itself an authenticated server action or
 * route handler (see src/lib/actions/purchase-orders.ts and
 * src/lib/actions/documents.ts's getDocuments/repairDocuments), so moving the
 * implementation into a plain module — no 'use server' — removes the public
 * RPC surface without changing behavior for any real caller.
 */

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
