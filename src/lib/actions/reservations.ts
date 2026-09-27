'use server'

import { handoverShortfall, shortfallMessage } from '@/lib/orders/handover'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { OverScanConflict, OverScanResolution } from '@/lib/reservations/over-scan'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { recomputeUnitRevenue } from '@/lib/utils/revenue'
import { logAudit } from './audit'
import { quoteGate } from '@/lib/approvals/core'
import { syncReservationDeal } from '@/lib/integrations/hubspot'
import type { ReservationStatus, ReservationType, PricingType, BillingCycleType } from '@/lib/types'
import { PACKAGE_EDITABLE_STATUSES } from '@/lib/types'
import { addDays } from 'date-fns'
import {
  calculatePeriods as calculateTermPeriods,
  computeItemSubtotal,
  formatPeriodCount,
  formatTermLength,
} from '@/lib/pricing/periods'
import { deriveRentalRate, pricingTypeForBillingCycle } from '@/lib/pricing/rates'
// One next-billing rule for the whole app. This file used to carry its own copy,
// which read the 1st in server-local time and ignored the business anchor.
import { calculateNextBillingDate } from '@/lib/utils/billing'
import { getBillingAnchor } from '@/lib/settings/business'
import { firstInvoiceStretch } from '@/lib/billing/calendar'
import { ACTIVE_PACKAGE_SHIPPING, cycleTermsForOrder } from '@/lib/billing/cycle-invoice'
import { autoInvoiceScope, firstCycleAutoInvoice } from '@/lib/billing/auto-invoice'
import { firstStretchNote, priorCycleInvoiceWhere } from '@/lib/billing/first-cycle'
import { businessToday, intendedDay } from '@/lib/billing/calendar'
import { recurringFor } from '@/lib/orders/recurring'
import { kindForOrderType, nextNumber } from '@/lib/numbering/next'
import { CHECKOUT_LINE_WHERE, pickScanLine, unitChargeFor } from '@/lib/checkout/lines'
import { calculateReservationTotals, sanitizeMarginPercent } from '@/lib/pricing/reservation-totals'
import { loadFlowBases } from '@/lib/flow/load-bases'
import { applyFlowDefaults } from '@/lib/flow/defaults'
import { assertFlowTerm } from '@/lib/flow/terms'
import { flowOrderKnobsProblem } from '@/lib/flow/knob-bounds'
import { carryFlowLine, matchFlowLines } from '@/lib/flow/line-carry'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'
import { duplicateOrderTx, duplicateTargetType } from '@/lib/orders/duplicate'
import { repriceFlowTx } from '@/lib/flow/reprice'
import { buildFlowTermsSnapshot, flowTermsForReservation, loadFlowTermsSettings } from '@/lib/flow-terms-server'
import { addTermMonths, flowCreateLineCost, flowSnapshotLineCost } from '@/lib/flow/stored-money'
// Transaction client type for passing prisma tx to helpers
type TxClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export type ReservationFormData = {
  clientId: string
  reservationType?: ReservationType
  startDate: Date
  endDate: Date
  projectName?: string
  projectCode?: string
  notes?: string
  internalNotes?: string
  // Date the quoted pricing stops being honored (null clears it)
  quoteExpiresAt?: Date | null
  // Billing cycle
  billingCycleType?: BillingCycleType
  billingCycleDay?: number
  billingCycleDays?: number
  isRecurring?: boolean
  // Discount & Tax
  discountType?: 'PERCENTAGE' | 'FIXED'
  discountValue?: number
  taxRate?: number
  // Delivery & Return
  deliveryMethod?: string
  deliveryAddress?: string
  deliveryDate?: Date
  deliveryCost?: number
  deliveryCourier?: string
  deliveryNotes?: string
  returnMethod?: string
  returnDate?: Date
  returnCost?: number
  shippingMarginType?: string
  shippingMargin?: number
  returnCourier?: string
  deliveryTrackingProvider?: string
  deliveryTrackingNumber?: string
  returnTrackingProvider?: string
  returnTrackingNumber?: string
  // Internal costs
  internalShippingCost?: number
  subRentalCost?: number
  hardwareCost?: number
  // Billing override
  notBilled?: boolean
  paymentTerms?: number
  // Rent-to-own: the agreed term. The monthly payment and buyout are derived
  // from it and the order total rather than typed, so they cannot disagree with
  // what the order actually costs. Ignored on every other type.
  rtoTermMonths?: number
  // Flow: the term and the pricing knobs (v1). A knob left blank takes the house
  // default (Settings, lib/flow/defaults.ts). The money is never taken from here:
  // lib/flow/reprice.ts derives every rate and total. Ignored on every other type.
  flowTermMonths?: number
  flowMarginPct?: number
  flowFinancePct?: number
  flowPurchaseTaxPct?: number
  flowTaxExempt?: boolean
  flowRecoverByMonth?: number
  flowDeprPct?: number
  flowLifeMonths?: number
  /** From month 13 on, pay this % of the year-one payment. Null = the engine's shape. */
  flowStepPct?: number | null
  // Action tracking (e.g. from builder)
  actionRequired?: boolean
  actionRequiredNote?: string
  items: {
    // Client-side stable id used only to wire up parent/child within this submission.
    // Ignored on persistence — the DB assigns cuids.
    uid?: string | null
    // The existing line this row edits, when it edits one. Flow matches on it to
    // carry the line's cost basis and co-term month forward (else it matches by asset).
    id?: string | null
    parentUid?: string | null
    assetId?: string | null
    serviceId?: string | null
    cloudProductId?: string | null
    description?: string | null
    category?: string | null
    pricingType: PricingType
    rate: number
    quantity?: number
    isOneTime?: boolean
    notes?: string | null
    costBasis?: number | null
    marginPercent?: number | null
    // Cloud host only: specific asset units (tags) to reserve as backing hardware.
    backingAssetUnitIds?: string[] | null
    // Flow only: the month a co-termed line joined the subscription.
    flowAddedAtMonth?: number | null
  }[]
}

// Pick the most appropriate "general rate" for an asset when adding it ad hoc to
// an order — prefers monthly, then weekly, then daily. Returns a $0/DAILY only if
// every rate field is null. Used by checkoutByBarcode and the orphan-checkout
// repair tooling so we never insert blank $0 placeholder lines.
function pickAssetGeneralRate(asset: {
  monthlyRate?: unknown
  weeklyRate?: unknown
  dailyRate?: unknown
}): { rate: number; pricingType: 'DAILY' | 'WEEKLY' | 'MONTHLY' } {
  const monthly = Number(asset.monthlyRate ?? 0)
  if (monthly > 0) return { rate: monthly, pricingType: 'MONTHLY' }
  const weekly = Number(asset.weeklyRate ?? 0)
  if (weekly > 0) return { rate: weekly, pricingType: 'WEEKLY' }
  const daily = Number(asset.dailyRate ?? 0)
  return { rate: daily, pricingType: 'DAILY' }
}

// Number of billing periods an item covers over the reservation's date range.
// Fractional by design — see src/lib/pricing/periods.ts for the proration rules.
const calculatePeriodsSync = calculateTermPeriods

// Exported async wrapper for use from other 'use server' modules
export async function calculatePeriods(startDate: Date, endDate: Date, pricingType: string, isRecurring?: boolean): Promise<number> {
  return calculatePeriodsSync(startDate, endDate, pricingType, isRecurring)
}

// Recalculate RTO monthly payment when totals change
async function maybeRecalcRto(tx: TxClient, reservationId: string, newTotal: number): Promise<void> {
  const res = await tx.reservation.findUnique({
    where: { id: reservationId },
    select: { reservationType: true, rtoTermMonths: true },
  })
  if (res?.reservationType === 'RENT_TO_OWN' && res.rtoTermMonths && newTotal > 0) {
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        rtoMonthlyPayment: newTotal / res.rtoTermMonths,
        rtoBuyoutPrice: newTotal,
      },
    })
  }
}

// Flow: every line change re-derives the whole order (v1's maybeRecalcFlow). A
// no-op for other types; throws, rolling the caller's transaction back, when the
// changed order can't be priced.
async function maybeRecalcFlow(tx: Prisma.TransactionClient, reservationId: string): Promise<void> {
  await repriceFlowTx(tx, reservationId)
}

// Flow's term lock (v1): its terms, bases and step can't change once anything has
// been billed, or once the client has agreed (a revision request reopens them).
function assertFlowTermsOpen(
  r: { flowPeriodsBilled: number | null; flowTermsSnapshot: unknown },
  what: 'terms' | 'pricing' | 'schedule' | 'cost basis' | 'co-term months',
): void {
  if ((r.flowPeriodsBilled ?? 0) > 0) {
    throw new Error(`This Flow order has already been billed — its ${what} can no longer change.`)
  }
  if (r.flowTermsSnapshot != null) {
    throw new Error("This Flow order's terms were agreed by the client — request a revision to change them.")
  }
}

// Auto-generate invoice when all items are fully checked out
async function maybeAutoInvoice(tx: TxClient, reservationId: string): Promise<boolean> {
  // Check if all physical items are fully checked out. Component rows (parentId set)
  // are pricing line-items only, so they don't count against checkout status.
  const allItems = await tx.reservationItem.findMany({
    where: { reservationId, parentId: null },
  })

  const allCheckedOut = allItems.every((item) => item.checkedOutCount >= item.quantity)
  if (!allCheckedOut) return false

  // Fetch reservation with items and client for invoice creation
  const reservation = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      // Ordered so the already-billed fallback below consumes lines predictably.
      // Every line, with its package's state: which option was chosen is
      // decided here (autoInvoiceScope), not in the query.
      items: {
        include: { asset: true, package: { select: { isActive: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
      packages: ACTIVE_PACKAGE_SHIPPING,
    },
  })
  if (!reservation) return false

  // Flow bills from its schedule, which is not wired into invoicing yet.
  if (reservation.reservationType === 'FLOW') return false

  // Skip invoicing for not-billed reservations (eval, gifted, etc.)
  if (reservation.notBilled) return false

  // Skip invoicing for zero-dollar deals (no value to bill)
  const itemsTotal = reservation.items.reduce((sum, i) => sum + Number(i.subtotal), 0)
  if (itemsTotal <= 0) return false

  // Calculate due date from reservation payment terms (falls back to client default)
  const paymentTerms = reservation.paymentTerms ?? reservation.client.paymentTerms ?? 30
  const dueDate = addDays(new Date(), paymentTerms)
  const resTaxRate = Number(reservation.taxRate) || 0
  const notes = reservation.projectName ? `Project: ${reservation.projectName}` : undefined

  // A recurring rental's first stretch is priced the way the billing run and the
  // manual first invoice price it (lib/billing/cycle-invoice): from the term
  // start up to the next billing date, with the discount, one-time lines and
  // delivery. It is stamped periodNumber 1, so none of those paths bills the
  // first stretch's one-time charges again. "First" is no prior cycle invoice
  // (lib/billing/first-cycle), counted here inside the same transaction.
  const recurringRental = reservation.isRecurring && ['RENTAL', 'CLOUD'].includes(reservation.reservationType)
  if (recurringRental && (await tx.invoice.count({ where: priorCycleInvoiceWhere(reservationId) })) === 0) {
    const stretch = firstInvoiceStretch(reservation, await getBillingAnchor())
    const { priced, lines } = firstCycleAutoInvoice({
      items: reservation.items,
      share: stretch?.periods ?? 1,
      terms: cycleTermsForOrder(reservation),
      shareNote: firstStretchNote(stretch),
    })
    if (lines.length === 0) return false

    const createdInvoice = await tx.invoice.create({
      data: {
        invoiceNumber: await nextNumber('invoice', tx),
        clientId: reservation.clientId,
        reservationId: reservation.id,
        issueDate: new Date(),
        dueDate,
        subtotal: priced.subtotal,
        taxRate: resTaxRate,
        taxAmount: priced.taxAmount,
        total: priced.total,
        status: 'DRAFT',
        notes,
        periodNumber: 1,
        ...(stretch ? { periodStartDate: stretch.start, periodEndDate: stretch.end } : {}),
      },
    })
    // Two passes so a billed child can nest under its billed parent.
    const resItemIdToInvoiceItemId = new Map<string, string>()
    for (const pass of [false, true]) {
      for (const line of lines) {
        if (!!line.parentReservationItemId !== pass) continue
        const created = await tx.invoiceItem.create({
          data: {
            invoiceId: createdInvoice.id,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
            assetId: line.assetId || undefined,
            reservationItemId: line.reservationItemId,
            parentId: line.parentReservationItemId ? resItemIdToInvoiceItemId.get(line.parentReservationItemId) ?? null : null,
          },
        })
        if (line.reservationItemId) resItemIdToInvoiceItemId.set(line.reservationItemId, created.id)
      }
    }

    await tx.reservation.update({
      where: { id: reservationId },
      data: { lastBilledDate: new Date() },
    })
    return true
  }

  // Everything else — a one-time rental, a sale, rent-to-own, or a recurring
  // rental whose first stretch is already invoiced — bills the lines not yet on
  // an invoice at their stored subtotals.

  // Check existing invoices (excluding voided/canceled) to avoid double-billing
  const existingInvoices = await tx.invoice.findMany({
    where: {
      reservationId,
      status: { notIn: ['VOID', 'CANCELLED'] },
    },
    include: { items: true },
  })

  // Determine what has already been invoiced. Match on the order line itself, since
  // the same asset can legitimately sit on several lines at different rates. Two
  // cases can't match by id: invoices written before reservationItemId existed, and
  // lines whose ids were regenerated by an order edit (updateReservation recreates
  // them). Those fall back to consuming one same-asset line each, which is exactly
  // the old asset-level behavior back when an asset could only appear once.
  const existingInvoiceItems = existingInvoices.flatMap((inv) => inv.items)
  const liveItemIds = new Set(reservation.items.map((item) => item.id))
  const invoicedItemIds = new Set(
    existingInvoiceItems
      .map((item) => item.reservationItemId)
      .filter((itemId): itemId is string => !!itemId && liveItemIds.has(itemId))
  )
  const unmatchedCountByAsset = new Map<string, number>()
  for (const invItem of existingInvoiceItems) {
    if (invItem.reservationItemId && liveItemIds.has(invItem.reservationItemId)) continue
    if (!invItem.assetId) continue
    unmatchedCountByAsset.set(invItem.assetId, (unmatchedCountByAsset.get(invItem.assetId) || 0) + 1)
  }

  // Filter to only uninvoiced items. The scope leaves out lines of quote options
  // the client didn't choose, parts included in a system's price, and cloud-host
  // component children (hidden config rows — the invoice shows just the
  // cloud-host summary line).
  const uninvoicedItems = autoInvoiceScope(reservation.items).filter((item) => {
    if (invoicedItemIds.has(item.id)) return false
    if (item.assetId) {
      const alreadyBilled = unmatchedCountByAsset.get(item.assetId) || 0
      if (alreadyBilled > 0) {
        unmatchedCountByAsset.set(item.assetId, alreadyBilled - 1)
        return false
      }
    }
    return true
  })

  if (uninvoicedItems.length === 0) return false

  // Generate invoice number (pattern: Settings → Business → Numbering)
  const invoiceNumber = await nextNumber('invoice', tx)

  // Build line items from uninvoiced items only (use stored subtotals which include term periods)
  let subtotal = 0
  const buildLine = (item: (typeof uninvoicedItems)[number]) => {
    const periods = calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
    // Terms rarely land on whole periods, so spell out both the multiplier and the
    // plain-English term (e.g. "x 1.38 monthly — 6 weeks") on the invoice line.
    const periodLabel = periods > 1
      ? ` x ${formatPeriodCount(periods)} ${item.pricingType.toLowerCase()} — ${formatTermLength(reservation.startDate, reservation.endDate)}`
      : ''
    return {
      description: `${item.asset?.name || item.description || 'Ad-hoc item'} (${item.pricingType} rate${periodLabel})`,
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.rate),
      amount: Number(item.subtotal),
      assetId: item.assetId || undefined,
      reservationItemId: item.id,
    }
  }
  for (const item of uninvoicedItems) subtotal += Number(item.subtotal)

  // Inherit tax rate from reservation
  const taxAmount = subtotal * (resTaxRate / 100)
  const invoiceTotal = subtotal + taxAmount

  // Create invoice + nested items (two-pass so children can reference parent InvoiceItem ids)
  const createdInvoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      clientId: reservation.clientId,
      reservationId: reservation.id,
      issueDate: new Date(),
      dueDate,
      subtotal,
      taxRate: resTaxRate,
      taxAmount,
      total: invoiceTotal,
      status: 'DRAFT',
      notes,
    },
  })
  const resItemIdToInvoiceItemId = new Map<string, string>()
  for (const item of uninvoicedItems) {
    if (item.parentId) continue
    const created = await tx.invoiceItem.create({
      data: { invoiceId: createdInvoice.id, ...buildLine(item), parentId: null },
    })
    resItemIdToInvoiceItemId.set(item.id, created.id)
  }
  for (const item of uninvoicedItems) {
    if (!item.parentId) continue
    // If parent is on a different (prior) invoice, or is filtered out, skip nesting — render flat.
    const parentInvoiceItemId = resItemIdToInvoiceItemId.get(item.parentId) || null
    const created = await tx.invoiceItem.create({
      data: { invoiceId: createdInvoice.id, ...buildLine(item), parentId: parentInvoiceItemId },
    })
    resItemIdToInvoiceItemId.set(item.id, created.id)
  }

  // Update lastBilledDate on reservation
  await tx.reservation.update({
    where: { id: reservationId },
    data: { lastBilledDate: new Date() },
  })

  return true
}

export type ReservationFilters = {
  search?: string
  status?: ReservationStatus
  clientId?: string
  startDate?: Date
  endDate?: Date
  overdue?: boolean
  reservationType?: 'RENTAL' | 'RENT_TO_OWN' | 'FLOW'
}

// Generate unique reservation/sale number
// The pattern is a business setting (Settings → Business → Numbering).
export async function generateReservationNumber(type: ReservationType = 'RENTAL'): Promise<string> {
  return nextNumber(kindForOrderType(type))
}

export async function getReservations(filters: ReservationFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, clientId, startDate, endDate, overdue, reservationType } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    reservationType: reservationType ? reservationType : { in: ['RENTAL', 'RENT_TO_OWN', 'FLOW'] },
  }

  if (search) {
    where.OR = [
      { reservationNumber: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { client: { companyName: { contains: search, mode: 'insensitive' } } },
      { projectName: { contains: search, mode: 'insensitive' } },
      { projectCode: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (status) {
    where.status = status
  }

  if (clientId) {
    where.clientId = clientId
  }

  if (overdue) {
    where.endDate = { lt: new Date() }
    where.items = { some: { checkedOutCount: { gt: 0 } } }
  }

  if (startDate || endDate) {
    where.AND = []
    if (startDate) {
      where.AND.push({ endDate: { gte: startDate } })
    }
    if (endDate) {
      where.AND.push({ startDate: { lte: endDate } })
    }
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: {
      client: true,
      items: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
        },
      },
      _count: {
        select: {
          checkouts: true,
          invoices: true,
        },
      },
    },
    orderBy: { startDate: 'desc' },
  })

  return serialize(reservations)
}

/**
 * Get pipeline metrics for rental reservations, grouped by status buckets.
 */
export async function getRentalPipelineMetrics() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const results = await prisma.reservation.groupBy({
    by: ['status'],
    where: { reservationType: { in: ['RENTAL', 'RENT_TO_OWN', 'FLOW'] } },
    _sum: { total: true },
    _count: true,
  })

  const buckets: Record<string, { count: number; total: number }> = {}
  for (const row of results) {
    buckets[row.status] = {
      count: row._count,
      total: row._sum.total ? Number(row._sum.total) : 0,
    }
  }

  const get = (statuses: string[]) => {
    let count = 0, total = 0
    for (const s of statuses) {
      if (buckets[s]) { count += buckets[s].count; total += buckets[s].total }
    }
    return { count, total }
  }

  return {
    draft: get(['DRAFT']),
    quoted: get(['QUOTE_SENT', 'REVISION']),
    approved: get(['APPROVED']),
    active: get(['PREPARING', 'SHIPPED', 'ACTIVE']),
    completed: get(['COMPLETED']),
  }
}

export async function getReservation(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      client: true,
      packages: {
        include: {
          items: {
            include: {
              asset: { include: { category: true } },
              units: { include: { assetUnit: true } },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      items: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
          units: {
            include: {
              assetUnit: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      checkouts: {
        include: {
          assetUnit: {
            include: {
              asset: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          checkedInBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { checkoutDate: 'desc' },
      },
      invoices: {
        orderBy: { createdAt: 'desc' },
      },
      preparedBy: {
        select: { id: true, name: true },
      },
    },
  })

  // Flow orders only (v1): the subscription terms addendum — the frozen snapshot
  // once approved, otherwise a live render — and the settings' extension default.
  const isFlow = reservation?.reservationType === 'FLOW'
  const flowTerms = isFlow
    ? await flowTermsForReservation(id).catch((e) => {
        console.error('Flow terms unavailable for', id, e)
        return null
      })
    : null
  const flowExtensionDefaultPct = isFlow ? (await loadFlowTermsSettings()).extensionPct : undefined

  const serialized = serialize(reservation)
  return serialized ? { ...serialized, flowTerms: flowTerms ?? undefined, flowExtensionDefaultPct } : serialized
}

export async function createReservation(input: ReservationFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Calendar days before anything prices or schedules against them, so the term
  // that is priced is the term that is stored.
  // A sale has no term (owner, 2026-09-16): its end date is its order date, so
  // nothing downstream can read a "deliver by" as a term or a return.
  const startDate = intendedDay(input.startDate)
  const isFlow = input.reservationType === 'FLOW'
  // Not merely "positive": termMonths drives O(termMonths) loops through the Flow
  // pricing engine, so it must be one of the lengths the builder offers.
  const flowTerm = isFlow ? assertFlowTerm(Math.round(Number(input.flowTermMonths) || 0)) : null
  const data: ReservationFormData = {
    ...input,
    startDate,
    // A Flow order runs exactly its term; the repricer stores the same end date.
    endDate: input.reservationType === 'SALE' ? startDate
      : flowTerm ? addTermMonths(startDate, flowTerm)
      : intendedDay(input.endDate),
  }

  const reservationNumber = await generateReservationNumber(data.reservationType || 'RENTAL')

  // Calculate totals (term-based: rate × quantity × periods, or rate × quantity for one-time)
  // A one-time billing cycle is non-recurring by definition, so it bills the full
  // term (monthly rate × months) rather than a single cycle.
  // Recurring is derived from the type and the cycle (lib/orders/recurring.ts),
  // never taken from the caller: nothing that builds an order sent it.
  const effectiveCycle = data.reservationType === 'SALE' ? 'ONE_TIME'
    : data.reservationType === 'RENT_TO_OWN' || data.reservationType === 'FLOW' ? 'MONTHLY'
    : (data.billingCycleType || 'MONTHLY')
  const effectiveIsRecurring = recurringFor(data.reservationType || 'RENTAL', effectiveCycle)
  let subtotal = 0
  const itemsWithSubtotals = data.items.map((item) => {
    const quantity = item.quantity || 1
    const periods = item.isOneTime ? 1 : calculatePeriodsSync(data.startDate, data.endDate, item.pricingType, effectiveIsRecurring)
    const itemSubtotal = computeItemSubtotal(item.rate, quantity, periods)
    subtotal += itemSubtotal
    return {
      ...item,
      quantity,
      subtotal: itemSubtotal,
    }
  })

  // Billing cycle configuration
  const billingCycleType = data.billingCycleType || 'MONTHLY'
  // Monthly billing always uses the 1st of the month
  const billingCycleDay = billingCycleType === 'MONTHLY' ? 1 : (data.billingCycleDay ?? 1)
  const billingCycleDays = data.billingCycleDays

  // Calculate next billing date
  const nextBillingDate = calculateNextBillingDate(
    data.startDate,
    billingCycleType,
    billingCycleDay,
    billingCycleDays,
    await getBillingAnchor()
  )

  // Tax rate: prefer explicit form value, fall back to location lookup
  let taxRate = data.taxRate ?? 0
  if (data.taxRate === undefined || data.taxRate === null) {
    const firstAssetItem = data.items.find((i) => i.assetId)
    if (firstAssetItem?.assetId) {
      const firstAssetUnit = await prisma.assetUnit.findFirst({
        where: { assetId: firstAssetItem.assetId },
        include: { location: true },
      })
      if (firstAssetUnit?.location?.taxRate) {
        taxRate = Number(firstAssetUnit.location.taxRate)
      }
    }
  }

  const { discountAmount, taxAmount, total } = calculateReservationTotals({
    itemsSubtotal: subtotal,
    discountType: data.discountType,
    discountValue: data.discountValue,
    taxRate,
    deliveryCost: data.deliveryCost,
    returnCost: data.returnCost,
    shippingMarginType: data.shippingMarginType,
    shippingMargin: data.shippingMargin,
  })

  // Flow (v1): an asset line's true cost is derived here from its units' landed
  // cost — the caller's trueCost/costBasis are not trusted. The basis may be raised
  // but never sits below true cost. A line whose units are not fully costed is
  // refused before anything is written.
  const flowBasisByAsset: Record<string, number> = {}
  if (isFlow) {
    const assetItems = data.items.filter((i) => i.assetId)
    const bases = await loadFlowBases(prisma, assetItems.map((i) => i.assetId!))
    for (const item of assetItems) {
      const snap = flowSnapshotLineCost({ trueCost: null, costBasis: null }, bases[item.assetId!], item.description || 'A line')
      if (!snap.ok) throw new Error(snap.error)
      flowBasisByAsset[item.assetId!] = snap.cost.trueCost
    }
  }

  // Flow: the knobs are fixed at birth. A blank knob takes the house default now,
  // once, and the order stores the concrete value, so a later Settings change can
  // never reprice it (the repricer reads only the order's own knobs). Resolved
  // before the transaction: no global-client reads inside an open one. The step
  // stays null when blank — null is the recoverByMonth-shaped schedule, not a gap.
  const flowKnobs = isFlow
    ? applyFlowDefaults({
        flowMarginPct: data.flowMarginPct ?? null,
        flowFinancePct: data.flowFinancePct ?? null,
        flowPurchaseTaxPct: data.flowPurchaseTaxPct ?? null,
        flowTaxExempt: data.flowTaxExempt ?? null,
        flowRecoverByMonth: data.flowRecoverByMonth ?? null,
        flowDeprPct: data.flowDeprPct ?? null,
        flowLifeMonths: data.flowLifeMonths ?? null,
      }, await loadFlowDefaults(prisma))
    : null
  // The same bounds the builder's form shows, checked here too: any caller can
  // reach this action, and the pricing engine trusts the stored knobs.
  if (flowKnobs) {
    const knobProblem = flowOrderKnobsProblem({ ...flowKnobs, flowStepPct: data.flowStepPct ?? null }, flowTerm)
    if (knobProblem) throw new Error(knobProblem)
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const res = await tx.reservation.create({
      data: {
        reservationNumber,
        clientId: data.clientId,
        reservationType: data.reservationType || 'RENTAL',
        // Order dates are calendar days at noon UTC (lib/billing/calendar), whatever
        // shape the caller sent — a date input, a v1 payload or a raw timestamp.
        startDate: data.startDate,
        endDate: data.endDate,
        projectName: data.projectName,
        projectCode: data.projectCode,
        notes: data.notes,
        internalNotes: data.internalNotes,
        subtotal,
        discountType: (data.discountType || null) as any,
        discountValue: data.discountValue ?? 0,
        discountAmount,
        taxRate,
        taxAmount,
        total,
        status: 'DRAFT',
        actionRequired: data.actionRequired || false,
        actionRequiredNote: data.actionRequiredNote || null,
        createdById: authResult.userId,
        // Billing cycle
        billingCycleType: data.reservationType === 'SALE' ? 'ONE_TIME'
          : data.reservationType === 'RENT_TO_OWN' || data.reservationType === 'FLOW' ? 'MONTHLY'
          : billingCycleType,
        billingCycleDay,
        billingCycleDays,
        // A sale bills once; a Flow order is billed from its schedule, never by the
        // billing run, so neither carries a next billing date.
        nextBillingDate: data.reservationType === 'SALE' || isFlow ? null : nextBillingDate,
        isRecurring: effectiveIsRecurring,
        notBilled: data.notBilled || false,
        paymentTerms: data.paymentTerms ?? null,
        // Rent-to-Own fields — monthly payment based on total (incl. tax/fees)
        ...(data.reservationType === 'RENT_TO_OWN' ? {
          rtoTermMonths: data.rtoTermMonths || null,
          rtoMonthlyPayment: data.rtoTermMonths ? total / data.rtoTermMonths : null,
          rtoBuyoutPrice: total,
          rtoInstallmentsPaid: 0,
          rtoDefaultCount: 0,
        } : {}),
        // Flow — a term subscription on owned stock. Monthly and recurring like RTO,
        // but the rate steps at each anniversary, so flowMonthlyPayment is the CURRENT
        // period's rate. The money columns (and every line rate) are derived by
        // repriceFlowTx once the lines exist, below — never taken from the caller.
        ...(isFlow ? {
          flowTermMonths: flowTerm,
          flowContractValue: null,
          flowMonthlyPayment: null,
          flowStartDate: data.startDate,
          flowPeriodsBilled: 0,
          flowMarginPct: flowKnobs!.flowMarginPct,
          flowFinancePct: flowKnobs!.flowFinancePct,
          flowPurchaseTaxPct: flowKnobs!.flowPurchaseTaxPct,
          flowTaxExempt: flowKnobs!.flowTaxExempt ?? true, // always filled; the column is non-null
          flowRecoverByMonth: flowKnobs!.flowRecoverByMonth,
          flowDeprPct: flowKnobs!.flowDeprPct,
          flowLifeMonths: flowKnobs!.flowLifeMonths,
          flowStepPct: data.flowStepPct ?? null,
        } : {}),
        // Delivery & Return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deliveryMethod: (data.deliveryMethod || null) as any,
        deliveryAddress: data.deliveryAddress || null,
        deliveryDate: data.deliveryDate || null,
        deliveryCost: data.deliveryCost ?? null,
        deliveryCourier: data.deliveryCourier || null,
        deliveryNotes: data.deliveryNotes || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        returnMethod: (data.returnMethod || null) as any,
        returnDate: data.returnDate || null,
        returnCost: data.returnCost ?? null,
        shippingMarginType: data.shippingMarginType || null,
        shippingMargin: data.shippingMargin ?? null,
        returnCourier: data.returnCourier || null,
        deliveryTrackingProvider: data.deliveryTrackingProvider || null,
        deliveryTrackingNumber: data.deliveryTrackingNumber || null,
        returnTrackingProvider: data.returnTrackingProvider || null,
        returnTrackingNumber: data.returnTrackingNumber || null,
        // Internal costs
        internalShippingCost: data.internalShippingCost ?? null,
        subRentalCost: data.subRentalCost ?? null,
        hardwareCost: data.hardwareCost ?? null,
      },
    })

    // Create default package and link items to it
    const defaultPackage = await tx.package.create({
      data: { reservationId: res.id, name: 'Default', isActive: true, sortOrder: 0 },
    })

    // For SALE items, look up avg purchase price as cost basis
    const isSale = (data.reservationType || 'RENTAL') === 'SALE'
    const costBasisMap: Record<string, number> = {}
    if (isSale && itemsWithSubtotals.some((i) => i.assetId)) {
      const assetIds = itemsWithSubtotals
        .filter((i) => i.assetId)
        .map((i) => i.assetId!)
      const avgCosts = await tx.assetUnit.groupBy({
        by: ['assetId'],
        where: { assetId: { in: assetIds }, purchasePrice: { not: null } },
        _avg: { purchasePrice: true },
      })
      for (const row of avgCosts) {
        if (row._avg.purchasePrice != null) {
          costBasisMap[row.assetId] = Number(row._avg.purchasePrice)
        }
      }
    }

    // Two-pass create so child items can reference their parent's DB id.
    // First pass: top-level items (parentUid is null). Second pass: components.
    const uidToDbId = new Map<string, string>()
    if (itemsWithSubtotals.length > 0) {
      const reservationType = data.reservationType || 'RENTAL'
      const buildRow = (item: typeof itemsWithSubtotals[number], index: number, parentId: string | null) => {
        const autoCost = isSale && item.assetId && costBasisMap[item.assetId] != null
          ? costBasisMap[item.assetId]
          : null
        const rate = isSale && item.rate === 0 && autoCost != null && autoCost > 0
          ? autoCost
          : item.rate
        const itemSubtotal = rate * item.quantity
        const isService = !!item.serviceId
        const isCloudProduct = !!item.cloudProductId
        const explicitCost = item.costBasis != null && item.costBasis >= 0 ? Number(item.costBasis) : null
        // Drop nonsensical margins for rentals & clamp sale margins into Decimal(5,2) bounds.
        const safeMargin = sanitizeMarginPercent(item.marginPercent ?? null, reservationType)
        const flowCost = isFlow && item.assetId && flowBasisByAsset[item.assetId] != null
          ? flowCreateLineCost(explicitCost, flowBasisByAsset[item.assetId])
          : null
        return {
          reservationId: res.id,
          packageId: defaultPackage.id,
          assetId: item.assetId || null,
          serviceId: item.serviceId || null,
          cloudProductId: item.cloudProductId || null,
          description: item.description || null,
          category: isService
            ? 'Service'
            : isCloudProduct
              ? (item.category || 'Cloud')
              : ((!item.assetId && item.category) ? item.category : null),
          pricingType: isService ? 'PROJECT' : item.pricingType,
          rate,
          quantity: item.quantity,
          subtotal: itemSubtotal,
          isOneTime: isService ? true : (item.isOneTime || false),
          notes: item.notes || null,
          sortOrder: index,
          parentId,
          ...(safeMargin != null ? { marginPercent: safeMargin } : {}),
          ...(isService
            ? { costBasis: 0 }
            : flowCost
              ? { costBasis: flowCost.costBasis, trueCost: flowCost.trueCost }
            : explicitCost != null
              ? { costBasis: explicitCost }
              : autoCost != null
                ? { costBasis: autoCost }
                : {}),
          ...(isFlow && item.flowAddedAtMonth != null ? { flowAddedAtMonth: item.flowAddedAtMonth } : {}),
        }
      }

      for (let i = 0; i < itemsWithSubtotals.length; i++) {
        const item = itemsWithSubtotals[i]
        if (item.parentUid) continue
        const created = await tx.reservationItem.create({ data: buildRow(item, i, null) })
        if (item.uid) uidToDbId.set(item.uid, created.id)
      }
      for (let i = 0; i < itemsWithSubtotals.length; i++) {
        const item = itemsWithSubtotals[i]
        if (!item.parentUid) continue
        const parentId = uidToDbId.get(item.parentUid) || null
        // If parent uid didn't resolve (shouldn't happen), drop to top-level rather than fail.
        const created = await tx.reservationItem.create({ data: buildRow(item, i, parentId) })
        if (item.uid) uidToDbId.set(item.uid, created.id)
      }

      // Reserve backing hardware (asset tags) for any cloud host that specified them.
      for (const item of itemsWithSubtotals) {
        if (item.parentUid) continue
        if (!item.backingAssetUnitIds || item.backingAssetUnitIds.length === 0) continue
        const dbId = item.uid ? uidToDbId.get(item.uid) : null
        if (!dbId) continue
        await allocateSpecificUnitsForCloudHost(tx, dbId, item.backingAssetUnitIds)
      }
    }

    // Recalculate totals and margin from actual item rates
    {
      const createdItems = await tx.reservationItem.findMany({
        where: { reservationId: res.id },
      })
      let actualSubtotal = 0
      let itemCost = 0
      for (const item of createdItems) {
        actualSubtotal += Number(item.subtotal)
        const cost = item.costBasis != null ? Number(item.costBasis) : 0
        itemCost += cost * item.quantity
      }
      const internalCosts = (data.internalShippingCost || 0) + (data.subRentalCost || 0) + (data.hardwareCost || 0)
      const totalCost = itemCost + internalCosts
      const totalMargin = actualSubtotal - totalCost
      const { discountAmount: da, taxAmount: ta, total: t } = calculateReservationTotals({
        itemsSubtotal: actualSubtotal,
        discountType: data.discountType,
        discountValue: data.discountValue,
        taxRate,
        deliveryCost: data.deliveryCost,
        returnCost: data.returnCost,
        shippingMarginType: data.shippingMarginType,
        shippingMargin: data.shippingMargin,
      })
      await tx.reservation.update({
        where: { id: res.id },
        data: { subtotal: actualSubtotal, discountAmount: da, taxAmount: ta, total: t, totalCost, totalMargin },
      })
    }

    // Flow: re-derive line rates and totals from cost basis; refuses (and rolls the
    // whole create back) when a line is unpriced or the schedule is infeasible.
    if (isFlow) await repriceFlowTx(tx, res.id)

    return tx.reservation.findUnique({
      where: { id: res.id },
      include: { client: true, items: { include: { asset: true } } },
    })
  })

  if (!reservation) throw new Error('Failed to create reservation')

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservation.id,
      fromStatus: null,
      toStatus: 'DRAFT',
      changedById: authResult.userId,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/orders')
  revalidatePath('/dashboard')

  return serialize(reservation)
}

export async function updateReservation(id: string, input: Partial<ReservationFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Calendar days before anything reprices against them (see createReservation).
  const data: Partial<ReservationFormData> = {
    ...input,
    ...(input.startDate ? { startDate: intendedDay(input.startDate) } : {}),
    ...(input.endDate ? { endDate: intendedDay(input.endDate) } : {}),
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const existingReservation = await tx.reservation.findUnique({
      where: { id },
      include: { items: true, packages: true },
    })

    if (!existingReservation) {
      throw new Error('Reservation not found')
    }

    // Allow updates on editable reservations
    if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'].includes(existingReservation.status)) {
      throw new Error('Can only edit draft, revision, or active reservations')
    }

    // An order can't switch into or out of Flow (v1 01a81f5): a Flow order is
    // priced and scheduled from its own columns, which no other type carries.
    if (
      data.reservationType !== undefined &&
      data.reservationType !== existingReservation.reservationType &&
      (data.reservationType === 'FLOW' || existingReservation.reservationType === 'FLOW')
    ) {
      throw new Error("An order can't be switched into or out of Flow. Create a new order instead.")
    }

    // Flow's term and pricing knobs lock once the client has agreed or anything
    // has been billed (v1). Lines stay editable; each save reprices the order.
    const isFlowOrder = existingReservation.reservationType === 'FLOW'
    if (isFlowOrder) {
      const changesTerms = [data.flowTermMonths, data.flowMarginPct, data.flowFinancePct, data.flowPurchaseTaxPct,
        data.flowTaxExempt, data.flowRecoverByMonth, data.flowDeprPct, data.flowLifeMonths, data.flowStepPct]
        .some((x) => x !== undefined)
      if (changesTerms) assertFlowTermsOpen(existingReservation, 'terms')
    }

    // Find the active package (scope item operations to it)
    const activePackage = existingReservation.packages.find((p) => p.isActive)

    // Calculate new totals if items changed (term-based: rate × quantity × periods)
    const effectiveStartDate = data.startDate ?? existingReservation.startDate
    const effectiveEndDate = data.endDate ?? existingReservation.endDate
    // A one-time billing cycle is always non-recurring — it bills the full term
    // once (monthly rate × months) rather than a single cycle.
    const effectiveBillingCycle = data.billingCycleType ?? existingReservation.billingCycleType
    const derivedRecurring = recurringFor(data.reservationType ?? existingReservation.reservationType, effectiveBillingCycle)
    let subtotal = Number(existingReservation.subtotal)
    const updateCostBasisMap: Record<string, number> = {}
    if (data.items) {
      subtotal = 0
      const itemsWithSubtotals = data.items.map((item) => {
        const quantity = item.quantity || 1
        const effectiveRecurring = derivedRecurring
        const periods = item.isOneTime ? 1 : calculatePeriodsSync(effectiveStartDate, effectiveEndDate, item.pricingType, effectiveRecurring)
        const itemSubtotal = computeItemSubtotal(item.rate, quantity, periods)
        subtotal += itemSubtotal
        return {
          ...item,
          quantity,
          subtotal: itemSubtotal,
        }
      })

      // Delete only the active package's items (preserve other packages' items)
      await tx.reservationItem.deleteMany({
        where: { reservationId: id, ...(activePackage ? { packageId: activePackage.id } : {}) },
      })

      // For SALE updates, look up avg purchase price as cost basis for items without explicit cost
      const isSaleUpdate = (existingReservation.reservationType === 'SALE')
      if (isSaleUpdate && itemsWithSubtotals.some((i) => i.assetId)) {
        const assetIds = itemsWithSubtotals
          .filter((i) => i.assetId)
          .map((i) => i.assetId!)
        const avgCosts = await tx.assetUnit.groupBy({
          by: ['assetId'],
          where: { assetId: { in: assetIds }, purchasePrice: { not: null } },
          _avg: { purchasePrice: true },
        })
        for (const row of avgCosts) {
          if (row._avg.purchasePrice != null) {
            updateCostBasisMap[row.assetId] = Number(row._avg.purchasePrice)
          }
        }
      }

      // Two-pass create so components reference their freshly-created parent DB ids.
      const uidToDbId = new Map<string, string>()
      const isCloudUpdate = existingReservation.reservationType === 'CLOUD'
      const updateReservationType = existingReservation.reservationType
      // Flow (v1): an asset line keeps the true cost already snapshotted for that
      // asset on this order; the caller's value is not trusted. A new asset gets none
      // here and repriceFlowTx snapshots it from the landed-cost basis.
      const flowSnapshotByAsset = new Map<string, number>()
      // Flow: each incoming row is matched to the existing line it edits (by line
      // id, else by asset) so an omitted cost basis or co-term month carries
      // forward rather than silently resetting a raised basis to true cost; once
      // the order is locked (agreed or billed) a changed one is refused
      // (lib/flow/line-carry.ts).
      const flowLocked = isFlowOrder
        && ((existingReservation.flowPeriodsBilled ?? 0) > 0 || existingReservation.flowTermsSnapshot != null)
      let flowMatch = new Map<number, (typeof existingReservation.items)[number]>()
      if (isFlowOrder) {
        const lines = existingReservation.items
          .filter((e) => !activePackage || e.packageId === activePackage.id)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
        for (const existing of lines) {
          if (existing.assetId && existing.trueCost != null && !flowSnapshotByAsset.has(existing.assetId)) {
            flowSnapshotByAsset.set(existing.assetId, Number(existing.trueCost))
          }
        }
        flowMatch = matchFlowLines(itemsWithSubtotals, lines)
      }
      const buildRow = (item: typeof itemsWithSubtotals[number], index: number, parentId: string | null) => {
        let costBasis = item.costBasis != null
          ? item.costBasis
          : (isSaleUpdate && item.assetId && updateCostBasisMap[item.assetId] != null)
            ? updateCostBasisMap[item.assetId]
            : null
        const isCloudProduct = !!item.cloudProductId
        // Drop nonsensical margins for rentals & clamp sale margins into Decimal(5,2) bounds.
        const safeMargin = sanitizeMarginPercent(item.marginPercent ?? null, updateReservationType)
        let flowTrueCost: number | null = null
        let flowAddedAtMonth: number | null = null
        if (isFlowOrder) {
          const carry = carryFlowLine(
            item,
            flowMatch.get(index),
            item.assetId ? flowSnapshotByAsset.get(item.assetId) ?? null : null,
            flowLocked,
          )
          if (!carry.ok) {
            assertFlowTermsOpen(existingReservation, carry.changed)
            throw new Error(`This Flow order is locked — its ${carry.changed} can no longer change.`)
          }
          costBasis = carry.costBasis
          flowTrueCost = carry.trueCost
          flowAddedAtMonth = carry.flowAddedAtMonth
        }
        return {
          reservationId: id,
          packageId: activePackage?.id || null,
          assetId: item.assetId || null,
          serviceId: item.serviceId || null,
          cloudProductId: item.cloudProductId || null,
          description: item.description || null,
          category: isCloudProduct
            ? (item.category || 'Cloud')
            : ((!item.assetId && item.category) ? item.category : null),
          pricingType: item.pricingType,
          rate: item.rate,
          quantity: item.quantity,
          subtotal: item.subtotal,
          isOneTime: item.isOneTime || false,
          sortOrder: index,
          parentId,
          // Flow lines price off their basis, so it must survive the edit too.
          ...((isSaleUpdate || isCloudUpdate || isFlowOrder) && costBasis != null ? { costBasis } : {}),
          ...(safeMargin != null ? { marginPercent: safeMargin } : {}),
          ...(flowTrueCost != null ? { trueCost: flowTrueCost } : {}),
          ...(isFlowOrder && flowAddedAtMonth != null ? { flowAddedAtMonth } : {}),
        }
      }

      for (let i = 0; i < itemsWithSubtotals.length; i++) {
        const item = itemsWithSubtotals[i]
        if (item.parentUid) continue
        const created = await tx.reservationItem.create({ data: buildRow(item, i, null) })
        if (item.uid) uidToDbId.set(item.uid, created.id)
      }
      for (let i = 0; i < itemsWithSubtotals.length; i++) {
        const item = itemsWithSubtotals[i]
        if (!item.parentUid) continue
        const parentId = uidToDbId.get(item.parentUid) || null
        const created = await tx.reservationItem.create({ data: buildRow(item, i, parentId) })
        if (item.uid) uidToDbId.set(item.uid, created.id)
      }
    }

    // Calculate next billing date if billing settings changed
    const billingCycleType = data.billingCycleType ?? (existingReservation.billingCycleType as BillingCycleType)
    // Monthly billing always uses the 1st of the month
    const billingCycleDay = billingCycleType === 'MONTHLY' ? 1 : (data.billingCycleDay ?? existingReservation.billingCycleDay)
    const billingCycleDays = data.billingCycleDays ?? existingReservation.billingCycleDays ?? undefined
    const startDate = intendedDay(data.startDate ?? existingReservation.startDate)

    // If billing cycle changed and items were NOT re-submitted, re-price existing items
    // onto the new unit. Both halves matter: switching pricingType to WEEKLY while
    // leaving a $400 monthly rate in place bills $400/week (~4x), which is what the
    // cascade used to do — the rate has to be re-derived from the asset too.
    if (data.billingCycleType && data.billingCycleType !== existingReservation.billingCycleType && !data.items) {
      const newPricingType = pricingTypeForBillingCycle(data.billingCycleType)
      const effectiveType = data.reservationType ?? existingReservation.reservationType
      // SALE lines are one-time, RTO subtotals hold the full buyout value and a
      // Flow line's rate is its contract value, so none is re-priced off a
      // per-period asset rate.
      const repriceRates = effectiveType !== 'SALE' && effectiveType !== 'RENT_TO_OWN' && effectiveType !== 'FLOW'

      const cycleItems = await tx.reservationItem.findMany({
        where: { reservationId: id },
        include: { asset: { select: { dailyRate: true, weeklyRate: true, monthlyRate: true } } },
      })
      const effectiveStart = data.startDate ?? existingReservation.startDate
      const effectiveEnd = data.endDate ?? existingReservation.endDate
      subtotal = 0
      const effectiveRecurringForCycle = derivedRecurring

      for (const item of cycleItems) {
        // One-time add-ons keep their own pricing
        const pricingType = item.isOneTime ? item.pricingType : newPricingType
        let rate = Number(item.rate)
        // Cloud lines price off their product, not the backing asset
        if (repriceRates && !item.isOneTime && !item.cloudProductId && item.asset) {
          const derived = deriveRentalRate(item.asset, pricingType as PricingType)
          if (derived > 0) rate = derived
        }
        const periods = item.isOneTime ? 1 : calculatePeriodsSync(effectiveStart, effectiveEnd, pricingType, effectiveRecurringForCycle)
        // A part included in its system's price is not charged on its own.
        const itemSub = item.includedInParent ? 0 : computeItemSubtotal(rate, item.quantity, periods)
        // Non-active packages are alternative quote options — re-price them onto the
        // new unit, but only the active package feeds the order total.
        if (!activePackage || item.packageId === activePackage.id) subtotal += itemSub
        await tx.reservationItem.update({
          where: { id: item.id },
          data: { pricingType, rate, subtotal: itemSub },
        })
      }
    }

    // Recalculate subtotals when isRecurring or dates change (without items or billing cycle change).
    // Not for Flow: its line subtotals are contract values, re-derived by the repricer below.
    if (!isFlowOrder && !data.items && !data.billingCycleType && (data.isRecurring !== undefined || data.startDate || data.endDate)) {
      const currentItems = await tx.reservationItem.findMany({ where: { reservationId: id } })
      const effStart = data.startDate ?? existingReservation.startDate
      const effEnd = data.endDate ?? existingReservation.endDate
      const effRecurring = derivedRecurring
      subtotal = 0
      for (const item of currentItems) {
        const periods = item.isOneTime ? 1 : calculatePeriodsSync(effStart, effEnd, item.pricingType, effRecurring)
        // A part included in its system's price is not charged on its own.
        const itemSub = item.includedInParent ? 0 : computeItemSubtotal(Number(item.rate), item.quantity, periods)
        subtotal += itemSub
        await tx.reservationItem.update({
          where: { id: item.id },
          data: { subtotal: itemSub },
        })
      }
    }

    const nextBillingDate = calculateNextBillingDate(
      startDate,
      billingCycleType,
      billingCycleDay,
      billingCycleDays,
      await getBillingAnchor()
    )

    // Tax rate: prefer explicit form value, fall back to existing or location lookup
    let taxRate = data.taxRate ?? Number(existingReservation.taxRate)
    if (data.taxRate === undefined && data.items && data.items.length > 0) {
      const firstAssetItem = data.items.find((i) => i.assetId)
      if (firstAssetItem?.assetId) {
        const firstAssetUnit = await tx.assetUnit.findFirst({
          where: { assetId: firstAssetItem.assetId },
          include: { location: true },
        })
        if (firstAssetUnit?.location?.taxRate) {
          taxRate = Number(firstAssetUnit.location.taxRate)
        }
      }
    }

    // Resolve discount and delivery cost values for the calculation
    const resolvedDiscountType = data.discountType !== undefined ? (data.discountType || null) : existingReservation.discountType
    const resolvedDiscountValue = data.discountValue !== undefined ? data.discountValue : Number(existingReservation.discountValue) || 0
    const resolvedDeliveryCost = data.deliveryCost !== undefined ? data.deliveryCost : Number(existingReservation.deliveryCost) || 0
    const resolvedReturnCost = data.returnCost !== undefined ? data.returnCost : Number(existingReservation.returnCost) || 0
    const resolvedShippingMarginType = data.shippingMarginType !== undefined ? data.shippingMarginType : (existingReservation as any).shippingMarginType || null
    const resolvedShippingMargin = data.shippingMargin !== undefined ? data.shippingMargin : Number((existingReservation as any).shippingMargin) || 0

    const { discountAmount, taxAmount, total } = calculateReservationTotals({
      itemsSubtotal: subtotal,
      discountType: resolvedDiscountType,
      discountValue: resolvedDiscountValue,
      taxRate,
      deliveryCost: resolvedDeliveryCost,
      returnCost: resolvedReturnCost,
      shippingMarginType: resolvedShippingMarginType,
      shippingMargin: resolvedShippingMargin,
      rentalCreditAmount: Number(existingReservation.rentalCreditAmount) || 0,
    })

    // Recalculate margin totals (for all reservation types)
    if (data.items) {
      let itemCost = 0
      for (const item of data.items) {
        const cost = item.costBasis != null
          ? item.costBasis
          : (item.assetId && updateCostBasisMap[item.assetId] != null)
            ? updateCostBasisMap[item.assetId]
            : 0
        itemCost += cost * (item.quantity || 1)
      }
      const resolvedInternalShipping = data.internalShippingCost ?? (existingReservation.internalShippingCost != null ? Number(existingReservation.internalShippingCost) : 0)
      const resolvedSubRental = data.subRentalCost ?? (existingReservation.subRentalCost != null ? Number(existingReservation.subRentalCost) : 0)
      const resolvedHardware = data.hardwareCost ?? (existingReservation.hardwareCost != null ? Number(existingReservation.hardwareCost) : 0)
      const internalCosts = resolvedInternalShipping + resolvedSubRental + resolvedHardware
      const totalCost = itemCost + internalCosts
      Object.assign(existingReservation, { _totalCost: totalCost, _totalMargin: subtotal - totalCost })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      subtotal,
      taxRate,
      taxAmount,
      discountAmount,
      total,
      billingCycleType,
      billingCycleDay,
      billingCycleDays,
      nextBillingDate,
    }
    if (data.projectName !== undefined) updateData.projectName = data.projectName || null
    if (data.projectCode !== undefined) updateData.projectCode = data.projectCode || null
    if (data.notes !== undefined) updateData.notes = data.notes || null
    if (data.internalNotes !== undefined) updateData.internalNotes = data.internalNotes || null
    if (data.quoteExpiresAt !== undefined) updateData.quoteExpiresAt = data.quoteExpiresAt ? intendedDay(data.quoteExpiresAt) : null
    if (data.clientId !== undefined) updateData.clientId = data.clientId
    if (data.reservationType !== undefined) updateData.reservationType = data.reservationType
    if (data.startDate !== undefined) updateData.startDate = data.startDate
    if (data.endDate !== undefined) updateData.endDate = data.endDate
    // A sale has no term: whatever was sent, its end date is its order date.
    if ((data.reservationType ?? existingReservation.reservationType) === 'SALE') {
      updateData.endDate = data.startDate ?? intendedDay(existingReservation.startDate)
    }
    if (data.discountType !== undefined) updateData.discountType = data.discountType || null
    if (data.discountValue !== undefined) updateData.discountValue = data.discountValue ?? 0
    if (data.deliveryMethod !== undefined) updateData.deliveryMethod = data.deliveryMethod || null
    if (data.deliveryAddress !== undefined) updateData.deliveryAddress = data.deliveryAddress || null
    if (data.deliveryDate !== undefined) updateData.deliveryDate = data.deliveryDate || null
    if (data.deliveryCost !== undefined) updateData.deliveryCost = data.deliveryCost ?? null
    if (data.deliveryCourier !== undefined) updateData.deliveryCourier = data.deliveryCourier || null
    if (data.deliveryNotes !== undefined) updateData.deliveryNotes = data.deliveryNotes || null
    if (data.returnMethod !== undefined) updateData.returnMethod = data.returnMethod || null
    if (data.returnDate !== undefined) updateData.returnDate = data.returnDate || null
    if (data.returnCost !== undefined) updateData.returnCost = data.returnCost ?? null
    if (data.returnCourier !== undefined) updateData.returnCourier = data.returnCourier || null
    if (data.shippingMarginType !== undefined) updateData.shippingMarginType = data.shippingMarginType || null
    if (data.shippingMargin !== undefined) updateData.shippingMargin = data.shippingMargin ?? null
    if ((data as any).deliveryTrackingProvider !== undefined) updateData.deliveryTrackingProvider = (data as any).deliveryTrackingProvider || null
    if ((data as any).deliveryTrackingNumber !== undefined) updateData.deliveryTrackingNumber = (data as any).deliveryTrackingNumber || null
    if ((data as any).returnTrackingProvider !== undefined) updateData.returnTrackingProvider = (data as any).returnTrackingProvider || null
    if ((data as any).returnTrackingNumber !== undefined) updateData.returnTrackingNumber = (data as any).returnTrackingNumber || null
    if (data.notBilled !== undefined) updateData.notBilled = data.notBilled
    if (data.paymentTerms !== undefined) updateData.paymentTerms = data.paymentTerms ?? null

    // Internal costs
    if (data.internalShippingCost !== undefined) updateData.internalShippingCost = data.internalShippingCost ?? null
    if (data.subRentalCost !== undefined) updateData.subRentalCost = data.subRentalCost ?? null
    if (data.hardwareCost !== undefined) updateData.hardwareCost = data.hardwareCost ?? null

    // Rent-to-Own fields — handle existing RTO or type being changed TO RTO
    const effectiveType = data.reservationType ?? existingReservation.reservationType
    if (effectiveType === 'RENT_TO_OWN') {
      const rtoTerm = (data as any).rtoTermMonths ?? existingReservation.rtoTermMonths
      if ((data as any).rtoTermMonths !== undefined) updateData.rtoTermMonths = (data as any).rtoTermMonths
      // Monthly payment = total (incl. tax/fees) / term months
      const rtoBase = total > 0 ? total : subtotal
      if (rtoTerm && rtoBase > 0) {
        updateData.rtoMonthlyPayment = rtoBase / rtoTerm
        updateData.rtoBuyoutPrice = rtoBase
      }
      // When switching to RTO, force monthly recurring billing
      if (data.reservationType === 'RENT_TO_OWN' && existingReservation.reservationType !== 'RENT_TO_OWN') {
        updateData.billingCycleType = 'MONTHLY'
        updateData.isRecurring = true
      } else if (rtoTerm && !existingReservation.isRecurring) {
        // Existing RTO order that was never flagged recurring (e.g. created via lead
        // conversion before a term was set) — financed RTO is always monthly recurring.
        updateData.isRecurring = true
      }
    } else if (effectiveType === 'FLOW') {
      if (data.flowTermMonths !== undefined) {
        // Not merely "positive": the same O(termMonths) engine loops as createReservation.
        updateData.flowTermMonths = assertFlowTerm(Math.round(Number(data.flowTermMonths) || 0))
      }
      if (data.flowMarginPct !== undefined) updateData.flowMarginPct = data.flowMarginPct
      if (data.flowFinancePct !== undefined) updateData.flowFinancePct = data.flowFinancePct
      if (data.flowPurchaseTaxPct !== undefined) updateData.flowPurchaseTaxPct = data.flowPurchaseTaxPct
      if (data.flowTaxExempt !== undefined) updateData.flowTaxExempt = data.flowTaxExempt
      if (data.flowRecoverByMonth !== undefined) updateData.flowRecoverByMonth = data.flowRecoverByMonth
      if (data.flowDeprPct !== undefined) updateData.flowDeprPct = data.flowDeprPct
      if (data.flowLifeMonths !== undefined) updateData.flowLifeMonths = data.flowLifeMonths
      if (data.flowStepPct !== undefined) updateData.flowStepPct = data.flowStepPct
      // Bounds-check the knobs as they will be stored — what changed merged over
      // what the order already has — so a recover-by month is checked against
      // the (possibly new) term too. Only when one of them is changing, so an
      // order saved before these checks can still have its lines edited.
      const touchesKnobs = [data.flowTermMonths, data.flowMarginPct, data.flowFinancePct, data.flowPurchaseTaxPct,
        data.flowRecoverByMonth, data.flowDeprPct, data.flowLifeMonths, data.flowStepPct].some((x) => x !== undefined)
      const knobProblem = touchesKnobs && flowOrderKnobsProblem({
        flowMarginPct: data.flowMarginPct !== undefined ? data.flowMarginPct : existingReservation.flowMarginPct,
        flowFinancePct: data.flowFinancePct !== undefined ? data.flowFinancePct : existingReservation.flowFinancePct,
        flowPurchaseTaxPct: data.flowPurchaseTaxPct !== undefined ? data.flowPurchaseTaxPct : existingReservation.flowPurchaseTaxPct,
        flowRecoverByMonth: data.flowRecoverByMonth !== undefined ? data.flowRecoverByMonth : existingReservation.flowRecoverByMonth,
        flowDeprPct: data.flowDeprPct !== undefined ? data.flowDeprPct : existingReservation.flowDeprPct,
        flowLifeMonths: data.flowLifeMonths !== undefined ? data.flowLifeMonths : existingReservation.flowLifeMonths,
        flowStepPct: data.flowStepPct !== undefined ? data.flowStepPct : existingReservation.flowStepPct,
      }, (updateData.flowTermMonths as number | null | undefined) ?? existingReservation.flowTermMonths)
      if (knobProblem) throw new Error(knobProblem)
      // The subscription starts when the order does, until the first period is billed.
      if (data.startDate !== undefined && !(existingReservation.flowPeriodsBilled ?? 0)) {
        updateData.flowStartDate = data.startDate
      }
      // Billed from its schedule, never by the billing run. Line rates, totals, the
      // contract, the payment and the end date are re-derived by repriceFlowTx below.
      updateData.nextBillingDate = null
    } else if (data.reservationType === 'SALE' && existingReservation.reservationType !== 'SALE') {
      // Switching to SALE: clear RTO fields, set one-time billing
      updateData.billingCycleType = 'ONE_TIME'
      updateData.isRecurring = false
      updateData.rtoTermMonths = null
      updateData.rtoMonthlyPayment = null
      updateData.rtoBuyoutPrice = null
      updateData.flowTermMonths = null
      updateData.flowMonthlyPayment = null
      updateData.flowContractValue = null
    } else if (
      data.reservationType === 'RENTAL' &&
      (existingReservation.reservationType === 'RENT_TO_OWN' || existingReservation.reservationType === 'FLOW')
    ) {
      // Switching from a financed type to RENTAL: clear the financing columns but
      // keep billing as-is. Flow is refused above; the columns are cleared anyway
      // (v1 c1ed9cf/80ed1a5) so a rental can never carry a Flow term and rate.
      updateData.rtoTermMonths = null
      updateData.rtoMonthlyPayment = null
      updateData.rtoBuyoutPrice = null
      updateData.flowTermMonths = null
      updateData.flowMonthlyPayment = null
      updateData.flowContractValue = null
    }

    // Recurring follows the type and the cycle (lib/orders/recurring.ts) — set on
    // every save, so an order can't sit on a monthly cycle without recurring.
    updateData.isRecurring = recurringFor(
      effectiveType,
      (updateData.billingCycleType as string | undefined) ?? effectiveBillingCycle,
    )

    // Recalculate nextBillingDate if billing type was overridden by type change
    if (updateData.billingCycleType && updateData.billingCycleType !== billingCycleType) {
      const overriddenDay = updateData.billingCycleType === 'MONTHLY' ? 1 : billingCycleDay
      updateData.nextBillingDate = calculateNextBillingDate(
        startDate,
        updateData.billingCycleType as BillingCycleType,
        overriddenDay,
        billingCycleDays,
        await getBillingAnchor()
      )
    }

    // Add margin totals
    if ((existingReservation as any)._totalCost !== undefined) {
      updateData.totalCost = (existingReservation as any)._totalCost
      updateData.totalMargin = (existingReservation as any)._totalMargin
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: updateData,
      include: {
        client: true,
        items: {
          include: {
            asset: true,
          },
        },
      },
    })

    // Sync delivery/return costs to active package when changed
    if (activePackage && (data.deliveryCost !== undefined || data.returnCost !== undefined)) {
      const pkgUpdate: Record<string, unknown> = {}
      if (data.deliveryCost !== undefined) pkgUpdate.deliveryCost = data.deliveryCost ?? null
      if (data.returnCost !== undefined) pkgUpdate.returnCost = data.returnCost ?? null
      await tx.package.update({ where: { id: activePackage.id }, data: pkgUpdate })
    }

    if (updated.reservationType === 'FLOW') {
      await repriceFlowTx(tx, id)
      return tx.reservation.findUniqueOrThrow({
        where: { id },
        include: { client: true, items: { include: { asset: true } } },
      })
    }

    return updated
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)

  return serialize(reservation)
}

// ---------------------------------------------------------------------------
// Inline rate adjustment (works on non-terminal reservations)
// ---------------------------------------------------------------------------
export async function updateReservationItemRate(
  reservationId: string,
  itemId: string,
  newRate: number,
  newPricingType?: PricingType
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot adjust rates on completed, canceled, or lost reservations')
    }
    if (reservation.reservationType === 'FLOW') {
      throw new Error("Flow line rates are derived from each line's cost basis and can't be edited directly.")
    }

    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }

    const effectivePricingType = newPricingType || item.pricingType
    const periods = item.isOneTime ? 1 : calculatePeriodsSync(reservation.startDate, reservation.endDate, effectivePricingType, reservation.isRecurring)
    const updateData: Record<string, unknown> = {
      rate: newRate,
      subtotal: computeItemSubtotal(newRate, item.quantity, periods),
    }
    if (newPricingType) {
      updateData.pricingType = newPricingType
    }
    await tx.reservationItem.update({ where: { id: itemId }, data: updateData })

    // Recalculate reservation totals from the active package's items only
    const activePackage = await tx.package.findFirst({ where: { reservationId, isActive: true } })
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackage ? { packageId: activePackage.id } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => {
      return sum + (ri.id === itemId ? computeItemSubtotal(newRate, ri.quantity, periods) : Number(ri.subtotal))
    }, 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// Update quantity on a reservation item (rental orders only, before checkout)
// ---------------------------------------------------------------------------
export async function updateReservationItemQuantity(
  reservationId: string,
  itemId: string,
  newQuantity: number
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!Number.isInteger(newQuantity) || newQuantity < 1) {
    throw new Error('Quantity must be a positive integer')
  }

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot adjust quantity on completed, canceled, or lost reservations')
    }

    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }

    // Don't allow reducing below currently-outstanding count (checked out minus returned)
    const outstandingCount = item.checkedOutCount - item.checkedInCount
    if (outstandingCount > 0 && newQuantity < outstandingCount) {
      throw new Error(`Cannot reduce quantity below ${outstandingCount} (currently checked out)`)
    }

    const rate = Number(item.rate)
    const periods = item.isOneTime ? 1 : calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
    const newSubtotalForItem = computeItemSubtotal(rate, newQuantity, periods)

    await tx.reservationItem.update({
      where: { id: itemId },
      data: { quantity: newQuantity, subtotal: newSubtotalForItem },
    })

    // Recalculate reservation totals
    const activePackage = await tx.package.findFirst({ where: { reservationId, isActive: true } })
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackage ? { packageId: activePackage.id } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => {
      return sum + (ri.id === itemId ? newSubtotalForItem : Number(ri.subtotal))
    }, 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// Update category on an ad-hoc reservation item
// ---------------------------------------------------------------------------
export async function updateReservationItemCategory(
  reservationId: string,
  itemId: string,
  category: string | null
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot update category on this reservation')
    }

    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }
    if (item.assetId) {
      throw new Error('Cannot set category on asset-linked items')
    }

    await tx.reservationItem.update({
      where: { id: itemId },
      data: { category: category || null },
    })
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// Update a reservation item's description (display name)
// ---------------------------------------------------------------------------
export async function updateReservationItemDescription(
  reservationId: string,
  itemId: string,
  description: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const trimmed = description.trim()
  if (!trimmed) throw new Error('Description cannot be empty')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot update items on this reservation')
    }

    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }

    await tx.reservationItem.update({
      where: { id: itemId },
      data: { description: trimmed },
    })
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// Toggle one-time charge flag on a reservation item
// ---------------------------------------------------------------------------
export async function updateReservationItemOneTime(
  reservationId: string,
  itemId: string,
  isOneTime: boolean
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot update items on this reservation')
    }

    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }

    const rate = Number(item.rate)
    const periods = isOneTime ? 1 : calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
    const newSubtotalForItem = computeItemSubtotal(rate, item.quantity, periods)

    await tx.reservationItem.update({
      where: { id: itemId },
      data: { isOneTime, subtotal: newSubtotalForItem },
    })

    // Recalculate reservation totals
    const activePackage = await tx.package.findFirst({ where: { reservationId, isActive: true } })
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackage ? { packageId: activePackage.id } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => {
      return sum + (ri.id === itemId ? newSubtotalForItem : Number(ri.subtotal))
    }, 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// Add a new item to a reservation (non-terminal statuses)
// ---------------------------------------------------------------------------
export async function addItemToReservation(
  reservationId: string,
  assetId: string | null,
  pricingType: PricingType,
  rate: number,
  quantity: number = 1,
  description?: string,
  category?: string,
  isOneTime?: boolean,
  packageId?: string,
  costBasis?: number,
  marginPercent?: number,
  cloudProductId?: string | null,
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!assetId && !description && !cloudProductId) {
    throw new Error('Either an asset, a cloud product, or a description is required')
  }

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { packages: true },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot add items to completed, canceled, or lost reservations')
    }

    // Resolve packageId: use provided, or fall back to active package, or auto-create default
    let targetPackageId = packageId || reservation.packages.find((p) => p.isActive)?.id || null
    if (!targetPackageId) {
      const defaultPkg = await tx.package.create({
        data: { reservationId, name: 'Default', isActive: true, sortOrder: 0 },
      })
      targetPackageId = defaultPkg.id
    }

    // Duplicate lines for the same asset are allowed on purpose: splitting a
    // quantity across two lines is how part of it gets a different rate.
    const periods = isOneTime ? 1 : calculatePeriodsSync(reservation.startDate, reservation.endDate, pricingType, reservation.isRecurring)
    const subtotal = computeItemSubtotal(rate, quantity, periods)
    const maxOrder = await tx.reservationItem.aggregate({
      where: { reservationId, packageId: targetPackageId },
      _max: { sortOrder: true },
    })
    const item = await tx.reservationItem.create({
      data: {
        reservationId,
        packageId: targetPackageId,
        assetId: assetId || null,
        cloudProductId: cloudProductId || null,
        description: description || null,
        category: cloudProductId ? (category || 'Cloud') : ((!assetId && category) ? category : null),
        pricingType,
        rate,
        quantity,
        subtotal,
        isOneTime: isOneTime || false,
        addedAt: new Date(),
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        ...(costBasis != null && { costBasis }),
        ...(marginPercent != null && { marginPercent }),
      },
    })

    // Recalculate reservation totals from the active package's items
    const activePackageId = reservation.packages.find((p) => p.isActive)?.id || targetPackageId
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)

    return item
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  return serialize(result)
}

// ---------------------------------------------------------------------------
// Cloud-host unit allocation helpers.
// A cloud host parent line carries `assetId` (the backing in-house server) and
// a host count via `quantity`. We allocate one specific AssetUnit per host so
// the order tracks exactly which boxes are spun up. Units flip to RESERVED
// while the order is in pre-active states and CHECKED_OUT once ACTIVE.
// ---------------------------------------------------------------------------
async function allocateUnitsForCloudHost(
  tx: Prisma.TransactionClient,
  parentItemId: string,
  assetId: string,
  needed: number,
): Promise<number> {
  if (needed <= 0) return 0

  const candidates = await tx.assetUnit.findMany({
    where: { assetId, status: 'AVAILABLE' },
    take: needed,
    orderBy: { barcode: 'asc' },
  })

  for (const unit of candidates) {
    await tx.reservationItemUnit.upsert({
      where: {
        reservationItemId_assetUnitId: { reservationItemId: parentItemId, assetUnitId: unit.id },
      },
      create: {
        reservationItemId: parentItemId,
        assetUnitId: unit.id,
        assignedAt: new Date(),
      },
      update: { assignedAt: new Date() },
    })
    await tx.assetUnit.update({
      where: { id: unit.id },
      data: { status: 'RESERVED' },
    })
  }

  if (candidates.length > 0) {
    await tx.reservationItem.update({
      where: { id: parentItemId },
      data: { assignedCount: { increment: candidates.length } },
    })
  }
  return candidates.length
}

/**
 * Bring a cloud host's allocations in line with its new backing asset and host count.
 * Releases units no longer needed; allocates new ones as available.
 */
async function reconcileCloudHostUnits(
  tx: Prisma.TransactionClient,
  parentItemId: string,
  newAssetId: string | null,
  newQuantity: number,
  oldAssetId: string | null,
): Promise<void> {
  const existing = await tx.reservationItemUnit.findMany({
    where: { reservationItemId: parentItemId },
    include: { assetUnit: true },
  })

  // Asset swapped — drop everything, then allocate fresh
  if (newAssetId !== oldAssetId) {
    for (const riu of existing) {
      // Only revert units we still own (not checked-out elsewhere)
      if (riu.assetUnit.status === 'RESERVED' || riu.assetUnit.status === 'CHECKED_OUT') {
        await tx.assetUnit.update({
          where: { id: riu.assetUnitId },
          data: { status: 'AVAILABLE' },
        })
      }
      await tx.reservationItemUnit.delete({ where: { id: riu.id } })
    }
    await tx.reservationItem.update({
      where: { id: parentItemId },
      data: { assignedCount: 0 },
    })
    if (newAssetId) {
      await allocateUnitsForCloudHost(tx, parentItemId, newAssetId, newQuantity)
    }
    return
  }

  // Same asset, just adjust to match host count
  const diff = newQuantity - existing.length
  if (diff > 0 && newAssetId) {
    await allocateUnitsForCloudHost(tx, parentItemId, newAssetId, diff)
  } else if (diff < 0) {
    const toRelease = existing.slice(diff) // negative slice = last N
    for (const riu of toRelease) {
      if (riu.assetUnit.status === 'RESERVED' || riu.assetUnit.status === 'CHECKED_OUT') {
        await tx.assetUnit.update({
          where: { id: riu.assetUnitId },
          data: { status: 'AVAILABLE' },
        })
      }
      await tx.reservationItemUnit.delete({ where: { id: riu.id } })
    }
    if (toRelease.length > 0) {
      await tx.reservationItem.update({
        where: { id: parentItemId },
        data: { assignedCount: { decrement: toRelease.length } },
      })
    }
  }
}

/**
 * Allocate SPECIFIC asset units (by id) as the backing hardware for a cloud host.
 * Units must be AVAILABLE (or already allocated to this same host). Each is
 * marked RESERVED and linked to the parent item via ReservationItemUnit.
 */
async function allocateSpecificUnitsForCloudHost(
  tx: Prisma.TransactionClient,
  parentItemId: string,
  unitIds: string[],
): Promise<number> {
  if (unitIds.length === 0) return 0

  const units = await tx.assetUnit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true, barcode: true, status: true },
  })
  const found = new Map(units.map((u) => [u.id, u]))

  for (const id of unitIds) {
    const unit = found.get(id)
    if (!unit) throw new Error('Selected asset tag no longer exists')
    // Allow AVAILABLE, or units already reserved for THIS host (idempotent re-save).
    if (unit.status !== 'AVAILABLE') {
      const alreadyMine = await tx.reservationItemUnit.findUnique({
        where: { reservationItemId_assetUnitId: { reservationItemId: parentItemId, assetUnitId: id } },
      })
      if (!alreadyMine) {
        throw new Error(`Asset tag ${unit.barcode} is not available (status: ${unit.status})`)
      }
    }
    await tx.reservationItemUnit.upsert({
      where: { reservationItemId_assetUnitId: { reservationItemId: parentItemId, assetUnitId: id } },
      create: { reservationItemId: parentItemId, assetUnitId: id, assignedAt: new Date() },
      update: { assignedAt: new Date() },
    })
    await tx.assetUnit.update({ where: { id }, data: { status: 'RESERVED' } })
  }

  await tx.reservationItem.update({
    where: { id: parentItemId },
    data: { assignedCount: unitIds.length },
  })
  return unitIds.length
}

/**
 * Bring a cloud host's SPECIFIC-unit allocations in line with a new tag set:
 * release units no longer selected, allocate newly added ones.
 */
async function reconcileCloudHostSpecificUnits(
  tx: Prisma.TransactionClient,
  parentItemId: string,
  newUnitIds: string[],
): Promise<void> {
  const existing = await tx.reservationItemUnit.findMany({
    where: { reservationItemId: parentItemId },
    include: { assetUnit: true },
  })
  const keep = new Set(newUnitIds)

  // Release units that are no longer selected
  for (const riu of existing) {
    if (keep.has(riu.assetUnitId)) continue
    if (riu.assetUnit.status === 'RESERVED' || riu.assetUnit.status === 'CHECKED_OUT') {
      await tx.assetUnit.update({ where: { id: riu.assetUnitId }, data: { status: 'AVAILABLE' } })
    }
    await tx.reservationItemUnit.delete({ where: { id: riu.id } })
  }

  // Allocate the (possibly new) full set — upsert is idempotent for ones we kept.
  if (newUnitIds.length > 0) {
    await allocateSpecificUnitsForCloudHost(tx, parentItemId, newUnitIds)
  } else {
    await tx.reservationItem.update({ where: { id: parentItemId }, data: { assignedCount: 0 } })
  }
}

// ---------------------------------------------------------------------------
// Add a configured Cloud Host (parent + components) to a reservation
// ---------------------------------------------------------------------------
export async function addCloudHostToReservation(
  reservationId: string,
  data: {
    period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
    quantity: number
    backingAssetId: string | null
    backingAssetUnitIds?: string[]
    backingAssetCost: number | null
    summaryDescription: string
    components: Array<{
      cloudProductId: string
      productName: string
      categoryLabel: string
      qtyPerHost?: number
      rate: number
      costBasis: number
      marginPercent: number
    }>
    packageId?: string
  },
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!data.components.length) throw new Error('At least one component is required')
  if (data.quantity < 1) throw new Error('Quantity must be at least 1')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { packages: true },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot add items to completed, canceled, or lost reservations')
    }
    if (reservation.reservationType === 'FLOW') {
      throw new Error("Cloud hosts can't be added to a Flow order.")
    }

    // Resolve target package
    let targetPackageId = data.packageId || reservation.packages.find((p) => p.isActive)?.id || null
    if (!targetPackageId) {
      const defaultPkg = await tx.package.create({
        data: { reservationId, name: 'Default', isActive: true, sortOrder: 0 },
      })
      targetPackageId = defaultPkg.id
    }

    // Compute periods for subtotal math
    const periods = calculatePeriodsSync(reservation.startDate, reservation.endDate, data.period as PricingType, reservation.isRecurring)

    // Sort order starts after any existing items in the package
    const maxOrder = await tx.reservationItem.aggregate({
      where: { reservationId, packageId: targetPackageId },
      _max: { sortOrder: true },
    })
    let sortOrder = (maxOrder._max.sortOrder ?? -1) + 1

    const perHostSell = data.components.reduce((s, c) => s + c.rate, 0)
    const perHostComponentCost = data.components.reduce((s, c) => s + c.costBasis, 0)
    // Cost basis: prefer the backing physical asset's cost; fall back to summed component cost
    const costBasis = data.backingAssetCost != null ? data.backingAssetCost : perHostComponentCost
    const parentSubtotal = computeItemSubtotal(perHostSell, data.quantity, periods)
    const parentMargin = perHostSell > 0 ? Math.round(((perHostSell - costBasis) / perHostSell) * 10000) / 100 : 0

    // Parent carries the full per-host rate; children are informational breakdown rows (rate=0, subtotal=0)
    const parent = await tx.reservationItem.create({
      data: {
        reservationId,
        packageId: targetPackageId,
        assetId: data.backingAssetId || null,
        cloudProductId: null,
        description: data.summaryDescription,
        category: 'Cloud',
        pricingType: data.period as PricingType,
        rate: perHostSell,
        quantity: data.quantity,
        subtotal: parentSubtotal,
        isOneTime: false,
        addedAt: new Date(),
        sortOrder: sortOrder++,
        ...(costBasis > 0 ? { costBasis } : {}),
        ...(perHostSell > 0 ? { marginPercent: parentMargin } : {}),
      },
    })

    // Allocate backing hardware: specific tagged units if provided, otherwise
    // fall back to auto-allocating by backing asset + host count (legacy).
    if (data.backingAssetUnitIds && data.backingAssetUnitIds.length > 0) {
      await allocateSpecificUnitsForCloudHost(tx, parent.id, data.backingAssetUnitIds)
    } else if (data.backingAssetId) {
      await allocateUnitsForCloudHost(tx, parent.id, data.backingAssetId, data.quantity)
    }

    // Children: hidden config records — carry cloudProductId + qtyPerHost so the
    // parent can be re-opened in the configurator for editing. They are filtered
    // out of all display surfaces (detail page, PDFs, invoices) so only the
    // parent summary row appears to users.
    // Child's `quantity` holds qtyPerHost (not host count). rate/subtotal are 0
    // so they never contribute to totals.
    for (const c of data.components) {
      await tx.reservationItem.create({
        data: {
          reservationId,
          packageId: targetPackageId,
          parentId: parent.id,
          cloudProductId: c.cloudProductId,
          description: `${c.categoryLabel}: ${c.productName}`,
          category: 'Cloud',
          pricingType: data.period as PricingType,
          rate: 0,
          quantity: Math.max(1, c.qtyPerHost || 1),
          subtotal: 0,
          isOneTime: false,
          addedAt: new Date(),
          sortOrder: sortOrder++,
        },
      })
    }

    // Recalculate reservation totals from the active package's items
    const activePackageId = reservation.packages.find((p) => p.isActive)?.id || targetPackageId
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: reservation.shippingMarginType,
      shippingMargin: Number(reservation.shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })

    return parent
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath(`/dashboard/cloud`)
  return serialize(result)
}

// ---------------------------------------------------------------------------
// Update an existing Cloud Host: replaces the parent's pricing + children atomically.
// ---------------------------------------------------------------------------
export async function updateCloudHostInReservation(
  reservationId: string,
  parentItemId: string,
  data: {
    period: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'
    quantity: number
    backingAssetId: string | null
    backingAssetUnitIds?: string[]
    backingAssetCost: number | null
    summaryDescription: string
    components: Array<{
      cloudProductId: string
      productName: string
      categoryLabel: string
      qtyPerHost?: number
      rate: number
      costBasis: number
      marginPercent: number
    }>
  },
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!data.components.length) throw new Error('At least one component is required')
  if (data.quantity < 1) throw new Error('Quantity must be at least 1')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { packages: true },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot edit items on completed, canceled, or lost reservations')
    }
    if (reservation.reservationType === 'FLOW') {
      throw new Error("Cloud hosts can't be added to a Flow order.")
    }

    const parent = await tx.reservationItem.findUnique({ where: { id: parentItemId } })
    if (!parent || parent.reservationId !== reservationId) throw new Error('Cloud host item not found')
    if (parent.parentId) throw new Error('Cannot edit a component row directly')

    // Wipe existing children before creating fresh ones
    await tx.reservationItem.deleteMany({ where: { parentId: parent.id } })

    const periods = calculatePeriodsSync(reservation.startDate, reservation.endDate, data.period as PricingType, reservation.isRecurring)
    const perHostSell = data.components.reduce((s, c) => s + c.rate, 0)
    const perHostComponentCost = data.components.reduce((s, c) => s + c.costBasis, 0)
    const costBasis = data.backingAssetCost != null ? data.backingAssetCost : perHostComponentCost
    const parentSubtotal = computeItemSubtotal(perHostSell, data.quantity, periods)
    const parentMargin = perHostSell > 0 ? Math.round(((perHostSell - costBasis) / perHostSell) * 10000) / 100 : 0

    // Next sort order after existing siblings (the wipe left gaps, so just keep parent's position)
    let childSortOrder = (parent.sortOrder ?? 0) + 1

    await tx.reservationItem.update({
      where: { id: parent.id },
      data: {
        assetId: data.backingAssetId || null,
        description: data.summaryDescription,
        pricingType: data.period as PricingType,
        rate: perHostSell,
        quantity: data.quantity,
        subtotal: parentSubtotal,
        costBasis: costBasis > 0 ? costBasis : null,
        marginPercent: perHostSell > 0 ? parentMargin : null,
      },
    })

    // Reconcile unit allocations. Prefer explicit tagged units; fall back to the
    // legacy asset+quantity auto-allocation when no tags were supplied.
    if (data.backingAssetUnitIds !== undefined) {
      await reconcileCloudHostSpecificUnits(tx, parent.id, data.backingAssetUnitIds)
    } else {
      await reconcileCloudHostUnits(tx, parent.id, data.backingAssetId || null, data.quantity, parent.assetId || null)
    }

    for (const c of data.components) {
      await tx.reservationItem.create({
        data: {
          reservationId,
          packageId: parent.packageId,
          parentId: parent.id,
          cloudProductId: c.cloudProductId,
          description: `${c.categoryLabel}: ${c.productName}`,
          category: 'Cloud',
          pricingType: data.period as PricingType,
          rate: 0,
          quantity: Math.max(1, c.qtyPerHost || 1),
          subtotal: 0,
          isOneTime: false,
          addedAt: new Date(),
          sortOrder: childSortOrder++,
        },
      })
    }

    // Recompute reservation totals from the active package's items
    const activePackageId = reservation.packages.find((p) => p.isActive)?.id || parent.packageId
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: reservation.shippingMarginType,
      shippingMargin: Number(reservation.shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })

    return parent
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath(`/dashboard/cloud`)
  return serialize(result)
}

export async function addServiceItemToReservation(
  reservationId: string,
  serviceId: string,
  rate: number,
  quantity: number = 1,
  packageId?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) throw new Error('Service not found')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { packages: true },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot add items to completed, canceled, or lost reservations')
    }

    let targetPackageId = packageId || reservation.packages.find((p) => p.isActive)?.id || null
    if (!targetPackageId) {
      const defaultPkg = await tx.package.create({
        data: { reservationId, name: 'Default', isActive: true, sortOrder: 0 },
      })
      targetPackageId = defaultPkg.id
    }

    const subtotal = rate * quantity // Services are always one-time (no period multiplication)
    const maxOrder = await tx.reservationItem.aggregate({
      where: { reservationId, packageId: targetPackageId },
      _max: { sortOrder: true },
    })
    const item = await tx.reservationItem.create({
      data: {
        reservationId,
        packageId: targetPackageId,
        serviceId,
        description: service.name,
        category: 'Service',
        pricingType: 'PROJECT',
        rate,
        quantity,
        subtotal,
        isOneTime: true,
        costBasis: 0, // 100% margin default
        addedAt: new Date(),
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    })

    // Recalculate reservation totals
    const activePackageId = reservation.packages.find((p) => p.isActive)?.id || targetPackageId
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
    })
    const newSubtotal = allItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)

    return item
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  return serialize(result)
}

export async function reorderReservationItems(
  reservationId: string,
  itemIds: string[]
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot reorder items on completed, canceled, or lost reservations')
    }

    for (let i = 0; i < itemIds.length; i++) {
      await tx.reservationItem.update({
        where: { id: itemIds[i] },
        data: { sortOrder: i },
      })
    }
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// Attach a component asset to an existing reservation item (must be configurable).
export async function addReservationComponent(
  reservationId: string,
  parentItemId: string,
  componentAssetId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot modify items on this reservation')
    }
    // Flow prices each line off its own basis; a component row would sit outside it.
    if (reservation.reservationType === 'FLOW') {
      throw new Error('Components are not supported on Flow orders — add each part as its own line.')
    }

    const parent = await tx.reservationItem.findUnique({
      where: { id: parentItemId },
      include: { asset: { include: { category: true } } },
    })
    if (!parent || parent.reservationId !== reservationId) throw new Error('Parent item not found')
    if (parent.parentId) throw new Error('Cannot attach a component to another component')
    if (!parent.asset?.category?.isConfigurable) {
      throw new Error('Parent item is not a configurable asset')
    }

    const asset = await tx.asset.findUnique({
      where: { id: componentAssetId },
      include: { category: true },
    })
    if (!asset) throw new Error('Component asset not found')
    if (!asset.category?.isComponent) {
      throw new Error('This asset is not flagged as a component')
    }

    // Default pricing from the parent — components ride on the same cadence.
    const pricingType = parent.pricingType
    const isOneTime = parent.isOneTime
    // Default rate: monthly first, then weekly, then daily, then salePrice for SALE orders.
    const isSale = reservation.reservationType === 'SALE' || reservation.reservationType === 'CLOUD'
    let rate = 0
    if (isSale) {
      rate = Number(asset.salePrice || 0)
    } else {
      switch (pricingType) {
        case 'DAILY':   rate = Number(asset.dailyRate || 0); break
        case 'WEEKLY':  rate = Number(asset.weeklyRate || 0); break
        case 'MONTHLY': rate = Number(asset.monthlyRate || 0); break
        default:        rate = Number(asset.monthlyRate || asset.dailyRate || 0); break
      }
    }

    const periods = isOneTime ? 1 : calculatePeriodsSync(reservation.startDate, reservation.endDate, pricingType, reservation.isRecurring)
    const subtotal = computeItemSubtotal(rate, 1, periods)

    // Place the new component immediately after the parent in sortOrder.
    const maxSort = await tx.reservationItem.aggregate({
      where: { reservationId, packageId: parent.packageId },
      _max: { sortOrder: true },
    })

    const created = await tx.reservationItem.create({
      data: {
        reservationId,
        packageId: parent.packageId,
        parentId: parent.id,
        assetId: asset.id,
        pricingType,
        isOneTime,
        rate,
        quantity: 1,
        subtotal,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    })

    // Recompute reservation totals (flat sum — children contribute normally).
    const allItems = await tx.reservationItem.findMany({ where: { reservationId } })
    const newSubtotal = allItems.reduce((s, it) => s + Number(it.subtotal), 0)
    const taxRate = Number(reservation.taxRate) || 0
    const taxAmount = newSubtotal * (taxRate / 100)
    const deliveryCost = reservation.deliveryCost ? Number(reservation.deliveryCost) : 0
    const returnCost = reservation.returnCost ? Number(reservation.returnCost) : 0
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        subtotal: newSubtotal,
        taxAmount,
        total: newSubtotal + taxAmount + deliveryCost + returnCost,
      },
    })

    return created
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)

  return serialize(result)
}

export async function removeReservationItem(
  reservationId: string,
  itemId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot remove items from this reservation')
    }

    const item = await tx.reservationItem.findUnique({
      where: { id: itemId },
      include: {
        units: { include: { assetUnit: true } },
      },
    })
    if (!item || item.reservationId !== reservationId) {
      throw new Error('Reservation item not found')
    }

    // Cancel any active checkouts for units tied to this item
    for (const riu of item.units) {
      if (riu.checkedOutAt && !riu.checkedInAt) {
        // Return the unit to available
        await tx.assetUnit.update({
          where: { id: riu.assetUnitId },
          data: { status: 'AVAILABLE' },
        })

        // Cancel the checkout record
        if (riu.checkoutId) {
          await tx.checkout.update({
            where: { id: riu.checkoutId },
            data: { status: 'CANCELLED' },
          })
        }
        // Canceled checkouts no longer count — re-derive the unit's revenue
        await recomputeUnitRevenue(tx, riu.assetUnitId)
      }
    }

    // Delete junction records then the item itself (cascade handles junction,
    // but be explicit for clarity)
    await tx.reservationItemUnit.deleteMany({ where: { reservationItemId: itemId } })
    const deletedItem = await tx.reservationItem.delete({ where: { id: itemId } })

    // Recalculate reservation totals from the active package's items
    const activePackage = await tx.package.findFirst({ where: { reservationId, isActive: true } })
    const remainingItems = await tx.reservationItem.findMany({
      where: { reservationId, ...(activePackage ? { packageId: activePackage.id } : {}) },
    })
    const newSubtotal = remainingItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

// ---------------------------------------------------------------------------
// New lifecycle transition actions
// ---------------------------------------------------------------------------

export async function markQuoteSent(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { error: authResult.error }

  const reservation = await prisma.reservation.findUnique({ where: { id } })
  if (!reservation) return { error: 'Reservation not found' }
  if (reservation.status !== 'DRAFT' && reservation.status !== 'REVISION') {
    return { error: 'Can only mark quote sent from Draft or Revision status' }
  }

  // Phase 6: the quote gate (approval and the prospect hold), checked here as
  // well as on the screen because this export is reachable on its own.
  const gate = await quoteGate({ orderId: id, userId: authResult.userId, role: authResult.role, act: 'sending it', raise: false })
  if (gate.status === 'held') return { error: gate.message }

  const previousStatus = reservation.status
  const updated = await prisma.reservation.update({
    where: { id },
    data: { status: 'QUOTE_SENT', quoteSentAt: new Date() },
  })

  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: previousStatus,
      toStatus: 'QUOTE_SENT',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  // Sync deal stage to HubSpot (fire-and-forget)
  syncReservationDeal({
    id: updated.id,
    reservationNumber: updated.reservationNumber,
    reservationType: updated.reservationType,
    status: 'QUOTE_SENT',
    total: Number(updated.total) || 0,
    projectName: updated.projectName,
    startDate: updated.startDate,
    endDate: updated.endDate,
    hubspotDealId: updated.hubspotDealId,
    clientId: updated.clientId,
  }).catch(() => {})

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  return serialize(updated)
}

export async function requestRevision(id: string, notes?: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { error: authResult.error }

  const reservation = await prisma.reservation.findUnique({ where: { id } })
  if (!reservation) return { error: 'Reservation not found' }
  // Approved orders can be pulled back too — line items or pricing sometimes
  // change after the client signs off but before prep starts. The agreed rates
  // stay on the items untouched; only the status moves.
  if (reservation.status !== 'QUOTE_SENT' && reservation.status !== 'APPROVED') {
    return { error: 'Can only request revision from Quote Sent or Approved status' }
  }

  const previousStatus = reservation.status
  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      status: 'REVISION',
      actionRequired: true,
      actionRequiredNote:
        notes || (previousStatus === 'APPROVED' ? 'Revising approved order' : 'Revision requested'),
      // A revised Flow order must be agreed again (v1): drop the frozen terms and the
      // autopay authorization so the next approval freezes what the client actually
      // signs. Once anything is billed the agreement stands.
      ...(reservation.reservationType === 'FLOW' && !(reservation.flowPeriodsBilled ?? 0) ? {
        flowTermsSnapshot: Prisma.DbNull,
        flowTermsVersion: null,
        flowAutopayMethod: null,
        flowAutopayAuthorizedBy: null,
        flowAutopayAuthorizedAt: null,
      } : {}),
    },
  })

  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: previousStatus,
      toStatus: 'REVISION',
      changedById: authResult.userId!,
      notes,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  return serialize(updated)
}

export async function markLost(id: string, reason?: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({ where: { id } })
  if (!reservation) throw new Error('Reservation not found')
  if (reservation.status !== 'QUOTE_SENT' && reservation.status !== 'REVISION') {
    throw new Error('Can only mark as lost from Quote Sent or Revision status')
  }

  const previousStatus = reservation.status
  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      status: 'LOST',
      lostAt: new Date(),
      lostReason: reason || null,
    },
  })

  // Advance linked lead to LOST
  const linkedLead = await prisma.lead.findFirst({
    where: { convertedReservationId: id, status: { notIn: ['WON', 'LOST', 'UNQUALIFIED'] } },
  })
  if (linkedLead) {
    await prisma.lead.update({
      where: { id: linkedLead.id },
      data: { status: 'LOST', lostAt: new Date(), lostReason: reason || 'Quote lost' },
    })
    await prisma.leadActivity.create({
      data: {
        leadId: linkedLead.id,
        type: 'STATUS_CHANGE',
        title: 'Lead lost — quote rejected',
        description: reason || 'Quote was not accepted',
        metadata: { previousStatus: linkedLead.status, newStatus: 'LOST', reservationId: id },
      },
    })
  }

  // Asks this order had answered go back to Lost with it (docs/client-tracker.md,
  // Conversion). Non-critical in the same way the history row below is: the
  // order is already lost, and a failure here must not report that it isn't.
  try {
    const { loseAsksLinkedTo } = await import('@/lib/tracker/order-outcome')
    await loseAsksLinkedTo(id, reason || null)
  } catch (error) {
    console.error('Failed to close asks linked to a lost order:', error)
  }

  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: previousStatus,
      toStatus: 'LOST',
      changedById: authResult.userId!,
      notes: reason,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  return serialize(updated)
}

// Returns { error } rather than throwing: a thrown server-action error reaches the
// browser as an opaque digest in production, so the user sees nothing useful.
export async function startPreparing(id: string, preparedById?: string, notifyClient?: { email: string }) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { error: authResult.error }

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { client: true },
  })
  if (!reservation) return { error: 'Reservation not found' }
  // A second click (or a stale page) shouldn't look like a failure — it's already there.
  if (reservation.status === 'PREPARING') return serialize(reservation)
  if (reservation.status !== 'APPROVED') {
    return { error: `Only approved orders can start preparing — this one is ${reservation.status.toLowerCase().replace(/_/g, ' ')}.` }
  }

  if (preparedById) {
    const user = await prisma.user.findUnique({ where: { id: preparedById } })
    if (!user) return { error: 'Selected team member not found' }
  }

  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      status: 'PREPARING',
      preparingAt: new Date(),
      ...(preparedById && { preparedById }),
    },
  })

  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: 'APPROVED',
      toStatus: 'PREPARING',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  // Send client notification if requested
  if (notifyClient?.email) {
    try {
      const { orderPreparingEmail } = await import('@/lib/email/templates')
      const { sendEmail } = await import('@/lib/email')
      const template = orderPreparingEmail(
        reservation.client?.name || 'Customer',
        reservation.reservationNumber,
        new Date(reservation.startDate).toLocaleDateString(),
        new Date(reservation.endDate).toLocaleDateString(),
        (reservation as any).reservationType,
      )
      await sendEmail({ to: notifyClient.email, subject: template.subject, html: template.html })
    } catch (err) {
      console.error('Failed to send preparing notification:', err)
    }
  }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  return serialize(updated)
}

export async function markShipped(id: string, notifyClient?: { email: string }) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { error: authResult.error }

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { items: true, packages: true, client: true },
  })
  if (!reservation) return { error: 'Reservation not found' }
  if (reservation.status !== 'PREPARING') {
    return { error: 'Can only mark shipped from Preparing status' }
  }

  // The stop gap (lib/orders/handover): every asset on the chosen option,
  // parts chosen from stock included, is checked out before it ships. A line
  // with no asset — a service, a fee, a spec part — has nothing to scan; an
  // order with nothing physical ships on the say-so of whoever ships it.
  const handover = await handoverShortfall(id)
  if (handover.units > 0) {
    return { error: shortfallMessage(handover, 'ship') }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.reservation.update({
      where: { id },
      data: { status: 'SHIPPED', shippedAt: new Date() },
    })

    // Auto-invoice on ship: if the order has value and isn't notBilled, generate invoice
    await maybeAutoInvoice(tx, id)

    return res
  })

  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: 'PREPARING',
      toStatus: 'SHIPPED',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  // Send client notification if requested
  if (notifyClient?.email) {
    try {
      const { orderShippedEmail } = await import('@/lib/email/templates')
      const { sendEmail } = await import('@/lib/email')
      const template = orderShippedEmail(
        reservation.client?.name || 'Customer',
        reservation.reservationNumber,
        new Date(reservation.startDate).toLocaleDateString(),
        new Date(reservation.endDate).toLocaleDateString(),
        (reservation as any).reservationType,
      )
      await sendEmail({ to: notifyClient.email, subject: template.subject, html: template.html })
    } catch (err) {
      console.error('Failed to send shipped notification:', err)
    }
  }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  revalidatePath('/dashboard/invoices')
  return serialize(updated)
}

/**
 * checkStockAvailability — pre-approval check that returns per-item stock info.
 * Returns warnings for items with insufficient stock (does not block).
 */
export async function checkStockAvailability(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) return { error: authResult.error }

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      items: { include: { asset: true } },
      packages: true,
    },
  })

  if (!reservation) return { error: 'Reservation not found' }

  const activePackage = reservation.packages.find((p) => p.isActive)
  const items = activePackage
    ? reservation.items.filter((i) => i.packageId === activePackage.id)
    : reservation.items

  const warnings: { assetName: string; needed: number; available: number }[] = []

  for (const item of items) {
    if (!item.assetId) continue
    const availableCount = await prisma.assetUnit.count({
      where: { assetId: item.assetId, status: 'AVAILABLE' },
    })
    if (availableCount < item.quantity) {
      warnings.push({
        assetName: item.asset?.name || 'Unknown',
        needed: item.quantity,
        available: availableCount,
      })
    }
  }

  return serialize({ warnings })
}

/**
 * approveReservation — transition to APPROVED from QUOTE_SENT, REVISION, or DRAFT
 * (DRAFT for backward compat). REVISION covers the internal re-approval path: an
 * order pulled back for changes is approved again in-system without a second trip
 * through the client's online quote.
 * This replaces the old confirmReservation flow.
 * Pass force=true to approve even when stock is insufficient.
 */
export async function approveReservation(id: string, force?: boolean) {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { error: authResult.error }

  // Phase 6: committing the order passes the same gate as sending the quote —
  // always for an order never sent, and for a sent one only when its approval
  // is outstanding (a quote sent before approvals existed is not newly blocked).
  const gate = await quoteGate({ orderId: id, userId: authResult.userId, role: authResult.role, act: 'approving it', raise: false })
  if (gate.status === 'held') return { error: gate.message }

  // Flow (v1): approval freezes the rendered subscription terms onto the order.
  // Built before the transaction opens: it reads through the global client, and
  // doing that inside an open interactive transaction risks starving the pool.
  const preReservation = await prisma.reservation.findUnique({
    where: { id },
    select: { reservationType: true, flowTermsSnapshot: true },
  })
  let flowSnapshot: Awaited<ReturnType<typeof buildFlowTermsSnapshot>> | null = null
  if (preReservation?.reservationType === 'FLOW' && preReservation.flowTermsSnapshot == null) {
    try {
      flowSnapshot = await buildFlowTermsSnapshot(id)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'This Flow order cannot be approved yet.' }
    }
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const existingReservation = await tx.reservation.findUnique({
      where: { id },
      include: {
        items: { include: { asset: true } },
        packages: true,
      },
    })

    if (!existingReservation) {
      return { error: 'Reservation not found' } as const
    }

    if (!['QUOTE_SENT', 'REVISION', 'DRAFT'].includes(existingReservation.status)) {
      return { error: 'Can only approve from Quote Sent, Revision, or Draft status' } as const
    }

    const previousStatus = existingReservation.status

    // Only validate items from the active package
    const activePackage = existingReservation.packages.find((p) => p.isActive)
    const itemsToConfirm = activePackage
      ? existingReservation.items.filter((i) => i.packageId === activePackage.id)
      : existingReservation.items

    // Validate available unit counts per product type (skip ad-hoc items)
    // When force=true, skip this check (user acknowledged insufficient stock)
    if (!force) {
      for (const item of itemsToConfirm) {
        if (!item.assetId) continue
        const availableCount = await tx.assetUnit.count({
          where: {
            assetId: item.assetId,
            status: 'AVAILABLE',
          },
        })

        if (availableCount < item.quantity) {
          const assetName = item.asset?.name || item.assetId
          return {
            error: `Not enough available units for "${assetName}": need ${item.quantity}, only ${availableCount} available`,
          } as const
        }
      }
    }

    // Update reservation status
    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        confirmedAt: existingReservation.confirmedAt || new Date(),
        actionRequired: false,
        actionRequiredNote: null,
        ...(flowSnapshot ? {
          flowTermsSnapshot: flowSnapshot as unknown as Prisma.InputJsonValue,
          flowTermsVersion: flowSnapshot.version,
        } : {}),
      },
      include: {
        client: true,
        items: {
          include: {
            asset: { include: { category: true } },
          },
        },
      },
    })

    return { updated, previousStatus, activePackageId: activePackage?.id || null }
  })

  if ('error' in reservation) return { error: reservation.error }

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: reservation.previousStatus,
      toStatus: 'APPROVED',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  // Auto-advance any linked lead to WON
  const linkedLead = await prisma.lead.findFirst({
    where: { convertedReservationId: id, status: { notIn: ['WON', 'LOST', 'UNQUALIFIED'] } },
  })
  if (linkedLead) {
    const wonChannel = linkedLead.channel
      ? `${linkedLead.channel} → Order Approved`
      : 'Order Approved'
    await prisma.lead.update({
      where: { id: linkedLead.id },
      data: { status: 'WON', channel: wonChannel },
    })
    await prisma.leadActivity.create({
      data: {
        leadId: linkedLead.id,
        type: 'STATUS_CHANGE',
        title: 'Lead won — order approved',
        description: `Reservation ${reservation.updated.reservationNumber} approved`,
        metadata: { previousStatus: linkedLead.status, newStatus: 'WON', reservationId: id },
      },
    })
  }

  // Send confirmation email to client
  if (reservation.updated.client?.email) {
    const { reservationConfirmedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const template = reservationConfirmedEmail(
      reservation.updated.client.name,
      reservation.updated.reservationNumber,
      new Date(reservation.updated.startDate).toLocaleDateString(),
      new Date(reservation.updated.endDate).toLocaleDateString(),
      (reservation.updated as any).reservationType,
    )
    await sendEmail({ to: reservation.updated.client.email, subject: template.subject, html: template.html })
  }

  // Notify staff/recipients about approved order — only active package items
  try {
    const { notifyReservationConfirmed } = await import('@/lib/notifications/outbound')
    const activeItems = reservation.activePackageId
      ? reservation.updated.items.filter((i: any) => i.packageId === reservation.activePackageId)
      : reservation.updated.items
    await notifyReservationConfirmed({
      reservationNumber: reservation.updated.reservationNumber,
      clientName: reservation.updated.client?.companyName || reservation.updated.client?.name || 'Unknown',
      startDate: new Date(reservation.updated.startDate).toLocaleDateString(),
      endDate: new Date(reservation.updated.endDate).toLocaleDateString(),
      reservationType: (reservation.updated as any).reservationType || undefined,
      projectName: (reservation.updated as any).projectName || undefined,
      deliveryMethod: (reservation.updated as any).deliveryMethod ? ((await import('@/lib/types')).allDeliveryMethodLabels[(reservation.updated as any).deliveryMethod] || (reservation.updated as any).deliveryMethod) : undefined,
      items: activeItems.map((item: any) => ({
        name: item.asset?.name || item.description || 'Ad-hoc item',
        quantity: item.quantity,
        category: item.asset?.category?.name,
      })),
      total: `$${Number(reservation.updated.total || 0).toFixed(2)}`,
    })
  } catch (error) {
    console.error('Failed to send order approved notification:', error)
  }

  // Sync deal stage to HubSpot (fire-and-forget)
  syncReservationDeal({
    id: reservation.updated.id,
    reservationNumber: reservation.updated.reservationNumber,
    reservationType: (reservation.updated as any).reservationType,
    status: 'APPROVED',
    total: Number(reservation.updated.total) || 0,
    projectName: (reservation.updated as any).projectName,
    startDate: reservation.updated.startDate,
    endDate: reservation.updated.endDate,
    hubspotDealId: (reservation.updated as any).hubspotDealId,
    clientId: reservation.updated.clientId,
  }).catch(() => {})

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(reservation.updated)
}

/**
 * confirmReservation — backward-compatible wrapper that calls approveReservation.
 */
export async function confirmReservation(id: string) {
  return approveReservation(id)
}

export async function cancelReservation(id: string, reason?: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  let previousStatus: string | null = null
  const reservation = await prisma.$transaction(async (tx) => {
    const existingReservation = await tx.reservation.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            units: {
              include: { assetUnit: true },
            },
          },
        },
      },
    })

    if (!existingReservation) {
      throw new Error('Reservation not found')
    }

    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(existingReservation.status)) {
      throw new Error('Cannot cancel completed, already canceled, or lost reservations')
    }

    previousStatus = existingReservation.status

    // Release any held units (checked-out OR reserved) back to AVAILABLE.
    // Sale/cloud orders allocate units in DRAFT, so we must handle every
    // pre-completion status, not just ACTIVE/APPROVED.
    if (!['COMPLETED', 'CANCELLED', 'LOST'].includes(existingReservation.status)) {
      for (const item of existingReservation.items) {
        for (const riu of item.units) {
          // Skip already-checked-in units
          if (riu.checkedInAt) continue

          const unit = riu.assetUnit
          // Only revert if the unit is in a held state we put it in (don't
          // touch SOLD/RETIRED/MAINTENANCE — those have other lifecycles).
          if (unit && (unit.status === 'CHECKED_OUT' || unit.status === 'RESERVED')) {
            await tx.assetUnit.update({
              where: { id: riu.assetUnitId },
              data: { status: 'AVAILABLE' },
            })
          }

          // Close the associated checkout if there was one
          if (riu.checkedOutAt && riu.checkoutId) {
            await tx.checkout.update({
              where: { id: riu.checkoutId },
              data: {
                status: 'CANCELLED',
                actualReturn: new Date(),
              },
            })
            // Canceled checkouts no longer count — re-derive the unit's revenue
            await recomputeUnitRevenue(tx, riu.assetUnitId)
          }
        }
      }
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason
          ? existingReservation.notes
            ? `${existingReservation.notes}\n\nCancellation reason: ${reason}`
            : `Cancellation reason: ${reason}`
          : existingReservation.notes,
      },
    })

    return updated
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: previousStatus,
      toStatus: 'CANCELLED',
      changedById: authResult.userId!,
      notes: reason || undefined,
    })
  } catch { /* non-critical */ }

  // Sync canceled status to HubSpot (fire-and-forget)
  syncReservationDeal({
    id: reservation.id,
    reservationNumber: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    status: 'CANCELLED',
    total: Number(reservation.total) || 0,
    projectName: reservation.projectName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    hubspotDealId: reservation.hubspotDealId,
    clientId: reservation.clientId,
  }).catch(() => {})

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)
  revalidatePath('/dashboard/assets')

  return serialize(reservation)
}

export async function activateReservation(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existingReservation = await prisma.reservation.findUnique({
    where: { id },
  })

  if (!existingReservation) {
    throw new Error('Reservation not found')
  }

  if (!['APPROVED', 'PREPARING', 'SHIPPED'].includes(existingReservation.status)) {
    throw new Error('Reservation must be approved, preparing, or shipped to activate')
  }

  // The stop gap (owner, 2026-09-17): not activated until every asset on it is
  // checked out. A cloud order is exempt — its hardware is allocated, and
  // activation is what marks it in use.
  if (existingReservation.reservationType !== 'CLOUD') {
    const handover = await handoverShortfall(id)
    if (handover.units > 0) throw new Error(shortfallMessage(handover, 'activate'))
  }

  const previousStatus = existingReservation.status
  const reservation = await prisma.$transaction(async (tx) => {
    // For CLOUD orders, flip backing units from RESERVED to CHECKED_OUT so the
    // unit page shows them as in-use by this active cloud service.
    if (existingReservation.reservationType === 'CLOUD') {
      const allocations = await tx.reservationItemUnit.findMany({
        where: {
          reservationItem: { reservationId: id },
          checkedInAt: null,
        },
        include: { assetUnit: true },
      })
      for (const riu of allocations) {
        if (riu.assetUnit.status === 'RESERVED') {
          await tx.assetUnit.update({
            where: { id: riu.assetUnitId },
            data: { status: 'CHECKED_OUT' },
          })
        }
        if (!riu.checkedOutAt) {
          await tx.reservationItemUnit.update({
            where: { id: riu.id },
            data: { checkedOutAt: new Date() },
          })
        }
      }
    }

    return tx.reservation.update({
      where: { id },
      data: { status: 'ACTIVE' },
    })
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: previousStatus,
      toStatus: 'ACTIVE',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  // Sync ACTIVE (closedwon) to HubSpot (fire-and-forget)
  syncReservationDeal({
    id: reservation.id,
    reservationNumber: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    status: 'ACTIVE',
    total: Number(reservation.total) || 0,
    projectName: reservation.projectName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    rtoTermMonths: reservation.rtoTermMonths,
    rtoMonthlyPayment: reservation.rtoMonthlyPayment ? Number(reservation.rtoMonthlyPayment) : null,
    hubspotDealId: reservation.hubspotDealId,
    clientId: reservation.clientId,
  }).catch(() => {})

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)

  return serialize(reservation)
}

export async function completeReservation(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.$transaction(async (tx) => {
    const existingReservation = await tx.reservation.findUnique({
      where: { id },
      include: {
        items: true,
        checkouts: true,
      },
    })

    if (!existingReservation) {
      throw new Error('Reservation not found')
    }

    if (existingReservation.status !== 'ACTIVE') {
      throw new Error('Reservation must be active to complete')
    }

    // Check all items are returned
    const unreturned = existingReservation.checkouts.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'OVERDUE'
    )

    if (unreturned.length > 0) {
      throw new Error('Cannot complete reservation with unreturned items')
    }

    // CLOUD orders: release backing units back to AVAILABLE — the cloud
    // service has ended so the hardware is free again.
    if (existingReservation.reservationType === 'CLOUD') {
      const allocations = await tx.reservationItemUnit.findMany({
        where: {
          reservationItem: { reservationId: id },
          checkedInAt: null,
        },
        include: { assetUnit: true },
      })
      for (const riu of allocations) {
        if (riu.assetUnit.status === 'CHECKED_OUT' || riu.assetUnit.status === 'RESERVED') {
          await tx.assetUnit.update({
            where: { id: riu.assetUnitId },
            data: { status: 'AVAILABLE' },
          })
        }
        await tx.reservationItemUnit.update({
          where: { id: riu.id },
          data: { checkedInAt: new Date() },
        })
      }
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    return updated
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: id,
      fromStatus: 'ACTIVE',
      toStatus: 'COMPLETED',
      changedById: authResult.userId!,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${id}`)

  return serialize(reservation)
}

// ============================================
// DELETE CANCELLED RESERVATION
// ============================================

export async function deleteReservation(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.reservation.findUnique({ where: { id } })
  if (!existing) throw new Error('Reservation not found')
  if (existing.status !== 'CANCELLED') throw new Error('Only canceled reservations can be deleted')

  await prisma.reservation.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'Reservation',
    entityId: id,
    oldValues: { reservationNumber: existing.reservationNumber, status: existing.status },
    userId: authResult.userId,
  })

  revalidatePath('/dashboard/orders')
  return { success: true }
}

// Check availability for assets in a date range
export async function checkAvailability(assetIds: string[], startDate: Date, endDate: Date, excludeReservationId?: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const conflicts = await prisma.reservationItem.findMany({
    where: {
      assetId: { in: assetIds },
      reservation: {
        id: excludeReservationId ? { not: excludeReservationId } : undefined,
        status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
        OR: [
          {
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        ],
      },
    },
    include: {
      asset: true,
      reservation: true,
    },
  })

  return serialize(conflicts)
}

/**
 * Get available (status=AVAILABLE) units for a set of asset IDs.
 * Used by the unit assignment UI during preparation.
 */
export async function getAvailableUnitsForAssets(assetIds: string[]) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const units = await prisma.assetUnit.findMany({
    where: {
      assetId: { in: assetIds },
      status: 'AVAILABLE',
    },
    select: { id: true, barcode: true, serialNumber: true, assetId: true },
    orderBy: { barcode: 'asc' },
  })
  return serialize(units)
}

// Get product types with available unit counts for a date range
export async function getAvailableAssetsForDates(startDate: Date, endDate: Date) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Get quantities already reserved per asset (product type) in overlapping reservations.
  // Exclude ACTIVE — those items are already CHECKED_OUT so their units are already
  // excluded from the AVAILABLE/RESERVED unit count below.
  const reservedItems = await prisma.reservationItem.findMany({
    where: {
      reservation: {
        status: { in: ['APPROVED', 'PREPARING', 'SHIPPED'] },
        OR: [
          {
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        ],
      },
    },
    select: { assetId: true, quantity: true },
  })

  // Sum reserved quantities per product type (skip ad-hoc items)
  const reservedByAsset = new Map<string, number>()
  for (const item of reservedItems) {
    if (!item.assetId) continue
    const prev = reservedByAsset.get(item.assetId) || 0
    reservedByAsset.set(item.assetId, prev + item.quantity)
  }

  // Get all product types with their unit counts
  const assets = await prisma.asset.findMany({
    where: { retiredAt: null },
    include: {
      category: true,
      units: {
        where: {
          status: { in: ['AVAILABLE', 'RESERVED'] },
        },
        select: { id: true, barcode: true, serialNumber: true, purchasePrice: true, status: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Get avg purchase cost per asset for margin calculations
  const avgCosts = await prisma.assetUnit.groupBy({
    by: ['assetId'],
    where: { purchasePrice: { not: null } },
    _avg: { purchasePrice: true },
  })
  const avgCostMap = new Map<string, number>()
  for (const row of avgCosts) {
    if (row._avg.purchasePrice != null) {
      avgCostMap.set(row.assetId, Number(row._avg.purchasePrice))
    }
  }

  // Return product types with available unit counts
  const result = assets
    .map((asset) => {
      const totalAvailableUnits = asset.units.length
      const reservedCount = reservedByAsset.get(asset.id) || 0
      const availableCount = Math.max(0, totalAvailableUnits - reservedCount)
      // Specific units that can be tagged/allocated (AVAILABLE only), for cloud hosts.
      const availableUnits = asset.units
        .filter((u) => u.status === 'AVAILABLE')
        .map((u) => ({
          id: u.id,
          barcode: u.barcode,
          serialNumber: u.serialNumber,
          purchasePrice: u.purchasePrice != null ? Number(u.purchasePrice) : null,
        }))
      return {
        ...asset,
        units: undefined,
        availableUnits,
        availableCount,
        totalUnits: asset.totalQuantity,
        avgCost: avgCostMap.get(asset.id) ?? null,
      }
    })

  return serialize(result)
}

// Lightweight asset search for "Add Item" on reservation detail
export async function searchAssetsForReservation(query: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  if (!query || query.length < 2) return { assets: [] as any[], units: [] as any[] }

  // Search product types by name/manufacturer/model AND by child unit barcodes
  const [assets, units] = await Promise.all([
    prisma.asset.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { manufacturer: { contains: query, mode: 'insensitive' } },
          { model: { contains: query, mode: 'insensitive' } },
          { units: { some: { barcode: { contains: query, mode: 'insensitive' } } } },
          { units: { some: { serialNumber: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      include: { category: true },
      take: 10,
      orderBy: { name: 'asc' },
    }),
    // Also search units directly by barcode/serial to show specific unit matches
    prisma.assetUnit.findMany({
      where: {
        OR: [
          { barcode: { contains: query, mode: 'insensitive' } },
          { serialNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        asset: { include: { category: true } },
      },
      take: 10,
      orderBy: { barcode: 'asc' },
    }),
  ])

  return serialize({
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category?.name || null,
      dailyRate: Number(a.dailyRate),
      weeklyRate: Number(a.weeklyRate),
      monthlyRate: Number(a.monthlyRate),
    })),
    units: units.map((u) => ({
      id: u.id,
      barcode: u.barcode,
      serialNumber: u.serialNumber,
      status: u.status,
      assetId: u.assetId,
      assetName: u.asset.name,
      category: u.asset.category?.name || null,
      dailyRate: Number(u.asset.dailyRate),
      weeklyRate: Number(u.asset.weeklyRate),
      monthlyRate: Number(u.asset.monthlyRate),
    })),
  })
}

// Search assets eligible to be attached as a component (category.isComponent = true).
export async function searchComponentAssets(query: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const where = query && query.length >= 1
    ? {
        category: { isComponent: true },
        OR: [
          { name: { contains: query, mode: 'insensitive' as const } },
          { manufacturer: { contains: query, mode: 'insensitive' as const } },
          { model: { contains: query, mode: 'insensitive' as const } },
        ],
      }
    : { category: { isComponent: true } }

  const assets = await prisma.asset.findMany({
    where,
    include: { category: true },
    take: 20,
    orderBy: { name: 'asc' },
  })

  return serialize(
    assets.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category?.name || null,
      manufacturer: a.manufacturer || null,
      model: a.model || null,
      dailyRate: Number(a.dailyRate || 0),
      weeklyRate: Number(a.weeklyRate || 0),
      monthlyRate: Number(a.monthlyRate || 0),
      salePrice: Number(a.salePrice || 0),
    }))
  )
}

// Clear maintenance status on a unit so it can be added to a reservation
export async function clearUnitMaintenance(unitId: string, note: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    include: { asset: true },
  })

  if (!unit) throw new Error('Unit not found')
  if (unit.status !== 'MAINTENANCE') throw new Error('Unit is not in maintenance')

  await prisma.$transaction(async (tx) => {
    // Mark any active maintenance records as completed
    await tx.maintenanceRecord.updateMany({
      where: {
        assetUnitId: unitId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      data: {
        status: 'COMPLETED',
        completionDate: new Date(),
        returnDate: new Date(),
        workPerformed: note || 'Cleared for reservation',
      },
    })

    // Return unit to available
    await tx.assetUnit.update({
      where: { id: unitId },
      data: { status: 'AVAILABLE' },
    })
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return { cleared: true, unitId, assetId: unit.assetId }
}

// Get calendar data for a date range
export async function getReservationCalendarData(startDate: Date, endDate: Date) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservations = await prisma.reservation.findMany({
    where: {
      status: { in: ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'REVISION', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
      OR: [
        {
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      ],
    },
    include: {
      client: true,
      items: {
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              assetNumber: true,
            },
          },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  })

  return serialize(reservations)
}

export async function getReservationStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [total, draft, quoteSent, approved, preparing, shipped, active, completed] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: { in: ['DRAFT', 'REVISION'] } } }),
    prisma.reservation.count({ where: { status: 'QUOTE_SENT' } }),
    prisma.reservation.count({ where: { status: 'APPROVED' } }),
    prisma.reservation.count({ where: { status: 'PREPARING' } }),
    prisma.reservation.count({ where: { status: 'SHIPPED' } }),
    prisma.reservation.count({ where: { status: 'ACTIVE' } }),
    prisma.reservation.count({ where: { status: 'COMPLETED' } }),
  ])

  return {
    total,
    draft,
    confirmed: approved,
    quoteSent,
    approved,
    preparing,
    shipped,
    active,
    completed,
  }
}

// ============================================
// RESERVATION-BASED CHECK-OUT / CHECK-IN
// ============================================

export type CheckoutItemData = {
  conditionOut?: string
  notes?: string
  /**
   * How to resolve a unit scanned beyond the line's ordered quantity. Absent
   * means "don't decide for me": the checkout stops and returns the conflict so
   * a person can answer it. See lib/reservations/over-scan.ts for why this is
   * no longer a silent default.
   */
  onOverScan?: OverScanResolution
}

export type CheckinItemData = {
  conditionIn?: string
  returnCondition?: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'DAMAGED'
  damageFlag?: boolean
  damageNotes?: string
  notes?: string
}

// ============================================
// UNIT ASSIGNMENT (soft-assign during prep)
// ============================================

/**
 * Assign a specific unit to a reservation item during preparation.
 * Does NOT check out — just earmarks the unit so it can't be assigned elsewhere.
 */
export async function assignUnit(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { items: { where: { id: reservationItemId } } },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (!['APPROVED', 'PREPARING'].includes(reservation.status)) {
      throw new Error('Can only assign units during Approved or Preparing status')
    }
    const item = reservation.items[0]
    if (!item) throw new Error('Reservation item not found')
    if (item.assignedCount >= item.quantity) {
      throw new Error('All units for this item are already assigned')
    }

    // Check unit is available
    const unit = await tx.assetUnit.findUnique({ where: { id: assetUnitId } })
    if (!unit || unit.status !== 'AVAILABLE') {
      throw new Error('Unit is not available for assignment')
    }

    // Check unit isn't already assigned to another active reservation item
    const existingAssignment = await tx.reservationItemUnit.findFirst({
      where: {
        assetUnitId,
        assignedAt: { not: null },
        checkedOutAt: null,
        reservationItem: {
          reservation: { status: { in: ['APPROVED', 'PREPARING'] } },
        },
      },
    })
    if (existingAssignment) {
      throw new Error('Unit is already assigned to another order')
    }

    // Create assignment
    await tx.reservationItemUnit.upsert({
      where: {
        reservationItemId_assetUnitId: { reservationItemId, assetUnitId },
      },
      create: { reservationItemId, assetUnitId, assignedAt: new Date() },
      update: { assignedAt: new Date(), checkedInAt: null },
    })

    // Increment assigned count
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: { assignedCount: { increment: 1 } },
    })

    // Mark unit as RESERVED
    await tx.assetUnit.update({
      where: { id: assetUnitId },
      data: { status: 'RESERVED' },
    })

    revalidatePath(`/dashboard/orders/${reservationId}`)
    return { success: true }
  })
}

/**
 * Unassign a unit from a reservation item (during prep, before checkout).
 */
export async function unassignUnit(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { items: { where: { id: reservationItemId } } },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (!['APPROVED', 'PREPARING'].includes(reservation.status)) {
      throw new Error('Can only unassign units during Approved or Preparing status')
    }

    // Find the assignment (must be assigned but NOT checked out)
    const assignment = await tx.reservationItemUnit.findUnique({
      where: {
        reservationItemId_assetUnitId: { reservationItemId, assetUnitId },
      },
    })
    if (!assignment || !assignment.assignedAt) {
      throw new Error('Unit is not assigned to this item')
    }
    if (assignment.checkedOutAt && !assignment.checkedInAt) {
      throw new Error('Unit is checked out — check it in first before unassigning')
    }

    // Remove assignment
    await tx.reservationItemUnit.delete({
      where: { id: assignment.id },
    })

    // Decrement assigned count
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: { assignedCount: { decrement: 1 } },
    })

    // Restore unit to AVAILABLE
    await tx.assetUnit.update({
      where: { id: assetUnitId },
      data: { status: 'AVAILABLE' },
    })

    revalidatePath(`/dashboard/orders/${reservationId}`)
    return { success: true }
  })
}

// Check out a single unit for a reservation item
export async function checkoutReservationItem(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string,
  data: CheckoutItemData = {}
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    // Get reservation and item
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        client: true,
        items: {
          where: { id: reservationItemId },
          include: { asset: true },
        },
      },
    })

    if (!reservation) {
      return { error: 'Reservation not found' } as const
    }

    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      return { error: 'Order must be in Preparing status or later to check out items. Click "Start Preparing" first.' } as const
    }

    const item = reservation.items[0]
    if (!item) {
      return { error: 'Reservation item not found' } as const
    }

    // Over-scan: this unit goes beyond what the line says was ordered.
    //
    // v1 widened the order here without asking and repriced the line with it.
    // That is how the custody import doubled 48 lines, and it means a scan at
    // the shelf could move an invoice. Now the caller has to say which way out
    // it wants; with nothing said, nothing is written and the conflict comes
    // back for a person to answer.
    if (item.checkedOutCount >= item.quantity) {
      if (!data.onOverScan) {
        return {
          conflict: {
            kind: 'over-quantity',
            reservationItemId,
            ordered: item.quantity,
            alreadyOut: item.checkedOutCount,
            rate: Number(item.rate),
            pricingType: item.pricingType,
            label: item.asset?.name ?? item.description ?? 'This line',
          } satisfies OverScanConflict,
        } as const
      }

      if (data.onOverScan === 'new-line') {
        // The extra unit belongs on its own line, which has to exist before it
        // can be scanned onto it. addItemToReservation then checkout — this
        // path deliberately refuses rather than guessing a rate.
        return {
          error: 'Add the new line first, then check the unit out against it.',
        } as const
      }

      const nextQuantity = item.checkedOutCount + 1
      const periods = calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
      await tx.reservationItem.update({
        where: { id: reservationItemId },
        data: {
          quantity: nextQuantity,
          // 'no-charge' widens the line so the unit is tracked, but leaves the
          // money alone — a swap, a spare, or a goodwill loan. A part that's
          // included in its parent's price stays at zero either way.
          ...(data.onOverScan === 'expand'
            ? { subtotal: unitChargeFor(item, computeItemSubtotal(Number(item.rate), nextQuantity, periods)) }
            : {}),
        },
      })
    }

    // Verify the asset unit exists, belongs to the correct product type, and is available
    const assetUnit = await tx.assetUnit.findUnique({
      where: { id: assetUnitId },
    })

    if (!assetUnit) {
      throw new Error('Asset unit not found')
    }

    if (assetUnit.assetId !== item.assetId) {
      throw new Error('Asset unit does not match the product type for this reservation item')
    }

    // Allow AVAILABLE units and RESERVED units that are assigned to this item
    if (assetUnit.status !== 'AVAILABLE') {
      if (assetUnit.status === 'RESERVED') {
        const assignment = await tx.reservationItemUnit.findUnique({
          where: {
            reservationItemId_assetUnitId: {
              reservationItemId: item.id,
              assetUnitId,
            },
          },
        })
        if (!assignment || !assignment.assignedAt) {
          throw new Error(`Asset unit ${assetUnit.barcode} is reserved for another order`)
        }
      } else {
        throw new Error(`Asset unit ${assetUnit.barcode} is not available (status: ${assetUnit.status})`)
      }
    }

    // Per-unit charge for this booking = rate × billing periods. Stored on the
    // checkout so the unit's earned revenue can be derived from it.
    const unitPeriods = calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
    // A part that's included in its system's base price checks out at no charge.
    const unitCharge = unitChargeFor(item, computeItemSubtotal(Number(item.rate), 1, unitPeriods))

    // Create checkout record linked to reservation (using assetUnitId)
    const checkout = await tx.checkout.create({
      data: {
        assetUnitId,
        clientId: reservation.clientId,
        reservationId: reservation.id,
        workflowType: 'RESERVATION',
        status: 'ACTIVE',
        checkoutDate: new Date(),
        expectedReturn: reservation.endDate,
        pricingType: item.pricingType,
        rate: item.rate,
        totalCharge: unitCharge,
        conditionOut: data.conditionOut,
        notes: data.notes,
        createdById: authResult.userId,
      },
    })

    // Create or re-activate ReservationItemUnit junction record
    // (handles re-checkout of a previously returned unit)
    await tx.reservationItemUnit.upsert({
      where: {
        reservationItemId_assetUnitId: {
          reservationItemId: item.id,
          assetUnitId,
        },
      },
      create: {
        reservationItemId: item.id,
        assetUnitId,
        checkedOutAt: new Date(),
        checkoutId: checkout.id,
      },
      update: {
        checkedOutAt: new Date(),
        checkedInAt: null,
        checkoutId: checkout.id,
      },
    })

    // Increment checkedOutCount on reservation item
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: {
        checkedOutCount: { increment: 1 },
      },
    })

    // Update asset unit status
    await tx.assetUnit.update({
      where: { id: assetUnitId },
      data: { status: 'CHECKED_OUT' },
    })
    // Credit the unit's earned revenue now that it's checked out
    await recomputeUnitRevenue(tx, assetUnitId)

    // Set nextBillingDate on first checkout if not already set and billing is recurring
    // Never for Flow: it is billed from its schedule, not by the billing run.
    if (!reservation.nextBillingDate && reservation.billingCycleType !== 'ONE_TIME' && reservation.reservationType !== 'FLOW') {
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          // From the term start, not the checkout moment: the first invoice
          // covers the start up to this date, so gear pulled late does not
          // move the day the order bills on.
          nextBillingDate: calculateNextBillingDate(
            reservation.startDate,
            reservation.billingCycleType as BillingCycleType,
            reservation.billingCycleDay,
            reservation.billingCycleDays ?? undefined,
            await getBillingAnchor()
          ),
        },
      })
    }

    // Recalculate reservation totals (in case quantity was auto-expanded)
    const allItems = await tx.reservationItem.findMany({ where: { reservationId } })
    const newSubtotal = allItems.reduce((sum, ri) => sum + Number(ri.subtotal), 0)
    const { discountAmount, taxAmount: newTaxAmount, total: newTotal } = calculateReservationTotals({
      itemsSubtotal: newSubtotal,
      discountType: reservation.discountType,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: Number(reservation.deliveryCost) || 0,
      returnCost: Number(reservation.returnCost) || 0,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })
    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal: newSubtotal, discountAmount, taxAmount: newTaxAmount, total: newTotal },
    })
    await maybeRecalcRto(tx, reservationId, newTotal)
    await maybeRecalcFlow(tx, reservationId)

    // The first scan on an approved order starts preparing it. It no longer
    // activates it: an order is activated only once everything is out, and
    // deliberately, through its Activate step (owner, 2026-09-17).
    if (reservation.status === 'APPROVED') {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'PREPARING', preparingAt: reservation.preparingAt ?? new Date() },
      })
    }

    // Auto-generate invoice when all items are fully checked out
    await maybeAutoInvoice(tx, reservationId)

    return checkout
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')

  return serialize(result)
}

// Check in a single unit from a reservation
export async function checkinReservationItem(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string,
  data: CheckinItemData = {}
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    // Get reservation
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          where: { id: reservationItemId },
        },
      },
    })

    if (!reservation) {
      throw new Error('Reservation not found')
    }

    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      throw new Error('Reservation must be preparing, shipped, or active to check in items')
    }

    const item = reservation.items[0]
    if (!item) {
      throw new Error('Reservation item not found')
    }

    // No counter-based guard here. It used to refuse when
    // checkedInCount >= checkedOutCount, which blocks a physically-out unit
    // from coming back whenever the counters have drifted low — SALE-2026-00006
    // carries 0/0 against a unit that is genuinely out, and could never have
    // been returned. The unit row below is the physical record and the only
    // thing worth asking: if this unit is out on this line, it can come back.

    // Find the ReservationItemUnit for this specific unit
    const reservationItemUnit = await tx.reservationItemUnit.findFirst({
      where: {
        reservationItemId: item.id,
        assetUnitId,
        checkedOutAt: { not: null },
        checkedInAt: null,
      },
    })

    if (!reservationItemUnit) {
      throw new Error('This unit is not checked out for this reservation item')
    }

    // Find the active checkout for this unit
    const checkout = await tx.checkout.findFirst({
      where: {
        reservationId: reservation.id,
        assetUnitId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
    })

    if (!checkout) {
      throw new Error('No active checkout found for this unit')
    }

    // Update checkout record
    await tx.checkout.update({
      where: { id: checkout.id },
      data: {
        status: 'RETURNED',
        actualReturn: new Date(),
        conditionIn: data.conditionIn,
        returnCondition: data.returnCondition,
        damageFlag: data.damageFlag || false,
        damageNotes: data.damageNotes,
        checkedInById: authResult.userId,
        notes: data.notes
          ? checkout.notes
            ? `${checkout.notes}\n\nReturn notes: ${data.notes}`
            : `Return notes: ${data.notes}`
          : checkout.notes,
      },
    })

    // Update ReservationItemUnit
    await tx.reservationItemUnit.update({
      where: { id: reservationItemUnit.id },
      data: {
        checkedInAt: new Date(),
      },
    })

    // Increment checkedInCount on reservation item
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: {
        checkedInCount: { increment: 1 },
      },
    })

    // Update asset unit status. Revenue was already credited at checkout and is
    // derived from the checkout charge (which persists through RETURNED), so we
    // only re-derive here rather than incrementing again.
    const newStatus = data.damageFlag ? 'MAINTENANCE' : 'AVAILABLE'
    await tx.assetUnit.update({
      where: { id: assetUnitId },
      data: { status: newStatus },
    })
    await recomputeUnitRevenue(tx, assetUnitId)

    // If damaged, create maintenance record (references assetUnitId)
    if (data.damageFlag) {
      const desc = data.damageNotes
        ? `Damage reported on check-in: ${data.damageNotes}`
        : 'Damage reported on check-in (no details provided)'
      await tx.maintenanceRecord.create({
        data: {
          assetUnitId,
          type: 'DAMAGE_REPAIR',
          status: 'SCHEDULED',
          description: desc,
          fromCheckoutId: checkout.id,
          damageDescription: data.damageNotes || null,
        },
      })
    }

    // Check if all items across the reservation are fully returned
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId: reservation.id },
    })

    const allReturned = allItems.every((i) => {
      const outCount = i.checkedOutCount
      const inCount = i.id === reservationItemId ? i.checkedInCount + 1 : i.checkedInCount
      // Item must have been checked out AND fully returned to count as done
      return outCount > 0 && inCount >= outCount
    })

    if (allReturned) {
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      })
      await tx.statusHistory.create({
        data: {
          entityType: 'RESERVATION',
          entityId: reservation.id,
          fromStatus: 'ACTIVE',
          toStatus: 'COMPLETED',
          notes: 'Auto-completed: all items returned',
        },
      })
    }

    return { checkout, allReturned }
  })

  if ('error' in result) return result

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')

  return serialize(result)
}

// Bulk check out all pending items from a reservation
export async function bulkCheckoutReservation(
  reservationId: string,
  itemIds?: string[],
  data: CheckoutItemData = {}
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        client: true,
        items: {
          where: {
            // Parts inside a system check out like any line; cloud config rows and
            // lines from an option the client didn't choose never do.
            ...CHECKOUT_LINE_WHERE,
            ...(itemIds ? { id: { in: itemIds } } : {}),
          },
          include: { asset: true },
        },
      },
    })

    if (!reservation) {
      return { error: 'Reservation not found' } as const
    }

    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      return { error: 'Order must be in Preparing status or later to check out items. Click "Start Preparing" first.' } as const
    }

    // Filter to items that still have units to check out
    const pendingItems = reservation.items.filter(
      (item) => item.checkedOutCount < item.quantity
    )

    if (pendingItems.length === 0) {
      return { error: 'No pending items to check out' } as const
    }

    const checkouts = []

    for (const item of pendingItems) {
      // Skip ad-hoc items — no physical units to check out
      if (!item.assetId) continue

      const neededCount = item.quantity - item.checkedOutCount

      // Prefer pre-assigned (RESERVED) units first, then fill with AVAILABLE
      const assignedJunctions = await tx.reservationItemUnit.findMany({
        where: {
          reservationItemId: item.id,
          assignedAt: { not: null },
          checkedOutAt: null,
        },
        include: { assetUnit: true },
        take: neededCount,
      })
      const assignedUnits = assignedJunctions
        .map((j) => j.assetUnit)
        .filter((u) => u.status === 'RESERVED')

      const remainingCount = neededCount - assignedUnits.length
      const extraUnits = remainingCount > 0
        ? await tx.assetUnit.findMany({
            where: {
              assetId: item.assetId,
              status: 'AVAILABLE',
              id: { notIn: assignedUnits.map((u) => u.id) },
            },
            take: remainingCount,
          })
        : []

      const availableUnits = [...assignedUnits, ...extraUnits]

      if (availableUnits.length < neededCount) {
        throw new Error(
          `Not enough available units for "${item.asset?.name || item.description || 'Unknown'}": need ${neededCount}, only ${availableUnits.length} available`
        )
      }

      // Per-unit charge for this booking = rate × billing periods.
      const itemPeriods = calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
      const itemUnitCharge = unitChargeFor(item, computeItemSubtotal(Number(item.rate), 1, itemPeriods))

      for (const unit of availableUnits) {
        // Create checkout
        const checkout = await tx.checkout.create({
          data: {
            assetUnitId: unit.id,
            clientId: reservation.clientId,
            reservationId: reservation.id,
            workflowType: 'RESERVATION',
            status: 'ACTIVE',
            checkoutDate: new Date(),
            expectedReturn: reservation.endDate,
            pricingType: item.pricingType,
            rate: item.rate,
            totalCharge: itemUnitCharge,
            conditionOut: data.conditionOut,
            notes: data.notes,
            createdById: authResult.userId,
          },
        })
        checkouts.push(checkout)

        // Create or re-activate ReservationItemUnit junction
        await tx.reservationItemUnit.upsert({
          where: {
            reservationItemId_assetUnitId: {
              reservationItemId: item.id,
              assetUnitId: unit.id,
            },
          },
          create: {
            reservationItemId: item.id,
            assetUnitId: unit.id,
            checkedOutAt: new Date(),
            checkoutId: checkout.id,
          },
          update: {
            checkedOutAt: new Date(),
            checkedInAt: null,
            checkoutId: checkout.id,
          },
        })

        // Update unit status
        await tx.assetUnit.update({
          where: { id: unit.id },
          data: { status: 'CHECKED_OUT' },
        })
        // Credit the unit's earned revenue now that it's checked out
        await recomputeUnitRevenue(tx, unit.id)
      }

      // Update item checkedOutCount
      await tx.reservationItem.update({
        where: { id: item.id },
        data: {
          checkedOutCount: { increment: availableUnits.length },
        },
      })
    }

    // Set nextBillingDate on first checkout if not already set and billing is recurring
    // Never for Flow: it is billed from its schedule, not by the billing run.
    if (!reservation.nextBillingDate && reservation.billingCycleType !== 'ONE_TIME' && reservation.reservationType !== 'FLOW') {
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          // From the term start, not the checkout moment: the first invoice
          // covers the start up to this date, so gear pulled late does not
          // move the day the order bills on.
          nextBillingDate: calculateNextBillingDate(
            reservation.startDate,
            reservation.billingCycleType as BillingCycleType,
            reservation.billingCycleDay,
            reservation.billingCycleDays ?? undefined,
            await getBillingAnchor()
          ),
        },
      })
    }

    // The first scan on an approved order starts preparing it. It no longer
    // activates it: an order is activated only once everything is out, and
    // deliberately, through its Activate step (owner, 2026-09-17).
    if (reservation.status === 'APPROVED') {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'PREPARING', preparingAt: reservation.preparingAt ?? new Date() },
      })
    }

    // Auto-generate invoice when all items are fully checked out
    await maybeAutoInvoice(tx, reservationId)

    return { checkouts, count: checkouts.length }
  })

  if ('error' in result) return result

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')

  return serialize(result)
}

// Bulk check in all checked-out items from a reservation
export async function bulkCheckinReservation(
  reservationId: string,
  itemIds?: string[],
  data: CheckinItemData = {}
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          where: itemIds ? { id: { in: itemIds } } : undefined,
          include: {
            asset: true,
            units: {
              where: {
                checkedOutAt: { not: null },
                checkedInAt: null,
              },
              include: { assetUnit: true },
            },
          },
        },
      },
    })

    if (!reservation) {
      throw new Error('Reservation not found')
    }

    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      throw new Error('Reservation must be preparing, shipped, or active to check in items')
    }

    // Filter to items that have checked-out units not yet returned
    const itemsWithPendingUnits = reservation.items.filter(
      (item) => item.units.length > 0
    )

    if (itemsWithPendingUnits.length === 0) {
      throw new Error('No checked-out items to return')
    }

    let returnedCount = 0

    for (const item of itemsWithPendingUnits) {
      for (const riu of item.units) {
        // Find active checkout for this unit
        const checkout = await tx.checkout.findFirst({
          where: {
            reservationId: reservation.id,
            assetUnitId: riu.assetUnitId,
            status: { in: ['ACTIVE', 'OVERDUE'] },
          },
        })

        if (checkout) {
          // Update checkout
          await tx.checkout.update({
            where: { id: checkout.id },
            data: {
              status: 'RETURNED',
              actualReturn: new Date(),
              conditionIn: data.conditionIn,
              returnCondition: data.returnCondition,
              checkedInById: authResult.userId,
              notes: data.notes
                ? checkout.notes
                  ? `${checkout.notes}\n\nReturn notes: ${data.notes}`
                  : `Return notes: ${data.notes}`
                : checkout.notes,
            },
          })

          // Update asset unit status. Revenue was credited at checkout and is
          // derived from the checkout charge, so re-derive rather than increment.
          await tx.assetUnit.update({
            where: { id: riu.assetUnitId },
            data: { status: 'AVAILABLE' },
          })
          await recomputeUnitRevenue(tx, riu.assetUnitId)

          returnedCount++
        }

        // Mark ReservationItemUnit as checked in
        await tx.reservationItemUnit.update({
          where: { id: riu.id },
          data: {
            checkedInAt: new Date(),
          },
        })
      }

      // Update item checkedInCount
      await tx.reservationItem.update({
        where: { id: item.id },
        data: {
          checkedInCount: { increment: item.units.length },
        },
      })
    }

    // Only complete if ALL items are fully checked out and returned
    const allItems = await tx.reservationItem.findMany({
      where: { reservationId },
      select: { quantity: true, checkedOutCount: true, checkedInCount: true },
    })
    const allReturned = allItems.every((i) =>
      i.checkedOutCount > 0 && i.checkedInCount >= i.checkedOutCount
    )

    if (allReturned) {
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      })
      await tx.statusHistory.create({
        data: {
          entityType: 'RESERVATION',
          entityId: reservationId,
          fromStatus: 'ACTIVE',
          toStatus: 'COMPLETED',
          notes: 'Auto-completed: all items returned',
        },
      })
    }

    return { count: returnedCount, completed: allReturned }
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')

  return serialize(result)
}

// Result type for barcode scan operations (avoids thrown errors being stripped in production)
export type ScanResult =
  | { success: true; warning?: string }
  | { success: false; error: string }
  /** The scan is refused pending a decision — see lib/reservations/over-scan.ts. */
  | { success: false; conflict: OverScanConflict }

// Check out item by barcode within a reservation
export async function checkoutByBarcode(
  reservationId: string,
  barcode: string,
  data: CheckoutItemData = {}
): Promise<ScanResult> {
  try {
    const authResult = await requireEditor()
    if (!authResult.authorized) return { success: false, error: authResult.error || 'Unauthorized' }

    // Find the asset unit by barcode (include asset for rate info)
    const assetUnit = await prisma.assetUnit.findUnique({
      where: { barcode },
      include: { asset: true },
    })

    if (!assetUnit) {
      return { success: false, error: `Asset unit not found for barcode: ${barcode}` }
    }

    // Fetch reservation dates for period calculation
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { startDate: true, endDate: true, isRecurring: true, reservationType: true },
    })
    if (!reservation) return { success: false, error: 'Reservation not found' }

    // Find existing reservation item for this asset type, or create one ad hoc.
    // Which lines are checkout targets, and which one a scanned unit lands on,
    // is decided by lib/checkout/lines.ts.
    const candidateItems = await prisma.reservationItem.findMany({
      where: { reservationId, assetId: assetUnit.assetId, ...CHECKOUT_LINE_WHERE },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    // The line this exact unit was assigned to while preparing, if any.
    const assigned = candidateItems.length
      ? await prisma.reservationItemUnit.findFirst({
          where: { assetUnitId: assetUnit.id, reservationItemId: { in: candidateItems.map((i) => i.id) }, checkedOutAt: null },
          select: { reservationItemId: true },
        })
      : null
    let reservationItem = pickScanLine(candidateItems, assigned?.reservationItemId ?? null)

    if (!reservationItem && reservation.reservationType === 'FLOW') {
      // A Flow line is priced off landed cost when it is added to the order; an
      // ad hoc line from a scan would carry a rental rate as a contract value (v1).
      return { success: false, error: `${assetUnit.asset.name} is not on this Flow order — add it to the order first.` }
    }

    if (!reservationItem) {
      // Ad hoc add: create a new reservation item for this asset type.
      // Pick the most appropriate rate from the asset (prefer monthly when set,
      // then weekly, then daily) so we never insert a $0/DAILY placeholder line
      // when the asset is actually priced on another cycle.
      const { rate, pricingType } = pickAssetGeneralRate(assetUnit.asset)
      const periods = calculatePeriodsSync(reservation.startDate, reservation.endDate, pricingType, reservation.isRecurring)

      // Attach to the first active package (or any package) so the line is
      // visible in the order's equipment list — orphan items with packageId=null
      // can be hidden in package-grouped UIs.
      const targetPackage = await prisma.package.findFirst({
        where: { reservationId },
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
        select: { id: true },
      })

      // Place the new line at the end of the existing items
      const maxSort = await prisma.reservationItem.aggregate({
        where: { reservationId },
        _max: { sortOrder: true },
      })

      reservationItem = await prisma.reservationItem.create({
        data: {
          reservationId,
          assetId: assetUnit.assetId,
          packageId: targetPackage?.id,
          pricingType,
          rate,
          quantity: 1,
          subtotal: computeItemSubtotal(rate, 1, periods),
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
      })
    }

    // The over-scan case is no longer widened here. checkoutReservationItem owns
    // that decision now, and hands the conflict back when nobody has made it.
    const result = await checkoutReservationItem(reservationId, reservationItem.id, assetUnit.id, data)
    if (result && 'conflict' in result && result.conflict) {
      return { success: false, conflict: result.conflict }
    }
    if (result && 'error' in result && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Checkout failed' }
  }
}

// Check in item by barcode within a reservation
export async function checkinByBarcode(
  reservationId: string,
  barcode: string,
  data: CheckinItemData = {}
): Promise<ScanResult> {
  try {
    const authResult = await requireEditor()
    if (!authResult.authorized) return { success: false, error: authResult.error || 'Unauthorized' }

    // Find the asset unit by barcode
    const assetUnit = await prisma.assetUnit.findUnique({
      where: { barcode },
    })

    if (!assetUnit) {
      return { success: false, error: `Asset unit not found for barcode: ${barcode}` }
    }

    // Find the active ReservationItemUnit for this unit in this reservation
    const reservationItemUnit = await prisma.reservationItemUnit.findFirst({
      where: {
        assetUnitId: assetUnit.id,
        checkedOutAt: { not: null },
        checkedInAt: null,
        reservationItem: {
          reservationId,
        },
      },
      include: {
        reservationItem: true,
      },
    })

    if (!reservationItemUnit) {
      return { success: false, error: `Asset unit ${barcode} is not checked out from this reservation` }
    }

    await checkinReservationItem(
      reservationId,
      reservationItemUnit.reservationItemId,
      assetUnit.id,
      data
    )
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Check-in failed' }
  }
}

// Quick walk-up checkout -- creates reservation + checks out in one step
export type QuickCheckoutData = {
  clientId: string
  assetIds: string[] // product type IDs
  expectedReturn: Date
  notes?: string
  projectName?: string
}

export async function quickCheckout(data: QuickCheckoutData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    // Load product types
    const assets = await tx.asset.findMany({
      where: { id: { in: data.assetIds } },
    })

    if (assets.length !== data.assetIds.length) {
      throw new Error('One or more product types not found')
    }

    // For each product type, find one available unit
    const unitsByAsset: { asset: typeof assets[0]; unit: { id: string; barcode: string } }[] = []
    for (const asset of assets) {
      const unit = await tx.assetUnit.findFirst({
        where: {
          assetId: asset.id,
          status: 'AVAILABLE',
        },
        select: { id: true, barcode: true },
      })

      if (!unit) {
        throw new Error(`No available unit for product type "${asset.name}"`)
      }

      unitsByAsset.push({ asset, unit })
    }

    // Generate reservation number (pattern: Settings → Business → Numbering)
    const reservationNumber = await nextNumber('rental', tx)

    // Build items with default rates (term-based)
    const quickStart = new Date()
    let subtotal = 0
    const items = unitsByAsset.map(({ asset }) => {
      const rate = Number(asset.dailyRate) || Number(asset.weeklyRate) || Number(asset.monthlyRate) || 0
      const periods = calculatePeriodsSync(quickStart, data.expectedReturn, 'DAILY')
      const itemSubtotal = computeItemSubtotal(rate, 1, periods)
      subtotal += itemSubtotal
      return {
        assetId: asset.id,
        pricingType: 'DAILY' as const,
        rate,
        quantity: 1,
        subtotal: itemSubtotal,
      }
    })

    // Create reservation as ACTIVE (skip DRAFT/APPROVED) with default package
    const reservation = await tx.reservation.create({
      data: {
        reservationNumber,
        clientId: data.clientId,
        reservationType: 'RENTAL',
        startDate: businessToday(),
        endDate: intendedDay(data.expectedReturn),
        projectName: data.projectName || 'Quick Checkout',
        notes: data.notes,
        status: 'ACTIVE',
        confirmedAt: new Date(),
        createdById: authResult.userId,
        billingCycleType: 'ONE_TIME',
        subtotal,
        total: subtotal,
        packages: {
          create: { name: 'Default', isActive: true, sortOrder: 0 },
        },
      },
      include: { packages: true },
    })

    // Link items to the default package
    const defaultPkgId = reservation.packages[0].id
    await tx.reservationItem.createMany({
      data: items.map((item, index) => ({
        reservationId: reservation.id,
        packageId: defaultPkgId,
        ...item,
        sortOrder: index,
      })),
    })
    // Re-fetch items for checkout processing
    const createdItems = await tx.reservationItem.findMany({
      where: { reservationId: reservation.id },
      orderBy: { sortOrder: 'asc' },
    })

    // Check out each unit and create checkout + junction records
    for (let i = 0; i < createdItems.length; i++) {
      const resItem = createdItems[i]
      const { unit } = unitsByAsset[i]

      const checkout = await tx.checkout.create({
        data: {
          assetUnitId: unit.id,
          clientId: data.clientId,
          reservationId: reservation.id,
          workflowType: 'RESERVATION',
          status: 'ACTIVE',
          checkoutDate: new Date(),
          expectedReturn: data.expectedReturn,
          pricingType: resItem.pricingType,
          rate: resItem.rate,
          // Per-unit charge = rate × periods; item is qty 1 so subtotal is the charge.
          totalCharge: Number(resItem.subtotal),
          createdById: authResult.userId,
        },
      })

      await tx.reservationItemUnit.upsert({
        where: {
          reservationItemId_assetUnitId: {
            reservationItemId: resItem.id,
            assetUnitId: unit.id,
          },
        },
        create: {
          reservationItemId: resItem.id,
          assetUnitId: unit.id,
          checkedOutAt: new Date(),
          checkoutId: checkout.id,
        },
        update: {
          checkedOutAt: new Date(),
          checkedInAt: null,
          checkoutId: checkout.id,
        },
      })

      await tx.reservationItem.update({
        where: { id: resItem.id },
        data: { checkedOutCount: 1 },
      })

      await tx.assetUnit.update({
        where: { id: unit.id },
        data: { status: 'CHECKED_OUT' },
      })
      // Credit the unit's earned revenue now that it's checked out
      await recomputeUnitRevenue(tx, unit.id)
    }

    return reservation
  })

  revalidatePath('/dashboard/orders')
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(result)
}

// Duplicate an existing reservation as a new DRAFT
export async function duplicateReservation(
  reservationId: string,
  options?: { targetType?: ReservationType; rtoTermMonths?: number }
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Settle the new type and read everything global before the transaction opens:
  // the number for that type and the billing anchor (duplicateOrderTx reads only
  // through the transaction it is handed).
  const source = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { reservationType: true } })
  if (!source) throw new Error('Reservation not found')
  const targetType = duplicateTargetType(source.reservationType, options?.targetType)
  const reservationNumber = await generateReservationNumber(targetType)
  const billingAnchor = await getBillingAnchor()

  const newReservation = await prisma.$transaction(
    (tx) => duplicateOrderTx(tx, reservationId, {
      targetType,
      rtoTermMonths: options?.rtoTermMonths,
      userId: authResult.userId,
      reservationNumber,
      billingAnchor,
    }),
    { timeout: 30_000 },
  )

  revalidatePath('/dashboard/orders')
  revalidatePath('/dashboard/rent-to-own')

  return serialize(newReservation)
}

// Send quote email for a draft reservation
export async function sendQuoteEmail(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      items: {
        include: {
          asset: { include: { category: true } },
        },
      },
    },
  })

  if (!reservation) throw new Error('Reservation not found')
  // A Flow line's rate is its contract value, which this email would print as a
  // monthly rate. Flow quotes go out through the client quote link and its PDF.
  if (reservation.reservationType === 'FLOW') {
    throw new Error("A Flow order's quote is sent with the client quote link, not this email.")
  }
  if (reservation.status !== 'DRAFT') throw new Error('Can only send quotes for draft reservations')
  if (!reservation.client.email) throw new Error('Client has no email address')

  // Group items by category
  const itemsByCategory = new Map<string, typeof reservation.items>()
  for (const item of reservation.items) {
    const categoryName = item.asset?.category?.name || 'Uncategorized'
    const existing = itemsByCategory.get(categoryName) || []
    existing.push(item)
    itemsByCategory.set(categoryName, existing)
  }

  const { reservationQuoteEmail } = await import('@/lib/email/templates')
  const { sendEmail } = await import('@/lib/email')

  const template = reservationQuoteEmail({
    clientName: reservation.client.name,
    reservationNumber: reservation.reservationNumber,
    startDate: new Date(reservation.startDate).toLocaleDateString(),
    endDate: new Date(reservation.endDate).toLocaleDateString(),
    reservationType: reservation.reservationType,
    itemsByCategory: Array.from(itemsByCategory.entries()).map(([category, items]) => ({
      category,
      items: items.map((item) => ({
        name: item.asset?.name || item.description || 'Ad-hoc item',
        quantity: item.quantity,
        pricingType: item.pricingType,
        rate: Number(item.rate),
        subtotal: Number(item.subtotal),
      })),
    })),
    subtotal: Number(reservation.subtotal),
    taxRate: Number(reservation.taxRate),
    taxAmount: Number(reservation.taxAmount),
    total: Number(reservation.total),
    notes: reservation.notes || undefined,
    projectName: reservation.projectName || undefined,
  })

  await sendEmail({
    to: reservation.client.email,
    subject: template.subject,
    html: template.html,
  })

  return { success: true }
}

// ============================================
// Package CRUD (multi-option quotes)
// ============================================

export async function createPackage(
  reservationId: string,
  name: string,
  description?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { packages: true },
  })
  if (!reservation) throw new Error('Reservation not found')
  if (!PACKAGE_EDITABLE_STATUSES.includes(reservation.status)) {
    throw new Error('Packages can only be changed before the order enters fulfillment')
  }

  const trimmedName = name?.trim()
  if (!trimmedName) throw new Error('Package name is required')

  const maxOrder = reservation.packages.reduce((max, p) => Math.max(max, p.sortOrder), -1)

  const pkg = await prisma.package.create({
    data: {
      reservationId,
      name: trimmedName,
      description: description || null,
      isActive: false,
      sortOrder: maxOrder + 1,
    },
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  return serialize(pkg)
}

export async function updatePackage(
  packageId: string,
  data: { name?: string; description?: string; deliveryCost?: number | null; returnCost?: number | null }
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { reservation: true },
  })
  if (!pkg) throw new Error('Package not found')

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) {
    const trimmedName = data.name.trim()
    if (!trimmedName) throw new Error('Package name cannot be empty')
    updateData.name = trimmedName
  }
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.deliveryCost !== undefined) updateData.deliveryCost = data.deliveryCost
  if (data.returnCost !== undefined) updateData.returnCost = data.returnCost

  const updated = await prisma.package.update({
    where: { id: packageId },
    data: updateData,
  })

  // If this is the active package, sync delivery costs to reservation and recalculate
  if (pkg.isActive && (data.deliveryCost !== undefined || data.returnCost !== undefined)) {
    const newDeliveryCost = data.deliveryCost !== undefined ? data.deliveryCost : Number(pkg.deliveryCost) || 0
    const newReturnCost = data.returnCost !== undefined ? data.returnCost : Number(pkg.returnCost) || 0
    const activeItems = await prisma.reservationItem.findMany({ where: { packageId } })
    const subtotal = activeItems.reduce((sum, item) => sum + Number(item.subtotal), 0)
    const { discountAmount, taxAmount, total } = calculateReservationTotals({
      itemsSubtotal: subtotal,
      discountType: pkg.reservation.discountType as 'PERCENTAGE' | 'FIXED' | undefined,
      discountValue: Number(pkg.reservation.discountValue) || 0,
      taxRate: Number(pkg.reservation.taxRate) || 0,
      deliveryCost: newDeliveryCost,
      returnCost: newReturnCost,
      shippingMarginType: (pkg.reservation as any).shippingMarginType || null,
      shippingMargin: Number((pkg.reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(pkg.reservation.rentalCreditAmount) || 0,
    })
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: pkg.reservationId },
        data: { deliveryCost: newDeliveryCost, returnCost: newReturnCost, subtotal, discountAmount, taxAmount, total },
      })
      // Flow: the shipping feeds its total, which the repricer owns.
      await maybeRecalcFlow(tx, pkg.reservationId)
    })
  }

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${pkg.reservationId}`)
  return serialize(updated)
}

export async function deletePackage(packageId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { reservation: { include: { packages: true } } },
  })
  if (!pkg) throw new Error('Package not found')
  if (pkg.isActive) throw new Error('Cannot delete the active package')
  if (pkg.reservation.packages.length <= 1) throw new Error('Cannot delete the last package')
  if (!PACKAGE_EDITABLE_STATUSES.includes(pkg.reservation.status)) {
    throw new Error('Packages can only be changed before the order enters fulfillment')
  }

  await prisma.package.delete({ where: { id: packageId } })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${pkg.reservationId}`)
}

export async function setActivePackage(
  reservationId: string,
  packageId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (!PACKAGE_EDITABLE_STATUSES.includes(reservation.status)) {
      throw new Error('Packages can only be changed before the order enters fulfillment')
    }

    // Verify package belongs to this reservation
    const pkg = await tx.package.findUnique({ where: { id: packageId } })
    if (!pkg || pkg.reservationId !== reservationId) throw new Error('Package not found on this reservation')

    // Deactivate all, activate chosen
    await tx.package.updateMany({
      where: { reservationId },
      data: { isActive: false },
    })
    await tx.package.update({
      where: { id: packageId },
      data: { isActive: true },
    })

    // Recalculate reservation totals from new active package's items and delivery costs
    const activeItems = await tx.reservationItem.findMany({
      where: { packageId },
    })
    const subtotal = activeItems.reduce((sum, item) => sum + Number(item.subtotal), 0)
    const pkgDeliveryCost = Number(pkg.deliveryCost) || 0
    const pkgReturnCost = Number(pkg.returnCost) || 0
    const { discountAmount, taxAmount, total } = calculateReservationTotals({
      itemsSubtotal: subtotal,
      discountType: reservation.discountType as 'PERCENTAGE' | 'FIXED' | undefined,
      discountValue: Number(reservation.discountValue) || 0,
      taxRate: Number(reservation.taxRate) || 0,
      deliveryCost: pkgDeliveryCost,
      returnCost: pkgReturnCost,
      shippingMarginType: (reservation as any).shippingMarginType || null,
      shippingMargin: Number((reservation as any).shippingMargin) || 0,
      rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
    })

    await tx.reservation.update({
      where: { id: reservationId },
      data: { subtotal, discountAmount, taxAmount, total, deliveryCost: pkgDeliveryCost, returnCost: pkgReturnCost },
    })
    // Flow re-derives the newly active option's lines, totals and schedule money.
    await maybeRecalcFlow(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

export async function duplicatePackage(
  packageId: string,
  newName: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const sourcePackage = await prisma.package.findUnique({
    where: { id: packageId },
    include: {
      items: true,
      reservation: { include: { packages: true } },
    },
  })
  if (!sourcePackage) throw new Error('Package not found')
  if (!PACKAGE_EDITABLE_STATUSES.includes(sourcePackage.reservation.status)) {
    throw new Error('Packages can only be changed before the order enters fulfillment')
  }

  const trimmedNewName = newName?.trim()
  if (!trimmedNewName) throw new Error('Package name is required')

  const maxOrder = sourcePackage.reservation.packages.reduce((max, p) => Math.max(max, p.sortOrder), -1)

  const newPkg = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package.create({
      data: {
        reservationId: sourcePackage.reservationId,
        name: trimmedNewName,
        isActive: false,
        sortOrder: maxOrder + 1,
        deliveryCost: sourcePackage.deliveryCost,
        returnCost: sourcePackage.returnCost,
      },
    })

    // Machines first, then their parts under the copies — a configured
    // workstation stays one line with its RAM, drives and GPUs nested under it,
    // base parts still included in its rate. A flat copy dropped `parentId` and
    // `includedInParent`, so every part became its own charged line.
    const ordered = [...sourcePackage.items].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    const idMap = new Map<string, string>()
    const copy = (item: (typeof ordered)[number], parentId: string | null) =>
      tx.reservationItem.create({
        data: {
          reservationId: sourcePackage.reservationId,
          packageId: pkg.id,
          parentId,
          assetId: item.assetId,
          serviceId: item.serviceId,
          cloudProductId: item.cloudProductId,
          description: item.description,
          category: item.category,
          pricingType: item.pricingType,
          rate: item.rate,
          quantity: item.quantity,
          subtotal: item.subtotal,
          isOneTime: item.isOneTime,
          costBasis: item.costBasis,
          // Flow's snapshotted true cost and co-term month ride with the line.
          trueCost: item.trueCost,
          flowAddedAtMonth: item.flowAddedAtMonth,
          marginPercent: item.marginPercent,
          includedInParent: item.includedInParent,
          notes: item.notes,
          sortOrder: item.sortOrder,
        },
      })
    for (const item of ordered) {
      if (item.parentId) continue
      idMap.set(item.id, (await copy(item, null)).id)
    }
    for (const item of ordered) {
      if (!item.parentId) continue
      // A part whose machine isn't in this option has nothing to sit under.
      const parentId = idMap.get(item.parentId)
      idMap.set(item.id, (await copy(item, parentId ?? null)).id)
    }

    return pkg
  }, { timeout: 30_000 })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${sourcePackage.reservationId}`)
  return serialize(newPkg)
}

/**
 * Swap a checked-out unit on a reservation item for a different unit.
 * Silently returns the old unit and checks out the new one in a single transaction.
 * No damage tracking or formal return condition — this is a prep/logistics swap.
 */
export async function swapReservationItemUnit(
  reservationId: string,
  reservationItemId: string,
  oldAssetUnitId: string,
  newAssetUnitId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    // Get reservation and item
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        client: true,
        items: {
          where: { id: reservationItemId },
          include: { asset: true },
        },
      },
    })

    if (!reservation) {
      return { error: 'Reservation not found' } as const
    }

    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      return { error: 'Order must be in Preparing, Shipped, or Active status to swap units' } as const
    }

    const item = reservation.items[0]
    if (!item) {
      return { error: 'Reservation item not found' } as const
    }

    // Verify the old unit is currently checked out on this item
    const oldRiu = await tx.reservationItemUnit.findFirst({
      where: {
        reservationItemId: item.id,
        assetUnitId: oldAssetUnitId,
        checkedOutAt: { not: null },
        checkedInAt: null,
      },
    })

    if (!oldRiu) {
      return { error: 'Old unit is not currently checked out on this item' } as const
    }

    // Find the active checkout for the old unit
    const oldCheckout = await tx.checkout.findFirst({
      where: {
        reservationId: reservation.id,
        assetUnitId: oldAssetUnitId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
    })

    if (!oldCheckout) {
      return { error: 'No active checkout found for the old unit' } as const
    }

    // Verify the new unit exists, belongs to the correct asset type, and is available
    const newUnit = await tx.assetUnit.findUnique({
      where: { id: newAssetUnitId },
    })

    if (!newUnit) {
      return { error: 'Replacement unit not found' } as const
    }

    if (newUnit.assetId !== item.assetId) {
      return { error: 'Replacement unit does not match the product type for this item' } as const
    }

    if (newUnit.status !== 'AVAILABLE' && newUnit.status !== 'RESERVED') {
      return { error: `Replacement unit ${newUnit.barcode} is not available (status: ${newUnit.status})` } as const
    }

    // --- Step 1: Silently return the old unit ---

    // Mark old checkout as RETURNED
    await tx.checkout.update({
      where: { id: oldCheckout.id },
      data: {
        status: 'RETURNED',
        actualReturn: new Date(),
        checkedInById: authResult.userId,
        notes: oldCheckout.notes
          ? `${oldCheckout.notes}\n\nSwapped out for unit ${newUnit.barcode}`
          : `Swapped out for unit ${newUnit.barcode}`,
      },
    })

    // Mark old ReservationItemUnit as checked in
    await tx.reservationItemUnit.update({
      where: { id: oldRiu.id },
      data: { checkedInAt: new Date() },
    })

    // Restore old unit to AVAILABLE
    await tx.assetUnit.update({
      where: { id: oldAssetUnitId },
      data: { status: 'AVAILABLE' },
    })

    // Increment checkedInCount (to keep counts balanced)
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: { checkedInCount: { increment: 1 } },
    })

    // --- Step 2: Check out the new unit ---

    // Per-unit charge for this booking = rate × billing periods. A part
    // included in its system's base price swaps in at no charge, same as checkout.
    const swapPeriods = calculatePeriodsSync(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
    const swapUnitCharge = unitChargeFor(item, computeItemSubtotal(Number(item.rate), 1, swapPeriods))

    // Create new checkout record
    const newCheckout = await tx.checkout.create({
      data: {
        assetUnitId: newAssetUnitId,
        clientId: reservation.clientId,
        reservationId: reservation.id,
        workflowType: 'RESERVATION',
        status: 'ACTIVE',
        checkoutDate: new Date(),
        expectedReturn: reservation.endDate,
        pricingType: item.pricingType,
        rate: item.rate,
        totalCharge: swapUnitCharge,
        notes: `Swapped in for unit ${(await tx.assetUnit.findUnique({ where: { id: oldAssetUnitId } }))?.barcode || oldAssetUnitId}`,
        createdById: authResult.userId,
      },
    })

    // Create or re-activate ReservationItemUnit for new unit
    await tx.reservationItemUnit.upsert({
      where: {
        reservationItemId_assetUnitId: {
          reservationItemId: item.id,
          assetUnitId: newAssetUnitId,
        },
      },
      create: {
        reservationItemId: item.id,
        assetUnitId: newAssetUnitId,
        checkedOutAt: new Date(),
        checkoutId: newCheckout.id,
      },
      update: {
        checkedOutAt: new Date(),
        checkedInAt: null,
        checkoutId: newCheckout.id,
      },
    })

    // Increment checkedOutCount (balances the checkedInCount increment above)
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: { checkedOutCount: { increment: 1 } },
    })

    // Mark new unit as CHECKED_OUT
    await tx.assetUnit.update({
      where: { id: newAssetUnitId },
      data: { status: 'CHECKED_OUT' },
    })
    // Re-derive earned revenue for both units (old now RETURNED, new now ACTIVE)
    await recomputeUnitRevenue(tx, oldAssetUnitId)
    await recomputeUnitRevenue(tx, newAssetUnitId)

    return { success: true, newCheckoutId: newCheckout.id }
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')

  return serialize(result)
}

/**
 * Reset checkout/checkin activity on a single reservation item unit.
 * Silently removes the checkout record and ReservationItemUnit, and decrements counts.
 * Used for admin cleanup when items were checked out/in improperly during prep.
 */
export async function resetItemUnitCheckout(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string
) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { items: { where: { id: reservationItemId } } },
    })
    if (!reservation) throw new Error('Reservation not found')
    if (!['PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      throw new Error('Reservation must be in Preparing, Shipped, or Active status')
    }

    const item = reservation.items[0]
    if (!item) throw new Error('Reservation item not found')

    // Find the ReservationItemUnit
    const riu = await tx.reservationItemUnit.findUnique({
      where: {
        reservationItemId_assetUnitId: { reservationItemId, assetUnitId },
      },
    })
    if (!riu) throw new Error('Unit not found on this item')

    const wasCheckedOut = !!riu.checkedOutAt
    const wasCheckedIn = !!riu.checkedInAt

    // Delete the ReservationItemUnit
    await tx.reservationItemUnit.delete({ where: { id: riu.id } })

    // Delete associated checkout(s) for this unit on this reservation
    await tx.checkout.deleteMany({
      where: { reservationId, assetUnitId },
    })
    // Removed checkouts no longer count — re-derive the unit's revenue
    await recomputeUnitRevenue(tx, assetUnitId)

    // Adjust counts on the reservation item
    const updates: Record<string, any> = {}
    if (wasCheckedOut) updates.checkedOutCount = { decrement: 1 }
    if (wasCheckedIn) updates.checkedInCount = { decrement: 1 }
    if (Object.keys(updates).length > 0) {
      await tx.reservationItem.update({
        where: { id: reservationItemId },
        data: updates,
      })
    }

    // If unit is still CHECKED_OUT (shouldn't be after a return, but safety), restore it
    const unit = await tx.assetUnit.findUnique({ where: { id: assetUnitId } })
    if (unit && unit.status === 'CHECKED_OUT') {
      await tx.assetUnit.update({
        where: { id: assetUnitId },
        data: { status: 'AVAILABLE' },
      })
    }

    await logAudit({
      action: 'UPDATE',
      entityType: 'Reservation',
      entityId: reservationId,
      userId: authResult.userId || 'system',
      newValues: { action: 'reset_item_checkout', unitBarcode: unit?.barcode || assetUnitId, reservationNumber: reservation.reservationNumber },
    })

    revalidatePath(`/dashboard/orders/${reservationId}`)
    return { success: true }
  })
}

// ---------------------------------------------------------------------------
// Flow: a line's cost basis, and the month-13 step (v1)
// ---------------------------------------------------------------------------
/**
 * Set a Flow line's cost basis per unit — the price the Flow payment is built from.
 * The basis may be raised but never sits below the line's true cost (what the gear
 * cost us). Reprices the whole order. Refused once the terms are locked.
 */
export async function updateFlowLineBasis(reservationId: string, itemId: string, basis: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  if (!Number.isFinite(basis) || basis <= 0) throw new Error('Enter a cost basis above $0')

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (reservation.reservationType !== 'FLOW') throw new Error('Only Flow lines are priced by cost basis.')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot change pricing on a completed, canceled, or lost order')
    }
    assertFlowTermsOpen(reservation, 'pricing')
    const item = await tx.reservationItem.findUnique({ where: { id: itemId } })
    if (!item || item.reservationId !== reservationId) throw new Error('Reservation item not found')
    const trueCost = item.trueCost != null ? Number(item.trueCost) : null
    if (trueCost != null && basis < trueCost - 0.005) {
      throw new Error(`The cost basis can't go below what the gear cost us ($${trueCost.toFixed(2)} per unit).`)
    }
    await tx.reservationItem.update({ where: { id: itemId }, data: { costBasis: Math.round(basis * 100) / 100 } })
    await repriceFlowTx(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

/** From month 13 on, pay this % of the year-one payment; null returns to the engine's shape. */
export async function updateFlowStepPct(reservationId: string, pct: number | null) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (pct != null && (!Number.isFinite(pct) || pct < 1 || pct > 100)) {
    throw new Error('The month-13 payment must be between 1% and 100% of the year-one payment.')
  }

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Reservation not found')
    if (reservation.reservationType !== 'FLOW') throw new Error('Only Flow orders have a month-13 step.')
    if (['COMPLETED', 'CANCELLED', 'LOST'].includes(reservation.status)) {
      throw new Error('Cannot change the schedule on a completed, canceled, or lost order')
    }
    assertFlowTermsOpen(reservation, 'schedule')
    await tx.reservation.update({
      where: { id: reservationId },
      data: { flowStepPct: pct == null ? null : Math.round(pct * 100) / 100 },
    })
    await repriceFlowTx(tx, reservationId)
  })

  revalidatePath('/dashboard/orders')
  revalidatePath(`/dashboard/orders/${reservationId}`)
}
