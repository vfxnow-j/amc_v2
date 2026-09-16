'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin, requireAuth } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { computeFundingMetrics } from '@/lib/utils/funding'
import type {
  CustomerCommitment,
  FundingPurchaseType,
  FundingRequestStatus,
  Prisma,
} from '@/generated/prisma/client'
import {
  CUSTOMER_COMMITMENT_LABEL,
  FUNDING_LOCKED,
  FUNDING_PURCHASE_TYPE_LABEL,
} from '@/lib/procurement/funding-labels'
import { notifyFundingRequestSubmitted } from '@/lib/actions/notifications'
import {
  renderFundingRequestPdf,
  generateAndSaveFundingRequestDocument,
} from '@/lib/actions/documents'
import { assignPurchaseOrdersToLeaseTx } from '@/lib/funding/lease-sync'

/**
 * Equipment funding requests — ported from v1's `lib/actions/funding-requests.ts`.
 *
 * The transactions, numbering and lifecycle guards are v1's. What changed:
 *
 * - **Roles.** v1 gated writes on `requireEditor`, so STAFF could raise, approve
 *   and fund a request. Procurement is admin-only in v2 until the owner says
 *   otherwise (docs/procurement.md, "Small calls"), so every write here is
 *   `requireAdmin`; reads stay `requireAuth`.
 * - **Evidence joins.** Attach and detach live here as their own actions, and
 *   `updateFundingRequest` only rewrites the joins when it is handed them. The
 *   edit form does not carry them, so saving an edit can no longer silently
 *   drop a PO somebody attached from the PO record in the meantime.
 * - **The accounting email** reports what happened to it, because on this
 *   instance the honest answer is "nothing was sent" and the screen should say
 *   so rather than imply accounting has it.
 *
 * `deleteFundingRequest` is ported for completeness and wired to nothing — the
 * data is real, and deleting is not offered until the owner asks for it.
 */

export type FundingRequestItemFormData = {
  id?: string
  description: string
  quantity: number
  unitCost: number
}

export type FundingRequestFormData = {
  // 1. Request & purpose
  requestedBy: string
  requestDate: Date
  neededByDate?: Date | null
  amountRequested: number
  businessPurpose?: string | null

  // 2. Equipment & customer
  purchaseType?: FundingPurchaseType | null
  equipmentSummary?: string | null
  items: FundingRequestItemFormData[]
  clientId?: string | null
  projectName?: string | null
  customerCommitment?: CustomerCommitment | null
  /** Monthly rate billed per unit. */
  customerRentalRate?: number | null
  /** How many units bill at that rate. */
  billableUnits?: number | null
  /** Derived total: rate x units. */
  customerRentalCharge?: number | null
  expectedInitialRevenue?: number | null
  rentalPeriod?: string | null
  paymentTerms?: string | null

  // 3. Financing terms
  lender?: string | null
  amountBorrowed?: number | null
  /** Fraction, e.g. 0.065 for 6.5%. */
  interestRate?: number | null
  termMonths?: number | null
  monthlyPayment?: number | null
  financingFees?: number | null
  estimatedTotalInterest?: number | null
  firstPaymentDate?: Date | null
  expectedPayoffDate?: Date | null

  // 4. Payback & asset plan
  expectedGrossProfit?: number | null
  estimatedPaybackMonths?: number | null
  expectedAnnualUtilization?: number | null
  expectedHoldMonths?: number | null
  expectedAnnualRevenue?: number | null
  estimatedResaleValue?: number | null
  exitPlan?: string | null

  // 5. Key risk / approval rationale
  alternateUsePlan?: string | null
  borrowRationale?: string | null

  // Supporting documents. Optional on update — see the file header.
  purchaseOrderIds?: string[]
  reservationIds?: string[]

  // Trail
  leaseId?: string | null
  notes?: string | null
}

export type FundingRequestFilters = {
  search?: string
  status?: FundingRequestStatus
  clientId?: string
}

// ---------------------------------------------------------------------------
// NUMBERING
// ---------------------------------------------------------------------------

/**
 * Sequential funding ID, e.g. FR-2026-00001. This is the "Funding ID (Finance)"
 * on the paper form — the key accounting ties loan draws, vendor invoices and
 * fixed assets back to.
 */
async function generateRequestNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const last = await prisma.fundingRequest.findFirst({
    where: { requestNumber: { startsWith: `FR-${year}-` } },
    orderBy: { requestNumber: 'desc' },
    select: { requestNumber: true },
  })

  let sequence = 1
  if (last) {
    const match = last.requestNumber.match(/^FR-\d{4}-(\d+)$/)
    if (match) sequence = parseInt(match[1], 10) + 1
  }

  return `FR-${year}-${sequence.toString().padStart(5, '0')}`
}

const detailInclude = {
  client: { select: { id: true, name: true, email: true } },
  requestedByUser: { select: { id: true, name: true, email: true } },
  lease: { select: { id: true, leaseName: true, leaseNumber: true, lender: true, status: true } },
  items: { orderBy: { sortOrder: 'asc' } },
  purchaseOrders: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      total: true,
      orderDate: true,
      expectedDate: true,
      receivedDate: true,
      vendor: { select: { id: true, name: true } },
      lease: { select: { id: true, leaseNumber: true } },
    },
    orderBy: { orderDate: 'desc' },
  },
  reservations: {
    select: {
      id: true,
      reservationNumber: true,
      status: true,
      reservationType: true,
      total: true,
      startDate: true,
      endDate: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { startDate: 'desc' },
  },
} as const

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export async function getFundingRequests(filters: FundingRequestFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, clientId } = filters

  const where: Prisma.FundingRequestWhereInput = {}

  if (search) {
    where.OR = [
      { requestNumber: { contains: search, mode: 'insensitive' } },
      { requestedBy: { contains: search, mode: 'insensitive' } },
      { equipmentSummary: { contains: search, mode: 'insensitive' } },
      { businessPurpose: { contains: search, mode: 'insensitive' } },
      { projectName: { contains: search, mode: 'insensitive' } },
      { lender: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  if (status) where.status = status
  if (clientId) where.clientId = clientId

  const requests = await prisma.fundingRequest.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      lease: { select: { id: true, leaseName: true, leaseNumber: true } },
      items: { select: { id: true } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true } },
      reservations: { select: { id: true, reservationNumber: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(requests)
}

export async function getFundingRequest(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const request = await prisma.fundingRequest.findUnique({
    where: { id },
    include: detailInclude,
  })

  return serialize(request)
}

export async function getFundingRequestStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [openRequests, awaitingReview, approvedNotFulfilled, fulfilled] = await Promise.all([
    prisma.fundingRequest.aggregate({
      where: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'FUNDED'] } },
      _count: true,
      _sum: { amountRequested: true },
    }),
    prisma.fundingRequest.aggregate({
      where: { status: 'SUBMITTED' },
      _count: true,
      _sum: { amountRequested: true },
    }),
    prisma.fundingRequest.aggregate({
      where: { status: { in: ['APPROVED', 'FUNDED'] } },
      _count: true,
      _sum: { amountRequested: true },
    }),
    prisma.fundingRequest.aggregate({
      where: { status: 'FULFILLED' },
      _count: true,
      _sum: { amountRequested: true },
    }),
  ])

  return serialize({
    openCount: openRequests._count,
    openAmount: Number(openRequests._sum.amountRequested || 0),
    awaitingReviewCount: awaitingReview._count,
    awaitingReviewAmount: Number(awaitingReview._sum.amountRequested || 0),
    approvedCount: approvedNotFulfilled._count,
    approvedAmount: Number(approvedNotFulfilled._sum.amountRequested || 0),
    fulfilledCount: fulfilled._count,
    fulfilledAmount: Number(fulfilled._sum.amountRequested || 0),
  })
}

// ---------------------------------------------------------------------------
// FORM OPTIONS — supporting POs, client quotes, clients and loans to link
// ---------------------------------------------------------------------------

export async function getFundingRequestFormOptions() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [clients, purchaseOrders, reservations, leases] = await Promise.all([
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // Anything not cancelled — a request is normally raised alongside a draft
    // or submitted PO, but a received PO can be attached after the fact.
    prisma.purchaseOrder.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        id: true,
        poNumber: true,
        status: true,
        total: true,
        orderDate: true,
        vendor: { select: { name: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: 300,
    }),
    // Client quotes and orders that justify the spend.
    prisma.reservation.findMany({
      where: { status: { notIn: ['CANCELLED', 'LOST'] } },
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        reservationType: true,
        total: true,
        startDate: true,
        client: { select: { name: true } },
      },
      orderBy: { startDate: 'desc' },
      take: 300,
    }),
    prisma.lease.findMany({
      select: { id: true, leaseName: true, leaseNumber: true, lender: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return serialize({ clients, purchaseOrders, reservations, leases })
}

// ---------------------------------------------------------------------------
// START A REQUEST FROM AN EXISTING PURCHASE ORDER
// ---------------------------------------------------------------------------

export type FundingRequestPrefill = {
  items: { description: string; quantity: number; unitCost: number }[]
  /** Carried from the PO's order type, when it maps cleanly. */
  purchaseType: FundingPurchaseType | null
  /** The PO total — what actually has to be funded, freight and tax included. */
  amountRequested: number
  /** Sum of the line items alone. Differs from the ask by freight/fees/tax. */
  equipmentCost: number
  purchaseOrderIds: string[]
  leaseId: string | null
  lender: string | null
  source: {
    poId: string
    poNumber: string
    vendorName: string
    itemCount: number
    total: number
    leaseNumber: string | null
  }
}

/**
 * Seed a new funding request from a purchase order that already exists — the
 * common case where the quote came in first and the paperwork follows.
 *
 * Line items come across as the equipment list, the PO is attached as
 * supporting evidence, and the ask is set to the PO total (not the line-item
 * subtotal) because freight and tax need funding too. Dates and the business
 * case are deliberately left blank — those are judgements the requester makes,
 * not something to guess from an order.
 */
export async function getFundingRequestPrefillFromPO(
  poId: string
): Promise<FundingRequestPrefill | null> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      vendor: { select: { name: true } },
      items: { orderBy: { createdAt: 'asc' } },
      lease: { select: { id: true, leaseNumber: true, lender: true } },
    },
  })
  if (!po) return null

  const items = po.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitCost: Number(item.unitPrice),
  }))

  // The PO already says what the hardware is for; carry it across. POs draw no
  // distinction for cloud, so that one is only ever chosen by hand.
  const purchaseType: FundingPurchaseType | null =
    po.orderType === 'HARDWARE_RENTAL' || po.orderType === 'HARDWARE_RENTAL_COMPONENTS'
      ? 'HARDWARE_RENTAL'
      : po.orderType === 'HARDWARE_RESALE' || po.orderType === 'HARDWARE_RESALE_COMPONENTS'
      ? 'HARDWARE_RESALE'
      : null

  const equipmentCost =
    Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0) * 100) / 100

  return serialize({
    items,
    purchaseType,
    amountRequested: Number(po.total),
    equipmentCost,
    purchaseOrderIds: [po.id],
    leaseId: po.lease?.id ?? null,
    lender: po.lease?.lender ?? null,
    source: {
      poId: po.id,
      poNumber: po.poNumber,
      vendorName: po.vendor?.name || 'Unknown vendor',
      itemCount: items.length,
      total: Number(po.total),
      leaseNumber: po.lease?.leaseNumber ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// CREATE / UPDATE / DELETE
// ---------------------------------------------------------------------------

function itemAmount(item: FundingRequestItemFormData): number {
  return Math.round((item.quantity || 0) * (item.unitCost || 0) * 100) / 100
}

function equipmentTotal(items: FundingRequestItemFormData[]): number {
  return Math.round(items.reduce((sum, i) => sum + itemAmount(i), 0) * 100) / 100
}

/** Fields shared by create and update, minus items and the link tables. */
function scalarData(data: FundingRequestFormData) {
  return {
    requestedBy: data.requestedBy,
    requestDate: data.requestDate,
    neededByDate: data.neededByDate ?? null,
    amountRequested: data.amountRequested,
    businessPurpose: data.businessPurpose ?? null,

    purchaseType: data.purchaseType ?? null,
    equipmentSummary: data.equipmentSummary ?? null,
    totalEquipmentCost: equipmentTotal(data.items),
    clientId: data.clientId ?? null,
    projectName: data.projectName ?? null,
    customerCommitment: data.customerCommitment ?? null,
    customerRentalRate: data.customerRentalRate ?? null,
    billableUnits: data.billableUnits ?? null,
    customerRentalCharge: data.customerRentalCharge ?? null,
    expectedInitialRevenue: data.expectedInitialRevenue ?? null,
    rentalPeriod: data.rentalPeriod ?? null,
    paymentTerms: data.paymentTerms ?? null,

    lender: data.lender ?? null,
    amountBorrowed: data.amountBorrowed ?? null,
    interestRate: data.interestRate ?? null,
    termMonths: data.termMonths ?? null,
    monthlyPayment: data.monthlyPayment ?? null,
    financingFees: data.financingFees ?? null,
    estimatedTotalInterest: data.estimatedTotalInterest ?? null,
    firstPaymentDate: data.firstPaymentDate ?? null,
    expectedPayoffDate: data.expectedPayoffDate ?? null,

    expectedGrossProfit: data.expectedGrossProfit ?? null,
    estimatedPaybackMonths: data.estimatedPaybackMonths ?? null,
    expectedAnnualUtilization: data.expectedAnnualUtilization ?? null,
    expectedHoldMonths: data.expectedHoldMonths ?? null,
    expectedAnnualRevenue: data.expectedAnnualRevenue ?? null,
    estimatedResaleValue: data.estimatedResaleValue ?? null,
    exitPlan: data.exitPlan ?? null,

    alternateUsePlan: data.alternateUsePlan ?? null,
    borrowRationale: data.borrowRationale ?? null,

    leaseId: data.leaseId ?? null,
    notes: data.notes ?? null,
  }
}

export async function createFundingRequest(data: FundingRequestFormData) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const requestNumber = await generateRequestNumber()

  const created = await prisma.fundingRequest.create({
    data: {
      requestNumber,
      status: 'DRAFT',
      requestedById: authResult.userId ?? null,
      ...scalarData(data),
      items: {
        create: data.items.map((item, index) => ({
          description: item.description,
          quantity: item.quantity,
          unitCost: item.unitCost,
          amount: itemAmount(item),
          sortOrder: index,
        })),
      },
      purchaseOrders: { connect: (data.purchaseOrderIds ?? []).map((id) => ({ id })) },
      reservations: { connect: (data.reservationIds ?? []).map((id) => ({ id })) },
    },
    include: detailInclude,
  })

  revalidatePath('/dashboard/funding')
  for (const poId of data.purchaseOrderIds ?? []) {
    revalidatePath(`/dashboard/purchase-orders/${poId}`)
  }

  return serialize(created)
}

export async function updateFundingRequest(id: string, data: FundingRequestFormData) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')

  const updated = await prisma.$transaction(async (tx) => {
    // Line items are replaced wholesale — they carry no downstream state.
    await tx.fundingRequestItem.deleteMany({ where: { fundingRequestId: id } })

    return tx.fundingRequest.update({
      where: { id },
      data: {
        ...scalarData(data),
        items: {
          create: data.items.map((item, index) => ({
            description: item.description,
            quantity: item.quantity,
            unitCost: item.unitCost,
            amount: itemAmount(item),
            sortOrder: index,
          })),
        },
        // v1 always `set` these from the form. Left alone when not supplied,
        // so an edit cannot undo an attachment made elsewhere.
        ...(data.purchaseOrderIds
          ? { purchaseOrders: { set: data.purchaseOrderIds.map((poId) => ({ id: poId })) } }
          : {}),
        ...(data.reservationIds
          ? { reservations: { set: data.reservationIds.map((rId) => ({ id: rId })) } }
          : {}),
      },
      include: detailInclude,
    })
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

export async function deleteFundingRequest(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')

  // Once accounting has it, the trail has to stay — cancel instead.
  if (existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') {
    throw new Error('Only draft or cancelled funding requests can be deleted')
  }

  await prisma.fundingRequest.delete({ where: { id } })

  revalidatePath('/dashboard/funding')

  return { success: true }
}

// ---------------------------------------------------------------------------
// SUPPORTING EVIDENCE — written from the request's side
// ---------------------------------------------------------------------------

/** Guard shared by the four join writes: the request exists and is still open to edits. */
async function requireEditableRequest(id: string) {
  const request = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!request) throw new Error('Funding request not found')
  if (FUNDING_LOCKED.includes(request.status)) {
    throw new Error('A fulfilled or cancelled funding request is closed to changes')
  }
}

/**
 * Attach a purchase order as evidence. Attaching does not move the PO onto the
 * request's loan — v1 only does that when the request is marked funded, and a
 * PO's financing is changed deliberately, on the PO.
 */
export async function attachPurchaseOrderToFundingRequest(id: string, poId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await requireEditableRequest(id)
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } })
  if (!po) throw new Error('Purchase order not found')
  if (po.status === 'CANCELLED') throw new Error('A cancelled purchase order cannot back a request')

  await prisma.fundingRequest.update({
    where: { id },
    data: { purchaseOrders: { connect: { id: poId } } },
  })

  revalidatePath(`/dashboard/funding/${id}`)
  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/purchase-orders/${poId}`)

  return { success: true }
}

export async function detachPurchaseOrderFromFundingRequest(id: string, poId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await requireEditableRequest(id)
  await prisma.fundingRequest.update({
    where: { id },
    data: { purchaseOrders: { disconnect: { id: poId } } },
  })

  revalidatePath(`/dashboard/funding/${id}`)
  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/purchase-orders/${poId}`)

  return { success: true }
}

/** Attach a client quote or order — the demand that justifies the spend. */
export async function attachReservationToFundingRequest(id: string, reservationId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await requireEditableRequest(id)
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  })
  if (!order) throw new Error('Order not found')
  // The same exclusion v1's form options apply: a lost or cancelled order is
  // not demand.
  if (order.status === 'CANCELLED' || order.status === 'LOST') {
    throw new Error('A lost or cancelled order cannot back a request')
  }

  await prisma.fundingRequest.update({
    where: { id },
    data: { reservations: { connect: { id: reservationId } } },
  })

  revalidatePath(`/dashboard/funding/${id}`)
  revalidatePath('/dashboard/funding')

  return { success: true }
}

export async function detachReservationFromFundingRequest(id: string, reservationId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await requireEditableRequest(id)
  await prisma.fundingRequest.update({
    where: { id },
    data: { reservations: { disconnect: { id: reservationId } } },
  })

  revalidatePath(`/dashboard/funding/${id}`)
  revalidatePath('/dashboard/funding')

  return { success: true }
}

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

export type AccountingDispatch = {
  /** Recipients with the `funding` notification switched on. */
  recipients: number
  sent: number
  /** Whether a saved copy of the form is on the record after the attempt. */
  documentOnFile: boolean
  error?: string
}

/**
 * Build the accounting notification for a request and send it with the request
 * PDF attached. Shared by submit and re-send so both always deliver the same
 * email. Never throws — a mail failure must not roll back a submission,
 * exactly as with purchase orders.
 */
async function dispatchToAccounting(
  id: string,
  userId: string | undefined,
  submittedBy: string | null
): Promise<AccountingDispatch> {
  const outcome: AccountingDispatch = { recipients: 0, sent: 0, documentOnFile: false }

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    include: detailInclude,
  })
  if (!existing) return outcome

  // Save the PDF against the request so the submitted version is on file. The
  // generator swallows its own failures, so whether a copy is on file is read
  // back rather than assumed from the call returning.
  try {
    if (userId) {
      await generateAndSaveFundingRequestDocument(id, userId, { force: true })
    }
    const onFile = await prisma.document.findFirst({
      where: { entityType: 'FUNDING_REQUEST', entityId: id, documentType: 'FUNDING_REQUEST' },
      select: { id: true },
    })
    outcome.documentOnFile = !!onFile
  } catch (err) {
    console.error('Failed to save funding request document:', err)
  }

  try {
    const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    const fmtDate = (d: Date | null | undefined) =>
      d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null

    const metrics = computeFundingMetrics({
      totalEquipmentCost: Number(existing.totalEquipmentCost),
      amountRequested: Number(existing.amountRequested),
      amountBorrowed: existing.amountBorrowed ? Number(existing.amountBorrowed) : null,
      financingFees: existing.financingFees ? Number(existing.financingFees) : null,
      estimatedTotalInterest: existing.estimatedTotalInterest ? Number(existing.estimatedTotalInterest) : null,
      monthlyPayment: existing.monthlyPayment ? Number(existing.monthlyPayment) : null,
      customerRentalRate: existing.customerRentalRate ? Number(existing.customerRentalRate) : null,
      billableUnits: existing.billableUnits,
      customerRentalCharge: existing.customerRentalCharge ? Number(existing.customerRentalCharge) : null,
      expectedInitialRevenue: existing.expectedInitialRevenue ? Number(existing.expectedInitialRevenue) : null,
      expectedGrossProfit: existing.expectedGrossProfit ? Number(existing.expectedGrossProfit) : null,
      expectedAnnualRevenue: existing.expectedAnnualRevenue ? Number(existing.expectedAnnualRevenue) : null,
      estimatedResaleValue: existing.estimatedResaleValue ? Number(existing.estimatedResaleValue) : null,
      estimatedPaybackMonths: existing.estimatedPaybackMonths,
      expectedHoldMonths: existing.expectedHoldMonths,
    })

    let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined
    try {
      const rendered = await renderFundingRequestPdf(id)
      if (rendered) {
        attachments = [{ filename: rendered.filename, content: rendered.buffer, contentType: 'application/pdf' }]
      }
    } catch (pdfErr) {
      console.error('Failed to render funding request PDF for notification attachment:', pdfErr)
    }

    const result = await notifyFundingRequestSubmitted(
      {
        requestNumber: existing.requestNumber,
        requestedBy: existing.requestedBy,
        submittedBy,
        requestDate: fmtDate(existing.requestDate) || '',
        neededByDate: fmtDate(existing.neededByDate),
        amountRequested: currencyFmt.format(Number(existing.amountRequested)),
        equipmentCost: currencyFmt.format(Number(existing.totalEquipmentCost)),
        equipmentSummary: existing.equipmentSummary,
        purchaseType: existing.purchaseType
          ? FUNDING_PURCHASE_TYPE_LABEL[existing.purchaseType]
          : null,
        itemCount: existing.items.length,
        customer: existing.client?.name || existing.projectName || null,
        commitment: existing.customerCommitment
          ? CUSTOMER_COMMITMENT_LABEL[existing.customerCommitment]
          : null,
        lender: existing.lender,
        monthlyPayment: existing.monthlyPayment
          ? currencyFmt.format(Number(existing.monthlyPayment))
          : null,
        customerRentalCharge:
          metrics.monthlyRentalCharge !== null
            ? `${currencyFmt.format(metrics.monthlyRentalCharge)}${
                existing.customerRentalRate && existing.billableUnits
                  ? ` (${existing.billableUnits} × ${currencyFmt.format(Number(existing.customerRentalRate))}/mo)`
                  : ''
              }`
            : null,
        businessPurpose: existing.businessPurpose,
        paybackMonths: metrics.statedPaybackMonths ?? metrics.paybackMonths,
        debtServiceCoverage: metrics.debtServiceCoverage,
        breakEvenMonths: metrics.breakEvenMonths,
        neverBreaksEven: metrics.neverBreaksEven,
        supportingPOs: existing.purchaseOrders.map((po) => po.poNumber),
        supportingQuotes: existing.reservations.map((r) => r.reservationNumber),
        requestId: id,
      },
      attachments
    )
    outcome.recipients = result.recipients
    outcome.sent = result.sent
    outcome.error = result.error
  } catch (err) {
    console.error('Failed to send funding request submitted notification:', err)
    outcome.error = err instanceof Error ? err.message : 'Unknown error'
  }

  return outcome
}

/**
 * Send the request to accounting: flips it to SUBMITTED, saves the request PDF
 * against the record, and emails the configured 'funding' recipients with the
 * summary in the body and the full form attached as a PDF.
 */
export async function submitFundingRequest(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true, requestedBy: true },
  })
  if (!existing) throw new Error('Funding request not found')

  if (existing.status !== 'DRAFT') {
    throw new Error('Only draft funding requests can be submitted')
  }

  const session = await auth()
  const submittedBy = session?.user?.name || existing.requestedBy

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      submittedBy,
    },
  })

  const dispatch = await dispatchToAccounting(id, authResult.userId, submittedBy)

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize({ ...updated, dispatch })
}

/** Pull a submitted request back to draft for edits before accounting acts. */
export async function reviseFundingRequest(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status !== 'SUBMITTED') {
    throw new Error('Only submitted funding requests can be reverted to draft')
  }

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: { status: 'DRAFT', submittedAt: null, submittedBy: null },
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

export type FundingApprovalData = {
  operationsApprovedBy?: string | null
  financeApprovedBy?: string | null
  executiveApprovedBy?: string | null
  approvalDate?: Date | null
}

export async function approveFundingRequest(id: string, approval: FundingApprovalData = {}) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status !== 'SUBMITTED' && existing.status !== 'DECLINED') {
    throw new Error('Only submitted or declined funding requests can be approved')
  }

  const session = await auth()

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: {
      status: 'APPROVED',
      operationsApprovedBy: approval.operationsApprovedBy ?? undefined,
      financeApprovedBy: approval.financeApprovedBy ?? session?.user?.name ?? undefined,
      executiveApprovedBy: approval.executiveApprovedBy ?? undefined,
      approvalDate: approval.approvalDate ?? new Date(),
      declineReason: null,
    },
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

export async function declineFundingRequest(id: string, reason?: string | null) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status !== 'SUBMITTED' && existing.status !== 'APPROVED') {
    throw new Error('Only submitted or approved funding requests can be declined')
  }

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: { status: 'DECLINED', declineReason: reason ?? null },
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

/**
 * Mark the money as drawn, tying the request to the loan/lease it was funded
 * by — the last link in the request → hardware → loan trail.
 *
 * Naming the loan here also rolls the request's attached purchase orders (and
 * anything already received against them) onto that loan, so the buy doesn't
 * need re-keying downstream. POs already sitting on a different loan are left
 * alone — moving those is a deliberate act on the PO itself.
 */
export async function markFundingRequestFunded(id: string, leaseId?: string | null) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true, purchaseOrders: { select: { id: true } } },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status !== 'APPROVED' && existing.status !== 'FUNDED') {
    throw new Error('Only approved funding requests can be marked funded')
  }

  const lease = leaseId
    ? await prisma.lease.findUnique({
        where: { id: leaseId },
        select: { id: true, leaseName: true, lender: true, totalAmount: true, endDate: true },
      })
    : null
  if (leaseId && !lease) throw new Error('Lease not found')

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.fundingRequest.update({
      where: { id },
      data: {
        status: 'FUNDED',
        fundedAt: new Date(),
        leaseId: leaseId === undefined ? undefined : leaseId,
      },
    })

    const movedPoIds = lease
      ? await assignPurchaseOrdersToLeaseTx(
          tx,
          existing.purchaseOrders.map((po) => po.id),
          lease
        )
      : []

    return { request, movedPoIds }
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)
  revalidatePath('/dashboard/purchase-orders')
  revalidatePath('/dashboard/leases')
  if (leaseId) revalidatePath(`/dashboard/leases/${leaseId}`)
  if (result.movedPoIds.length > 0) revalidatePath('/dashboard/assets')

  return serialize({ ...result.request, purchaseOrdersMoved: result.movedPoIds.length })
}

/** Hardware bought and received — the request is closed out. */
export async function markFundingRequestFulfilled(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status !== 'APPROVED' && existing.status !== 'FUNDED') {
    throw new Error('Only approved or funded requests can be marked fulfilled')
  }

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: { status: 'FULFILLED', fulfilledAt: new Date() },
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

export async function cancelFundingRequest(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status === 'FULFILLED') {
    throw new Error('Fulfilled funding requests cannot be cancelled')
  }

  const updated = await prisma.fundingRequest.update({
    where: { id },
    data: { status: 'CANCELLED' },
  })

  revalidatePath('/dashboard/funding')
  revalidatePath(`/dashboard/funding/${id}`)

  return serialize(updated)
}

/**
 * Re-send an already-submitted request to accounting — same email, same PDF,
 * refreshed from the current record. Status and submission stamps are left
 * alone.
 */
export async function resendFundingRequest(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true, submittedBy: true, requestedBy: true },
  })
  if (!existing) throw new Error('Funding request not found')
  if (existing.status === 'DRAFT') {
    throw new Error('Submit the request before re-sending it')
  }

  const session = await auth()
  const dispatch = await dispatchToAccounting(
    id,
    authResult.userId,
    existing.submittedBy || session?.user?.name || existing.requestedBy
  )

  revalidatePath(`/dashboard/funding/${id}`)

  return { success: true, dispatch }
}
