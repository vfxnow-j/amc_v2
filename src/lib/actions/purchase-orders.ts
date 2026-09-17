'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin, requireAuth, requireEditor } from '@/lib/auth-utils'
import { isAdmin } from '@/lib/auth'
import { mayRevisePO, mayWorkOnPO } from '@/lib/procurement/access'
import { actorFor, noteMoneyChange, releaseGate, supersedePending } from '@/lib/approvals/core'
import { serialize } from '@/lib/utils'
import { generateBarcode } from '@/lib/utils/barcode'
import { syncUnitsToPurchaseOrderLease } from '@/lib/funding/lease-sync'
import {
  generateAndSavePODocument,
  attachPODocumentsToAssets,
} from '@/lib/actions/documents'
import { notifyPurchaseOrderSubmitted } from '@/lib/notifications/outbound'
import { renderPurchaseOrderPdf } from '@/lib/actions/documents'
import { poPurchaseMethodLabels, poOrderTypeLabels, type POOrderType } from '@/lib/types'
import type { POStatus } from '@/lib/types'

export type POItemFormData = {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  assetId?: string | null
  isInventoried?: boolean
  isResale?: boolean
}

export type POFeeFormData = {
  description: string
  amount: number
}

export type POFormData = {
  vendorId: string
  shipToLocationId?: string | null
  orderDate: Date
  expectedDate?: Date | null
  discountType?: string | null
  discountValue?: number
  freightAmount?: number
  taxAmount?: number
  taxExempt?: boolean
  // How the equipment is purchased — an OwnershipType value (CASH/CREDIT/LOAN/EXCHANGE).
  // Carries over to received AssetUnits' ownershipType.
  purchaseMethod?: string | null
  // What the PO is for — POOrderType (HARDWARE_RENTAL / HARDWARE_RESALE).
  orderType?: string | null
  // Net payment terms when purchaseMethod is VENDOR_CREDIT (e.g. "Net 30").
  creditTerms?: string | null
  notes?: string
  items: POItemFormData[]
  fees?: POFeeFormData[]
  // Create only: the funding request this PO is raised against. Connected in
  // the same write as the PO, so a PO raised from a request can never exist
  // without the link back to it.
  fundingRequestId?: string | null
}

export type POFilters = {
  search?: string
  status?: POStatus
  vendorId?: string
}

export type ReceiveUnitData = {
  barcode?: string
  serialNumber?: string
  locationId: string
  condition?: string
  purchasePrice?: number
  notes?: string
}

export type ReceiveItemData = {
  poItemId: string
  receivedQuantity: number
  units?: ReceiveUnitData[]
  // Serial numbers for resale items (serials-only — no AssetUnits created)
  serials?: string[]
}

export type NewAssetData = {
  poItemId: string
  name: string
  categoryId: string
  manufacturer?: string
  model?: string
}

export type ReceivePOData = {
  items: ReceiveItemData[]
  newAssets?: NewAssetData[]
  receivingDate?: Date
}

function calculatePOTotals(params: {
  subtotal: number
  discountType?: string | null
  discountValue?: number
  freightAmount?: number
  feesTotal?: number
  taxAmount?: number
}) {
  let discountAmount = 0
  if (params.discountType === 'PERCENTAGE' && params.discountValue && params.discountValue > 0) {
    discountAmount = params.subtotal * (params.discountValue / 100)
  } else if (params.discountType === 'FIXED' && params.discountValue && params.discountValue > 0) {
    discountAmount = Math.min(params.discountValue, params.subtotal)
  }
  const freight = params.freightAmount || 0
  const fees = params.feesTotal || 0
  const tax = params.taxAmount || 0
  const total = params.subtotal - discountAmount + freight + fees + tax
  return { discountAmount, total }
}

// Generate unique PO number
async function generatePONumber(): Promise<string> {
  const year = new Date().getFullYear()
  const lastPO = await prisma.purchaseOrder.findFirst({
    where: {
      poNumber: {
        startsWith: `PO-${year}-`,
      },
    },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  })

  let sequence = 1
  if (lastPO?.poNumber) {
    const match = lastPO.poNumber.match(/PO-\d{4}-(\d+)/)
    if (match) {
      sequence = parseInt(match[1], 10) + 1
    }
  }

  return `PO-${year}-${sequence.toString().padStart(5, '0')}`
}

export async function getPurchaseOrders(filters: POFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, vendorId } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { poNumber: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (status) {
    where.status = status
  }

  if (vendorId) {
    where.vendorId = vendorId
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where,
    include: {
      vendor: true,
      items: {
        include: {
          asset: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(purchaseOrders)
}

export async function getPurchaseOrder(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      shipToLocation: true,
      items: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
        },
      },
      fees: true,
      lease: {
        select: { id: true, leaseNumber: true, leaseName: true, lender: true, status: true },
      },
      fundingRequests: {
        select: {
          id: true,
          requestNumber: true,
          status: true,
          amountRequested: true,
          requestedBy: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      // Units received against this PO — they move with its financing.
      _count: { select: { assetUnits: true } },
    },
  })

  return serialize(purchaseOrder)
}

export async function createPurchaseOrder(data: POFormData) {
  // Phase 6: STAFF raise POs. Raising commits nothing — a draft goes nowhere
  // until it is submitted, and submitting is where approval is asked for.
  const authResult = await requireEditor()
  if (!authResult.authorized) return { success: false as const, error: authResult.error || 'Edit access required' }

  const poNumber = await generatePONumber()

  // Calculate totals
  let subtotal = 0
  const itemsWithAmounts = data.items.map((item) => {
    const amount = item.quantity * item.unitPrice
    subtotal += amount
    return {
      ...item,
      amount,
    }
  })

  const feesTotal = (data.fees || []).reduce((sum, fee) => sum + (fee.amount || 0), 0)

  const effectiveTax = data.taxExempt ? 0 : (data.taxAmount || 0)
  const { discountAmount, total } = calculatePOTotals({
    subtotal,
    discountType: data.discountType,
    discountValue: data.discountValue,
    freightAmount: data.freightAmount,
    feesTotal,
    taxAmount: effectiveTax,
  })

  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      vendorId: data.vendorId,
      shipToLocationId: data.shipToLocationId || null,
      orderDate: data.orderDate,
      expectedDate: data.expectedDate || null,
      subtotal,
      discountType: data.discountType as any || null,
      discountValue: data.discountValue || 0,
      discountAmount,
      freightAmount: data.freightAmount || 0,
      feesTotal,
      taxAmount: effectiveTax,
      taxExempt: data.taxExempt ?? false,
      total,
      purchaseMethod: (data.purchaseMethod as any) || null,
      creditTerms: data.purchaseMethod === 'VENDOR_CREDIT' ? (data.creditTerms || null) : null,
      orderType: (data.orderType as any) || null,
      notes: data.notes || null,
      status: 'DRAFT',
      // v2-only: whose draft this is, so STAFF can work on their own and no one
      // else's. See lib/procurement/access.ts.
      raisedById: authResult.userId,
      items: {
        create: itemsWithAmounts.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          assetId: item.assetId || null,
          isInventoried: item.isInventoried ?? true,
          isResale: item.isResale ?? false,
        })),
      },
      fees: {
        create: (data.fees || []).map((fee) => ({
          description: fee.description,
          amount: fee.amount,
        })),
      },
      ...(data.fundingRequestId
        ? { fundingRequests: { connect: { id: data.fundingRequestId } } }
        : {}),
    },
    include: {
      vendor: true,
      items: true,
      fees: true,
    },
  })

  revalidatePath('/dashboard/purchase-orders')

  return { success: true as const, data: serialize(purchaseOrder) }
}

export async function updatePurchaseOrder(id: string, data: POFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { success: false as const, error: authResult.error || 'Edit access required' }

  const before = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true, raisedById: true, total: true },
  })
  if (!before) return { success: false as const, error: 'Purchase order not found' }
  if (!mayWorkOnPO({ id: authResult.userId, role: authResult.role }, before)) {
    return {
      success: false as const,
      error: isAdmin(authResult.role)
        ? 'A canceled purchase order is not edited.'
        : 'Only your own draft purchase orders can be edited. An administrator can change this one.',
    }
  }

  const purchaseOrder = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    })

    if (!existing) {
      throw new Error('Purchase order not found')
    }

    // Edits allowed at any status. Destructive changes (removing a received
    // line, lowering qty below receivedQuantity) are blocked below to preserve
    // receive history + linked AssetUnits.

    // Calculate totals
    let subtotal = 0
    const itemsWithAmounts = data.items.map((item) => {
      const amount = item.quantity * item.unitPrice
      subtotal += amount
      return {
        ...item,
        amount,
      }
    })

    const feesTotal = (data.fees || []).reduce((sum, fee) => sum + (fee.amount || 0), 0)

    const effectiveTax = data.taxExempt ? 0 : (data.taxAmount || 0)
    const { discountAmount, total } = calculatePOTotals({
      subtotal,
      discountType: data.discountType,
      discountValue: data.discountValue,
      freightAmount: data.freightAmount,
      feesTotal,
      taxAmount: effectiveTax,
    })

    // Non-destructive item reconciliation:
    // - Submitted items with a matching id → update in place (preserves receivedQuantity)
    // - Submitted items without an id (or stale id) → create new
    // - Existing items omitted from submission → delete if untouched, reject if received
    const existingById = new Map(existing.items.map((it) => [it.id, it]))
    const submittedIds = new Set(
      itemsWithAmounts.map((it) => it.id).filter((x): x is string => !!x)
    )

    for (const existingItem of existing.items) {
      if (submittedIds.has(existingItem.id)) continue
      if (existingItem.receivedQuantity > 0) {
        throw new Error(
          `Cannot remove "${existingItem.description}" — ${existingItem.receivedQuantity} already received. Receipt history must be preserved.`
        )
      }
      await tx.pOItem.delete({ where: { id: existingItem.id } })
    }

    for (const item of itemsWithAmounts) {
      const match = item.id ? existingById.get(item.id) : undefined
      if (match) {
        if (item.quantity < match.receivedQuantity) {
          throw new Error(
            `Cannot set quantity of "${match.description}" below ${match.receivedQuantity} (already received).`
          )
        }
        await tx.pOItem.update({
          where: { id: match.id },
          data: {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            assetId: item.assetId || null,
            isInventoried: item.isInventoried ?? true,
            isResale: item.isResale ?? false,
          },
        })
      } else {
        await tx.pOItem.create({
          data: {
            purchaseOrderId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            assetId: item.assetId || null,
            isInventoried: item.isInventoried ?? true,
            isResale: item.isResale ?? false,
          },
        })
      }
    }

    // Delete existing fees and recreate
    await tx.pOFee.deleteMany({
      where: { purchaseOrderId: id },
    })

    if (data.fees && data.fees.length > 0) {
      await tx.pOFee.createMany({
        data: data.fees.map((fee) => ({
          purchaseOrderId: id,
          description: fee.description,
          amount: fee.amount,
        })),
      })
    }

    // Recompute receipt status if the PO is in a post-submit lifecycle.
    // Adding an unreceived line to a RECEIVED PO flips it back to PARTIAL;
    // raising quantity above receivedQuantity does the same. Likewise, if
    // every item is now fully received we flip PARTIAL → RECEIVED.
    let nextStatus: POStatus = existing.status as POStatus
    let nextReceivedDate: Date | null = existing.receivedDate
    if (existing.status === 'PARTIAL' || existing.status === 'RECEIVED') {
      const freshItems = await tx.pOItem.findMany({ where: { purchaseOrderId: id } })
      const anyReceived = freshItems.some((it) => it.receivedQuantity > 0)
      const allReceived = freshItems.length > 0 && freshItems.every((it) => it.receivedQuantity >= it.quantity)
      if (anyReceived && allReceived) {
        nextStatus = 'RECEIVED'
        nextReceivedDate = existing.receivedDate || new Date()
      } else if (anyReceived) {
        nextStatus = 'PARTIAL'
        nextReceivedDate = null
      }
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        vendorId: data.vendorId,
        shipToLocationId: data.shipToLocationId || null,
        orderDate: data.orderDate,
        expectedDate: data.expectedDate || null,
        subtotal,
        discountType: data.discountType as any || null,
        discountValue: data.discountValue || 0,
        discountAmount,
        freightAmount: data.freightAmount || 0,
        feesTotal,
        taxAmount: effectiveTax,
        taxExempt: data.taxExempt ?? false,
        total,
        purchaseMethod: (data.purchaseMethod as any) || null,
        creditTerms: data.purchaseMethod === 'VENDOR_CREDIT' ? (data.creditTerms || null) : null,
        orderType: (data.orderType as any) || null,
        notes: data.notes || null,
        status: nextStatus,
        receivedDate: nextReceivedDate,
      },
      include: {
        vendor: true,
        items: true,
        fees: true,
      },
    })

    return updated
  })

  // Phase 6: an edit that moves the total under an approval — or under a PO
  // already sent before approvals existed — goes back for approval, unless the
  // editor approves POs themselves. The gate at receiving enforces it either way.
  const approval = await noteMoneyChange({
    type: 'PURCHASE_ORDER',
    id,
    before: Number(before.total),
    actor: await actorFor(authResult.userId, authResult.role),
  })

  revalidatePath('/dashboard/purchase-orders')
  revalidatePath(`/dashboard/purchase-orders/${id}`)
  revalidatePath('/dashboard/approvals')

  return { success: true as const, data: serialize(purchaseOrder), approval }
}

export async function submitPurchaseOrder(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { vendor: true, items: true },
  })

  if (!existing) {
    throw new Error('Purchase order not found')
  }

  if (!mayWorkOnPO({ id: authResult.userId, role: authResult.role }, existing)) {
    throw new Error('Only your own draft purchase orders can be submitted.')
  }

  if (existing.status !== 'DRAFT') {
    throw new Error('Can only submit draft purchase orders')
  }

  // Phase 6: sending to the vendor is the release. Refuses unless the PO is
  // cleared at its current total, or the submitter approves POs. It does not
  // raise a request — a direct call cannot ask in someone's name; submitPO on
  // the record asks first and then calls this.
  const gate = await releaseGate({
    type: 'PURCHASE_ORDER',
    id,
    actor: await actorFor(authResult.userId, authResult.role),
    act: 'submitting it to the vendor',
    raise: false,
    always: true,
    note: 'Submit to the vendor',
  })
  if (gate.status === 'held') throw new Error(gate.message)

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'SUBMITTED' },
  })

  // Notify configured 'purchaseOrders' recipients (e.g. accounting@). Fire and
  // forget — a notification failure must not block the submission.
  try {
    const session = await auth()
    const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    const fmtDate = (d: Date | null | undefined) =>
      d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null
    const method = existing.purchaseMethod
      ? poPurchaseMethodLabels[existing.purchaseMethod as keyof typeof poPurchaseMethodLabels] ?? String(existing.purchaseMethod)
      : null
    const orderTypeLabel = existing.orderType
      ? poOrderTypeLabels[existing.orderType as POOrderType] ?? String(existing.orderType)
      : null
    // Attach the PO PDF so recipients get the full order without opening the app.
    let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined
    try {
      const rendered = await renderPurchaseOrderPdf(id)
      if (rendered) {
        attachments = [{ filename: rendered.filename, content: rendered.buffer, contentType: 'application/pdf' }]
      }
    } catch (pdfErr) {
      console.error('Failed to render PO PDF for notification attachment:', pdfErr)
    }

    await notifyPurchaseOrderSubmitted({
      poNumber: existing.poNumber,
      vendorName: existing.vendor?.name || 'Unknown vendor',
      orderType: orderTypeLabel,
      orderDate: fmtDate(existing.orderDate) || '',
      expectedDate: fmtDate(existing.expectedDate),
      total: currencyFmt.format(Number(existing.total)),
      purchaseMethod: method,
      itemCount: existing.items.length,
      submittedBy: session?.user?.name || null,
      poId: id,
    }, attachments)
  } catch (err) {
    console.error('Failed to send PO submitted notification:', err)
  }

  revalidatePath('/dashboard/purchase-orders')
  revalidatePath(`/dashboard/purchase-orders/${id}`)

  return serialize(updated)
}

export async function revisePurchaseOrder(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
  })

  if (!existing) {
    throw new Error('Purchase order not found')
  }

  if (!mayRevisePO({ id: authResult.userId, role: authResult.role }, existing)) {
    throw new Error('Only the person who raised this PO, or an administrator, can take it back to draft.')
  }

  if (existing.status !== 'SUBMITTED') {
    throw new Error('Can only revise submitted purchase orders')
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'DRAFT' },
  })

  revalidatePath('/dashboard/purchase-orders')
  revalidatePath(`/dashboard/purchase-orders/${id}`)

  return serialize(updated)
}

export async function cancelPurchaseOrder(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
  })

  if (!existing) {
    throw new Error('Purchase order not found')
  }

  if (existing.status === 'RECEIVED') {
    throw new Error('Cannot cancel a fully received purchase order')
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'CANCELLED' },
  })

  // Nothing is left to approve on a canceled PO; an ask still open would sit in
  // the approvers' queue forever.
  await supersedePending('PURCHASE_ORDER', id)

  revalidatePath('/dashboard/purchase-orders')
  revalidatePath(`/dashboard/purchase-orders/${id}`)
  revalidatePath('/dashboard/approvals')

  return serialize(updated)
}

// ---------------------------------------------------------------------------
// ASSIGNMENT — funding requests and loans
// ---------------------------------------------------------------------------

/**
 * Assign a purchase order to a loan/lease (or clear it with null). Units
 * already received against the PO are moved onto the loan too, and units
 * received later inherit it automatically.
 *
 * v2 change: clearing takes the method the PO was actually paid with. v1 reads
 * the PO's current `purchaseMethod` as the fallback — but assigning a lease has
 * already overwritten that with LOAN, so taking a PO off its lease in v1 leaves
 * it and every unit on it owned as LOAN with no lease behind them. The original
 * method is not recorded anywhere to restore, so the caller has to say.
 */
export async function assignPurchaseOrderToLease(
  poId: string,
  leaseId: string | null,
  methodWhenCleared?: string | null
) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, purchaseMethod: true },
  })
  if (!po) throw new Error('Purchase order not found')

  const lease = leaseId
    ? await prisma.lease.findUnique({
        where: { id: leaseId },
        select: { id: true, leaseName: true, lender: true, totalAmount: true, endDate: true },
      })
    : null
  if (leaseId && !lease) throw new Error('Lease not found')

  const fallback = lease ? po.purchaseMethod : methodWhenCleared ?? po.purchaseMethod

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: poId },
      // A loan-financed PO is a loan purchase, whatever it said before.
      data: {
        leaseId,
        ...(lease
          ? { purchaseMethod: 'LOAN' }
          : methodWhenCleared !== undefined
            ? { purchaseMethod: (methodWhenCleared as never) || null }
            : {}),
      },
    })
    // v2's sync deliberately leaves `loanAmount` off the units — see lease-sync.
    await syncUnitsToPurchaseOrderLease(tx, poId, lease, fallback)
  })

  revalidatePath(`/dashboard/purchase-orders/${poId}`)
  revalidatePath('/dashboard/purchase-orders')
  revalidatePath('/dashboard/leases')
  if (leaseId) revalidatePath(`/dashboard/leases/${leaseId}`)
  revalidatePath('/dashboard/assets')

  return { success: true }
}

/** Attach a purchase order to a funding request as supporting evidence. */
export async function assignPurchaseOrderToFundingRequest(poId: string, requestId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { fundingRequests: { connect: { id: requestId } } },
  })

  revalidatePath(`/dashboard/purchase-orders/${poId}`)
  revalidatePath(`/dashboard/funding/${requestId}`)
  revalidatePath('/dashboard/funding')

  return { success: true }
}

/** Detach a purchase order from a funding request. */
export async function unassignPurchaseOrderFromFundingRequest(poId: string, requestId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { fundingRequests: { disconnect: { id: requestId } } },
  })

  revalidatePath(`/dashboard/purchase-orders/${poId}`)
  revalidatePath(`/dashboard/funding/${requestId}`)
  revalidatePath('/dashboard/funding')

  return { success: true }
}

/**
 * Funding requests and loans a PO can be assigned to. Requests that are done
 * with (declined, cancelled) are left out; every lease is offered, since a PO
 * can be drawn against an older loan.
 */
export async function getPurchaseOrderAssignmentOptions() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [fundingRequests, leases] = await Promise.all([
    prisma.fundingRequest.findMany({
      where: { status: { notIn: ['DECLINED', 'CANCELLED'] } },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        amountRequested: true,
        requestedBy: true,
        client: { select: { name: true } },
        projectName: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.lease.findMany({
      select: { id: true, leaseNumber: true, leaseName: true, lender: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return serialize({ fundingRequests, leases })
}

export async function deletePurchaseOrder(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
  })

  if (!existing) {
    throw new Error('Purchase order not found')
  }

  if (existing.status !== 'CANCELLED') {
    throw new Error('Only cancelled purchase orders can be deleted')
  }

  await prisma.$transaction(async (tx) => {
    // Unlink any assets that reference this PO
    await tx.asset.updateMany({
      where: { purchaseOrderId: id },
      data: { purchaseOrderId: null },
    })

    // Delete associated documents
    await tx.document.deleteMany({
      where: { entityType: 'PURCHASE_ORDER', entityId: id },
    })

    // Delete PO (POItems cascade automatically)
    await tx.purchaseOrder.delete({
      where: { id },
    })
  })

  revalidatePath('/dashboard/purchase-orders')
}

export async function receivePurchaseOrder(id: string, data: ReceivePOData) {
  // Phase 6: receiving is the warehouse's job, so STAFF may — but a new model is
  // catalog, not a count, and stays an admin's call.
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)
  if ((data.newAssets?.length ?? 0) > 0 && !isAdmin(authResult.role)) {
    throw new Error('Creating a new model while receiving is for administrators. Link the line to an existing model, or ask an admin to receive it.')
  }

  // Held when its approval is outstanding: a PO whose money changed after it was
  // approved, or that was never cleared. A PO sent before approvals existed and
  // untouched since has no history and is not held.
  const gate = await releaseGate({
    type: 'PURCHASE_ORDER',
    id,
    actor: await actorFor(authResult.userId, authResult.role),
    act: 'receiving against it',
    raise: false,
    always: false,
  })
  if (gate.status === 'held') throw new Error(gate.message)

  const result = await prisma.$transaction(async (tx) => {
    // Load PO with items
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, lease: true },
    })

    if (!po) {
      throw new Error('Purchase order not found')
    }

    if (po.status !== 'SUBMITTED' && po.status !== 'PARTIAL') {
      throw new Error('Purchase order must be submitted or partially received to receive items')
    }

    // Step 1: Create new Asset types from data.newAssets
    const newAssetMap = new Map<string, string>() // poItemId -> new assetId
    if (data.newAssets && data.newAssets.length > 0) {
      for (const newAsset of data.newAssets) {
        const asset = await tx.asset.create({
          data: {
            name: newAsset.name,
            categoryId: newAsset.categoryId,
            manufacturer: newAsset.manufacturer || null,
            model: newAsset.model || null,
            vendorId: po.vendorId,
            purchaseOrderId: po.id,
          },
        })
        newAssetMap.set(newAsset.poItemId, asset.id)

        // Link the POItem to the new Asset
        await tx.pOItem.update({
          where: { id: newAsset.poItemId },
          data: { assetId: asset.id },
        })
      }
    }

    // Step 2: Process each received item
    const createdUnits: string[] = []

    for (const receiveItem of data.items) {
      const poItem = po.items.find((i) => i.id === receiveItem.poItemId)
      if (!poItem) {
        throw new Error(`PO item ${receiveItem.poItemId} not found`)
      }

      // Validate we're not receiving more than ordered
      const remaining = poItem.quantity - poItem.receivedQuantity
      if (receiveItem.receivedQuantity > remaining) {
        throw new Error(
          `Cannot receive ${receiveItem.receivedQuantity} for "${poItem.description}" — only ${remaining} remaining`
        )
      }

      // Resolve assetId (may have been just created)
      const assetId = newAssetMap.get(receiveItem.poItemId) || poItem.assetId

      // Resale items: capture serial numbers only (no AssetUnits, no fixed asset).
      if (poItem.isResale && receiveItem.serials && receiveItem.serials.length > 0) {
        const cleaned = receiveItem.serials.map((s) => s.trim()).filter(Boolean)
        if (cleaned.length > 0) {
          await tx.pOItem.update({
            where: { id: receiveItem.poItemId },
            data: { receivedSerials: { push: cleaned } },
          })
        }
      }

      // If inventoried and units are provided, create AssetUnits
      if (poItem.isInventoried && receiveItem.units && receiveItem.units.length > 0 && assetId) {
        for (const unit of receiveItem.units) {
          const barcode = unit.barcode || generateBarcode()

          await tx.assetUnit.create({
            data: {
              assetId,
              barcode,
              serialNumber: unit.serialNumber || null,
              status: 'AVAILABLE',
              locationId: unit.locationId,
              condition: unit.condition || 'New',
              purchasePrice: unit.purchasePrice ?? Number(poItem.unitPrice),
              purchaseDate: po.orderDate,
              receivedDate: data.receivingDate ? new Date(data.receivingDate) : new Date(),
              // Carry the PO's purchase method through to unit ownership. A PO
              // financed by a loan overrides it — the unit belongs to that
              // lease. Legacy POs without a method fall back to CASH.
              ownershipType: po.leaseId ? 'LOAN' : po.purchaseMethod ?? 'CASH',
              // Trail back to the order that bought this unit.
              purchaseOrderId: po.id,
              // v2 addition: the unit names who supplied it. v1 left this to
              // the asset, so a unit's own vendor stayed blank on receipt.
              vendorId: po.vendorId,
              // Inherit the financing, so hardware lands on the right loan
              // without anyone re-keying it after receipt. v1 also writes
              // `loanAmount: po.lease.totalAmount` here; v2 does not, for the
              // reason in lease-sync.ts — it stamps the whole loan onto every
              // unit (data gap 7). The lease link is the fact.
              leaseId: po.leaseId,
              loanName: po.lease?.leaseName ?? null,
              fundingBusiness: po.lease?.lender ?? null,
              amortizationEndDate: po.lease?.endDate ?? null,
              notes: unit.notes || null,
            },
          })

          createdUnits.push(barcode)
        }

        // Increment Asset totalQuantity
        await tx.asset.update({
          where: { id: assetId },
          data: {
            totalQuantity: { increment: receiveItem.units.length },
          },
        })
      }

      // Update POItem receivedQuantity
      await tx.pOItem.update({
        where: { id: receiveItem.poItemId },
        data: {
          receivedQuantity: { increment: receiveItem.receivedQuantity },
        },
      })
    }

    // Step 3: Determine new PO status
    // Re-fetch items to get updated receivedQuantity
    const updatedItems = await tx.pOItem.findMany({
      where: { purchaseOrderId: id },
    })

    const allReceived = updatedItems.every((item) => item.receivedQuantity >= item.quantity)

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: allReceived ? 'RECEIVED' : 'PARTIAL',
        receivedDate: allReceived ? new Date() : null,
      },
      include: {
        vendor: true,
        items: true,
      },
    })

    return { purchaseOrder: updated, createdUnits, newAssetMap: Object.fromEntries(newAssetMap) }
  })

  // Auto-generate PO document, then attach to each received asset
  await generateAndSavePODocument(id, authResult.userId!)
  await attachPODocumentsToAssets(id, authResult.userId!)

  revalidatePath('/dashboard/purchase-orders')
  revalidatePath(`/dashboard/purchase-orders/${id}`)
  revalidatePath('/dashboard/assets')

  return serialize(result)
}

export async function getCurrentUserName(): Promise<string | null> {
  const session = await auth()
  return session?.user?.name || null
}
