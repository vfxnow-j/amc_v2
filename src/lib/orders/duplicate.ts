/**
 * Copy an order into a new DRAFT inside the caller's transaction — the body of
 * `duplicateReservation` (actions/reservations.ts), moved to a plain module so a
 * script can run it inside a transaction it rolls back (scripts/flow-smoke.ts).
 *
 * NOT a 'use server' module: it takes a transaction and trusts its caller to have
 * done the auth. The action is the only caller in the app.
 *
 * Everything that reads through the global client (the new order's number, the
 * business billing anchor) is resolved by the caller BEFORE the transaction opens
 * and passed in: nothing here reads outside the transaction it was handed.
 *
 * A Flow copy carries the source's knobs verbatim, nulls included: a legacy null
 * knob prices at the engine default (lib/flow/defaults.ts storedFlowConfig), the
 * same value the source is priced at, so the copy matches it.
 */
import type { Prisma } from '@/generated/prisma/client'
import type { BillingCycleType, ReservationType } from '@/lib/types'
import { calculatePeriods as calculatePeriodsSync, roundMoney } from '@/lib/pricing/periods'
import { sanitizeMarginPercent } from '@/lib/pricing/reservation-totals'
import { calculateNextBillingDate } from '@/lib/utils/billing'
import type { BillingAnchor } from '@/lib/billing/calendar'
import { businessToday, intendedDay } from '@/lib/billing/calendar'
import { repriceFlowTx } from '@/lib/flow/reprice'

export type DuplicateOrderOptions = {
  targetType?: ReservationType
  rtoTermMonths?: number
  /** Who is duplicating it. */
  userId: string
  /** The new order's number, already issued for its type (duplicateTargetType). */
  reservationNumber: string
  /** The business billing anchor (getBillingAnchor), read before the transaction. */
  billingAnchor: BillingAnchor
}

/**
 * The type a duplicate takes — the requested one, else the source's — refusing a
 * copy into or out of Flow (v1): its line rates are per-unit contract values and
 * its pricing lives in flow* columns no other type reads, and vice versa. Pure, so
 * the caller can settle the type (and issue the number for it) before the
 * transaction opens.
 */
export function duplicateTargetType(sourceType: ReservationType, requested?: ReservationType): ReservationType {
  const targetType = requested ?? sourceType
  if (targetType !== sourceType && (targetType === 'FLOW' || sourceType === 'FLOW')) {
    throw new Error('A Flow order can only be duplicated as a Flow order.')
  }
  return targetType
}

export async function duplicateOrderTx(
  tx: Prisma.TransactionClient,
  reservationId: string,
  options: DuplicateOrderOptions,
) {
  const source = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: {
      packages: { include: { items: true }, orderBy: { sortOrder: 'asc' } },
      items: true,
    },
  })

  if (!source) {
    throw new Error('Reservation not found')
  }

  // "Duplicate as" — the new order may take a different type than the source.
  const targetType = duplicateTargetType(source.reservationType, options?.targetType)
  const isSaleTarget = targetType === 'SALE'
  const isRtoTarget = targetType === 'RENT_TO_OWN'
  const isFlowTarget = targetType === 'FLOW'

  // RTO financing term: explicit choice → source's existing term → sane default.
  const rtoTermMonths = isRtoTarget
    ? (options?.rtoTermMonths || source.rtoTermMonths || 24)
    : null

  // Number prefix matches the NEW order's type (RTO-/RES-/SALE-/CLD-): the caller
  // issued it for duplicateTargetType's answer.
  const reservationNumber = options.reservationNumber

  // Shift dates: new start is today, end date offset by same duration
  const durationMs = new Date(source.endDate).getTime() - new Date(source.startDate).getTime()
  const newStart = businessToday()
  const newEnd = intendedDay(new Date(newStart.getTime() + durationMs))

  // Recurring/billing semantics for the new order's type. Preserving `isRecurring`
  // is the crux of the fix: previously the copy silently defaulted to non-recurring,
  // so re-opening it re-multiplied every per-period line item across the whole term
  // (e.g. a 24-month RTO's monthly lines × 24) and inflated the totals ~24×.
  const isRecurring = isRtoTarget ? true
    : isSaleTarget ? false
    : source.isRecurring
  const billingCycleType: BillingCycleType = isSaleTarget ? 'ONE_TIME'
    : isRtoTarget ? 'MONTHLY'
    : (source.billingCycleType === 'ONE_TIME' ? 'MONTHLY' : (source.billingCycleType as BillingCycleType))

  // A Flow order is billed from its schedule, never by the billing run.
  const nextBillingDate = isSaleTarget || isFlowTarget
    ? null
    : calculateNextBillingDate(newStart, billingCycleType, source.billingCycleDay, source.billingCycleDays ?? undefined, options.billingAnchor)

  // A SALE bills once (one-time) and an RTO bills as a single recurring installment
  // plan (periods = 1). When such a target line came from a source that spanned
  // multiple periods, fold the period multiplier into the unit rate so rate × qty
  // still equals the exact stored subtotal — the duplicate matches the source penny
  // for penny regardless of the order type it's copied into.
  const collapseToSinglePeriod = isSaleTarget || isRtoTarget

  // Copy every line's stored subtotal verbatim, across every package, so the
  // duplicate matches the source exactly. Retain each source row's original id so
  // component→parent linkage can be mapped during duplication.
  const mapItems = (items: typeof source.items) =>
    items.map((item, index) => {
      const sub = Number(item.subtotal)
      const qty = item.quantity || 1
      const sourcePeriods = item.isOneTime
        ? 1
        : calculatePeriodsSync(source.startDate, source.endDate, item.pricingType, source.isRecurring)
      const rate = collapseToSinglePeriod && sourcePeriods > 1 && qty > 0
        ? roundMoney(sub / qty)
        : Number(item.rate)
      return {
        sourceId: item.id,
        sourceParentId: item.parentId,
        assetId: item.assetId,
        serviceId: item.serviceId,
        cloudProductId: item.cloudProductId,
        description: item.description || null,
        category: item.category || null,
        pricingType: item.pricingType,
        rate,
        quantity: qty,
        subtotal: sub,
        isOneTime: isSaleTarget ? true : item.isOneTime,
        costBasis: item.costBasis,
        // Flow: keep the snapshotted true cost; the basis is floored at it.
        ...(isFlowTarget ? { trueCost: item.trueCost } : {}),
        // Base parts stay included in their machine's rate on the copy.
        includedInParent: item.includedInParent,
        marginPercent: sanitizeMarginPercent(
          item.marginPercent != null ? Number(item.marginPercent) : null,
          targetType
        ),
        notes: item.notes || null,
        sortOrder: item.sortOrder ?? index,
      }
    })

  // Reservation-level money copied verbatim from the source (exact match). The
  // reservation totals mirror the active package, which mapItems preserves.
  const subtotal = Number(source.subtotal)
  const discountAmount = Number(source.discountAmount)
  const taxAmount = Number(source.taxAmount)
  const total = Number(source.total)

  const res = await tx.reservation.create({
    data: {
      reservationNumber,
      clientId: source.clientId,
      reservationType: targetType,
      // Rent-to-Own financing: set for RTO targets, cleared for every other type.
      rtoTermMonths: isRtoTarget ? rtoTermMonths : null,
      rtoMonthlyPayment: isRtoTarget && rtoTermMonths ? total / rtoTermMonths : null,
      rtoBuyoutPrice: isRtoTarget ? total : null,
      rtoInstallmentsPaid: 0,
      rtoDefaultCount: 0,
      rtoStartDate: null,
      startDate: newStart,
      endDate: newEnd,
      projectName: source.projectName ? `${source.projectName} (copy)` : undefined,
      projectCode: source.projectCode,
      notes: source.notes,
      internalNotes: source.internalNotes,
      status: 'DRAFT',
      priceVerified: false,
      priceVerifiedAt: null,
      createdById: options.userId,
      isRecurring,
      billingCycleType,
      billingCycleDay: source.billingCycleDay,
      billingCycleDays: source.billingCycleDays,
      nextBillingDate,
      notBilled: source.notBilled,
      paymentTerms: source.paymentTerms,
      subtotal,
      discountType: source.discountType,
      discountValue: source.discountValue,
      discountAmount,
      taxRate: source.taxRate,
      taxAmount,
      total,
      totalCost: source.totalCost,
      totalMargin: source.totalMargin,
      internalShippingCost: source.internalShippingCost,
      subRentalCost: source.subRentalCost,
      hardwareCost: source.hardwareCost,
      deliveryMethod: source.deliveryMethod,
      deliveryAddress: source.deliveryAddress,
      deliveryCost: source.deliveryCost,
      deliveryCourier: source.deliveryCourier,
      deliveryNotes: source.deliveryNotes,
      shippingMarginType: source.shippingMarginType,
      shippingMargin: source.shippingMargin,
      deliveryTrackingProvider: source.deliveryTrackingProvider,
      deliveryTrackingNumber: source.deliveryTrackingNumber,
      returnMethod: source.returnMethod,
      returnCost: source.returnCost,
      returnCourier: source.returnCourier,
      returnTrackingProvider: source.returnTrackingProvider,
      returnTrackingNumber: source.returnTrackingNumber,
      // Flow: the same term and pricing knobs, a fresh start and nothing billed.
      // The money columns and the current-period payment are re-derived by
      // repriceFlowTx below: the source's payment may already be past a step.
      // Co-term months (flowAddedAtMonth) are not carried, as in v1.
      ...(isFlowTarget ? {
        flowTermMonths: source.flowTermMonths,
        flowContractValue: source.flowContractValue,
        flowMonthlyPayment: null,
        flowStartDate: newStart,
        flowPeriodsBilled: 0,
        flowStepPct: source.flowStepPct,
        flowMarginPct: source.flowMarginPct,
        flowFinancePct: source.flowFinancePct,
        flowPurchaseTaxPct: source.flowPurchaseTaxPct,
        flowTaxExempt: source.flowTaxExempt,
        flowRecoverByMonth: source.flowRecoverByMonth,
        flowDeprPct: source.flowDeprPct,
        flowLifeMonths: source.flowLifeMonths,
        flowAssumedAprPct: source.flowAssumedAprPct,
        flowAssumedLoanBalance: source.flowAssumedLoanBalance,
        flowAssumedNoteMonths: source.flowAssumedNoteMonths,
        flowExtensionPct: source.flowExtensionPct,
      } : {}),
    },
  })

  // Two-pass duplicate preserving parent→child links via a source-id → new-id map.
  const duplicateItems = async (pkgId: string, items: ReturnType<typeof mapItems>) => {
    const idMap = new Map<string, string>()
    // Pass 1: top-level
    for (const item of items) {
      if (item.sourceParentId) continue
      const { sourceId, sourceParentId, ...rest } = item
      void sourceParentId
      const created = await tx.reservationItem.create({
        data: { reservationId: res.id, packageId: pkgId, parentId: null, ...rest },
      })
      idMap.set(sourceId, created.id)
    }
    // Pass 2: components
    for (const item of items) {
      if (!item.sourceParentId) continue
      const { sourceId, sourceParentId, ...rest } = item
      const parentId = idMap.get(sourceParentId) || null
      const created = await tx.reservationItem.create({
        data: { reservationId: res.id, packageId: pkgId, parentId, ...rest },
      })
      idMap.set(sourceId, created.id)
    }
  }

  // Duplicate all packages and their items
  for (const pkg of source.packages) {
    const newPkg = await tx.package.create({
      data: {
        reservationId: res.id,
        name: pkg.name,
        description: pkg.description,
        isActive: pkg.isActive,
        sortOrder: pkg.sortOrder,
        deliveryCost: pkg.deliveryCost,
        returnCost: pkg.returnCost,
      },
    })

    const pkgItems = mapItems(pkg.items)
    if (pkgItems.length > 0) {
      await duplicateItems(newPkg.id, pkgItems)
    }
  }

  // If source had no packages (legacy), create a default one
  if (source.packages.length === 0 && source.items.length > 0) {
    const defaultPkg = await tx.package.create({
      data: { reservationId: res.id, name: 'Default', isActive: true, sortOrder: 0 },
    })
    await duplicateItems(defaultPkg.id, mapItems(source.items))
  }

  // Flow: derive the copy's rates, totals and current-period payment from its
  // lines for the fresh term, the same way every other Flow save does (v1).
  if (isFlowTarget) {
    await repriceFlowTx(tx, res.id)
    return tx.reservation.findUniqueOrThrow({ where: { id: res.id } })
  }

  return res
}
