import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ReservationFormData } from '@/lib/actions/reservations'
import { intendedDay } from '@/lib/billing/calendar'
import { recurringFor } from '@/lib/orders/recurring'
import { kindForOrderType, nextNumber } from '@/lib/numbering/next'
import { calculateReservationTotals, sanitizeMarginPercent } from '@/lib/pricing/reservation-totals'
import { computeItemSubtotal, calculatePeriods as calculateTermPeriods } from '@/lib/pricing/periods'
import { calculateNextBillingDate } from '@/lib/utils/billing'
import { getBillingAnchor } from '@/lib/settings/business'
import { loadFlowBases } from '@/lib/flow/load-bases'
import { applyFlowDefaults } from '@/lib/flow/defaults'
import { assertFlowTerm } from '@/lib/flow/terms'
import { flowOrderKnobsProblem } from '@/lib/flow/knob-bounds'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'
import { repriceFlowTx } from '@/lib/flow/reprice'
import { addTermMonths, flowCreateLineCost, flowSnapshotLineCost } from '@/lib/flow/stored-money'

/**
 * Creating an order, without a session: the body of `createReservation`
 * (actions/reservations.ts), moved here so a caller that is not a signed-in
 * person — the Portal API (docs/portal-api.md, Phase 2) — creates orders by
 * exactly the same rules. Not a server action: nothing here checks who is
 * asking, so it must only be reached through a caller that already has.
 *
 * The order is created as a DRAFT, as a staff order is; approving it is a
 * separate step. `actor.userId` is null for a portal-placed order.
 */

type Tx = Prisma.TransactionClient

// Number of billing periods an item covers over the reservation's date range.
// Fractional by design — see src/lib/pricing/periods.ts for the proration rules.
const calculatePeriodsSync = calculateTermPeriods

export type CreateReservationOptions = {
  /** Allocate the number inside the create transaction (e.g. under a lock). */
  reservationNumber?: (tx: Tx) => Promise<string>
  /** Staff only: reserve specific units behind a cloud host line. */
  allocateCloudHost?: (tx: Tx, itemId: string, unitIds: string[]) => Promise<unknown>
  /** Runs inside the create transaction, after pricing: the caller's own rows commit with the order or not at all. */
  afterCreate?: (tx: Tx, reservationId: string) => Promise<void>
}

export async function createReservationCore(
  input: ReservationFormData,
  actor: { userId: string | null },
  options: CreateReservationOptions = {},
) {
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

  // Staff orders take the next number from the business setting before the
  // transaction; a caller that must allocate inside it (the portal's PRT- series,
  // under a lock) passes its own.
  const presetNumber = options.reservationNumber ? null : await nextNumber(kindForOrderType(data.reservationType || 'RENTAL'))

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
    const reservationNumber = presetNumber ?? (await options.reservationNumber!(tx))
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the form type is a loose string
        discountType: (data.discountType || null) as any,
        discountValue: data.discountValue ?? 0,
        discountAmount,
        taxRate,
        taxAmount,
        total,
        status: 'DRAFT',
        actionRequired: data.actionRequired || false,
        actionRequiredNote: data.actionRequiredNote || null,
        createdById: actor.userId,
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
        if (!options.allocateCloudHost) throw new Error('This order names cloud-host backing units, which only a staff order can allocate.')
        await options.allocateCloudHost(tx, dbId, item.backingAssetUnitIds)
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

    if (options.afterCreate) await options.afterCreate(tx, res.id)

    return tx.reservation.findUnique({
      where: { id: res.id },
      include: { client: true, items: { include: { asset: true } } },
    })
  })

  if (!reservation) throw new Error('Failed to create reservation')

  return reservation
}
