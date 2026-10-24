'use server'

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { requireEditor } from '@/lib/auth-utils'
import { auth } from '@/lib/auth'
import { countsAsView } from '@/lib/quotes/quote-view'
import { serialize } from '@/lib/utils'
import { computeReservationFinancials, deriveItemAmount } from '@/lib/pricing/financials'
import { calculateReservationTotals } from '@/lib/pricing/reservation-totals'
import crypto from 'crypto'
import { portalQuoteHold, quoteGate } from '@/lib/approvals/core'
import { lineTitle } from '@/lib/quotes/line-title'
import { groupIdsOf, groupRollup, perMachineQty, specLabel } from '@/lib/pricing/build-groups'
import { paymentLineForOption } from '@/lib/billing/payment-schedule'
import { getBillingAnchor } from '@/lib/settings/business'
import { flowQuotePayload } from '@/lib/pricing/flow-client-payload'
import { buildFlowApprovalBasis, flowQuoteProblem, flowTermsForReservation } from '@/lib/flow-terms-server'
import { checkFlowApproval } from '@/lib/flow/approval'
import { validateSignerName } from '@/lib/quotes/signer-name'
import {
  QUOTE_ANSWERABLE_STATUSES,
  cleanAnswerNote,
  quoteAnswerProblem,
  validateApprovalChoice,
  type ApprovalChoice,
} from '@/lib/quotes/quote-answer'

/** The status guard every answer writes through: only a live quote can move. */
const ANSWERABLE = { in: [...QUOTE_ANSWERABLE_STATUSES] }

/** Hardware prices move: a quote holds for a week unless the sender picks otherwise (lib/quotes/expiry). */
const TOKEN_EXPIRY_DAYS = 7

/**
 * Generate a unique quote token for a reservation and return the full URL.
 */
export async function generateQuoteToken(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  })

  if (!reservation) throw new Error('Reservation not found')
  // A Flow order's client quote is its payment schedule (buildQuote below), so a
  // link can only exist once that schedule can be priced. This is the only place
  // a QuoteToken is minted, so every link and every send passes this gate.
  if (reservation.reservationType === 'FLOW') {
    const problem = await flowQuoteProblem(reservationId)
    if (problem) throw new Error(`This Flow order can't be quoted to the client yet: ${problem}`)
  }
  const allowedStatuses = ['DRAFT', 'REVISION', 'QUOTE_SENT', 'APPROVED']
  if (!allowedStatuses.includes(reservation.status)) {
    throw new Error('Can only generate quote links for draft, revision, sent, or approved reservations')
  }

  // A live link is the quote in front of the client. Held while its approval is
  // outstanding or the client is an unonboarded prospect (lib/approvals/core).
  // Never raises a request: minting happens when the send dialog opens.
  const gate = await quoteGate({
    orderId: reservationId,
    userId: authResult.userId,
    role: authResult.role,
    act: 'sending it',
    raise: false,
  })
  if (gate.status === 'held') throw new Error(gate.message)

  // The link dies with the quote: an expiration set on the order wins. When it's
  // unset (or already past — i.e. re-sending a stale quote), stamp a fresh
  // 30-day window on the order so the date shown on the order, the online quote,
  // and the PDF all agree with when the link actually stops working.
  const token = crypto.randomUUID()
  const { toDateOnlyUtc } = await import('@/lib/utils/format')
  const rawDefault = new Date()
  rawDefault.setDate(rawDefault.getDate() + TOKEN_EXPIRY_DAYS)
  const defaultExpiry = toDateOnlyUtc(rawDefault)

  const quoteExpiresAt = reservation.quoteExpiresAt
  const useExisting = !!quoteExpiresAt && quoteExpiresAt > new Date()
  const validUntil = useExisting ? quoteExpiresAt! : defaultExpiry

  if (!useExisting) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { quoteExpiresAt: defaultExpiry },
    })
  }

  // The customer gets the whole of the expiry day — the stored value is anchored
  // at midday, so push the link's cutoff to the end of that date in UTC.
  const expiresAt = new Date(validUntil)
  expiresAt.setUTCHours(23, 59, 59, 999)

  await prisma.quoteToken.create({
    data: {
      token,
      reservationId,
      expiresAt,
    },
  })

  const { APP_URL } = await import('@/lib/email/client')
  return { token, url: `${APP_URL}/quote/${token}` }
}

/**
 * What a quote is built from. Shared by the client's link and the staff preview
 * so the two can never show different figures.
 */
/** The heading service lines are grouped under on a quote, ahead of any category they were given by hand. */
const SERVICES_GROUP = 'Services'

const QUOTE_INCLUDE = {
          client: true,
          packages: {
            include: {
              items: {
                include: {
                  asset: {
                    include: {
                      category: true,
                      units: {
                        where: { status: 'AVAILABLE' },
                        select: { id: true },
                      },
                    },
                  },
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
                  units: {
                    where: { status: 'AVAILABLE' },
                    select: { id: true },
                  },
                },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        } satisfies Prisma.ReservationInclude

type QuoteReservation = Prisma.ReservationGetPayload<{ include: typeof QUOTE_INCLUDE }>

/**
 * Fetch quote data by token (NO AUTH required — public access).
 */
export async function getQuoteByToken(token: string) {
  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: QUOTE_INCLUDE } },
  })

  if (!quoteToken) return { error: 'Quote not found' }
  if (quoteToken.expiresAt < new Date()) {
    return { error: 'This quote link has expired', expiredOn: quoteToken.expiresAt.toISOString() }
  }
  if (quoteToken.usedAt) {
    // Return status so the page can resume the post-approval flow
    const status = quoteToken.reservation.status as string
    return { error: 'already_used', status }
  }
  // Pulled back for revision by staff (a client-requested revision spends the
  // link above). Nothing of the quote leaves the server while it is being
  // edited: the page would show half-finished figures, and Approve would sign them.
  if (quoteToken.reservation.status === 'REVISION') {
    return {
      error: 'revising',
      orderNumber: quoteToken.reservation.reservationNumber,
      clientName: quoteToken.reservation.client.name,
    }
  }

  return buildQuote(quoteToken.reservation, quoteToken.createdAt, quoteToken.expiresAt)
}

/**
 * Staff preview of the online quote, by order (session required).
 *
 * The client's page as the client would see it, whatever stage the order is at
 * — including before any link exists and after the link is spent — plus where
 * the quote stands, so the order record can show "View online quote" at every
 * stage. It reads only: no token is minted and nothing is marked as viewed.
 */
export async function getQuotePreview(reservationId: string) {
  const { requireAuth } = await import('@/lib/auth-utils')
  const authResult = await requireAuth()
  if (!authResult.authorized) return { error: 'unauthorized' as const }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: QUOTE_INCLUDE,
  })
  if (!reservation) return { error: 'not_found' as const }

  const latest = await prisma.quoteToken.findFirst({
    where: { reservationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, expiresAt: true, usedAt: true },
  })
  const links = await prisma.quoteToken.count({ where: { reservationId } })

  return {
    quote: await buildQuote(reservation, latest?.createdAt ?? null, latest?.expiresAt ?? null),
    link: latest
      ? { issuedAt: latest.createdAt, expiresAt: latest.expiresAt, answeredAt: latest.usedAt, count: links }
      : null,
    approvedAt: reservation.approvedAt,
    quoteSentAt: reservation.quoteSentAt,
    lostReason: reservation.lostReason,
  }
}

async function buildQuote(
  reservation: QuoteReservation,
  issuedAt: Date | null,
  tokenExpiresAt: Date | null,
) {

  // Helper: group items by category. Components (parentId set) stay attached to
  // their parent's display group — the UI renders them indented beneath the parent.
  type QuoteItem = {
    id: string; name: string; spec?: string; quantity: number; pricingType: string;
    rate: number; subtotal: number; assetId: string | null; availableUnits: number; isOneTime: boolean;
    parentId?: string | null; isComponent?: boolean; configuredTotal?: number;
    // Part of the base price: shown as specification, charged nothing.
    includedInParent?: boolean;
    // Sales build group heading: its subtotal is the rollup of its parts, shown not summed.
    isGroup?: boolean;
    // A build part whose price the quote hides: a spec line with no figures.
    priceHidden?: boolean;
    // A line from the Services catalog: the quote lists these in their own block.
    isService?: boolean;
  }
  const groupByCategory = (items: typeof reservation.items) => {
    // Cloud-host component children (parentId + cloudProductId) are hidden
    // config rows — skip them entirely so the customer-facing quote shows
    // only the cloud-host summary line.
    const visibleItems = items.filter((it) => !(it.parentId && (it as any).cloudProductId))
    const childrenByParent = new Map<string, typeof visibleItems>()
    for (const it of visibleItems) {
      if (it.parentId) {
        const arr = childrenByParent.get(it.parentId) || []
        arr.push(it)
        childrenByParent.set(it.parentId, arr)
      }
    }
    const hidePartPrices = !!(reservation as { hideBuildPartPrices?: boolean }).hideBuildPartPrices
    const buildQuoteItem = (item: typeof items[number]): QuoteItem => {
      const isComponent = !!item.parentId
      // Derived, not the stored column — the customer-facing quote must show the same
      // figure as the order page. See src/lib/pricing/financials.ts.
      let subtotal = deriveItemAmount(item, reservation)
      let rate = Number(item.rate)
      let { title: name, spec } = lineTitle(item)
      let configuredTotal: number | undefined
      let priceHidden: boolean | undefined
      if (item.isGroup) {
        // A build has no price of its own: it shows what its parts add up to, and one machine's.
        const rolled = groupRollup((childrenByParent.get(item.id) || []).map((k) => deriveItemAmount(k, reservation)), item.quantity)
        subtotal = rolled.amount
        rate = rolled.rate
      } else if (!isComponent) {
        const kids = childrenByParent.get(item.id) || []
        if (kids.length > 0) {
          configuredTotal = subtotal + kids.reduce((sum, k) => sum + deriveItemAmount(k, reservation), 0)
        }
      } else if (hidePartPrices) {
        // Parts of a build with prices hidden read as a spec list, "4× 32GB DDR5".
        const group = items.find((o) => o.id === item.parentId && o.isGroup)
        if (group) {
          name = specLabel(name, perMachineQty(item, group))
          spec = undefined
          subtotal = 0
          rate = 0
          priceHidden = true
        }
      }
      return {
        id: item.id,
        name,
        spec,
        quantity: item.quantity,
        pricingType: item.pricingType,
        rate,
        subtotal,
        assetId: item.assetId,
        availableUnits: item.asset?.units?.length ?? 0,
        isOneTime: item.isOneTime,
        parentId: item.parentId,
        isComponent,
        configuredTotal,
        includedInParent: (item as { includedInParent?: boolean }).includedInParent ?? false,
        isGroup: item.isGroup || undefined,
        priceHidden,
        isService: item.serviceId ? true : undefined,
      }
    }
    // Order: parents first, each followed by its components; they share the parent's category.
    const map = new Map<string, QuoteItem[]>()
    for (const item of visibleItems) {
      if (item.parentId) continue
      const categoryName = item.serviceId ? SERVICES_GROUP : item.asset?.category?.name || (item as any).category || 'Uncategorized'
      const existing = map.get(categoryName) || []
      existing.push(buildQuoteItem(item))
      const kids = childrenByParent.get(item.id) || []
      for (const kid of kids) existing.push(buildQuoteItem(kid))
      map.set(categoryName, existing)
    }
    // Orphan components (parent missing from this package) — fall through to own category
    for (const item of visibleItems) {
      if (!item.parentId) continue
      if (visibleItems.some((p) => p.id === item.parentId)) continue
      const categoryName = item.asset?.category?.name || (item as any).category || 'Uncategorized'
      const existing = map.get(categoryName) || []
      existing.push(buildQuoteItem(item))
      map.set(categoryName, existing)
    }
    return Array.from(map.entries())
      .map(([category, items]) => ({ category, items, service: category === SERVICES_GROUP || undefined }))
      .sort((a, b) => Number(!!a.service) - Number(!!b.service))
  }

  // Build packages data for the quote page
  const activePackage = reservation.packages.find((p) => p.isActive)
  const activeItems = activePackage ? activePackage.items : reservation.items

  // Helper: compute per-package totals using reservation discount rules
  const discountType = reservation.discountType
  const discountValue = Number(reservation.discountValue) || 0
  const taxRate = Number(reservation.taxRate) || 0

  function computePackageTotals(itemsSubtotal: number, pkgDeliveryCost: number, pkgReturnCost: number) {
    let discountAmount = 0
    if (discountType === 'PERCENTAGE' && discountValue > 0) {
      discountAmount = itemsSubtotal * (discountValue / 100)
    } else if (discountType === 'FIXED' && discountValue > 0) {
      discountAmount = Math.min(discountValue, itemsSubtotal)
    }
    const afterDiscount = itemsSubtotal - discountAmount
    const taxAmount = afterDiscount * (taxRate / 100)
    const shipping = pkgDeliveryCost + pkgReturnCost
    const total = afterDiscount + taxAmount + shipping
    return { discountAmount, taxAmount, shipping, total }
  }

  // Compute client-facing shipping costs (with margin applied)
  const applyMargin = (cost: number, marginType?: string | null, margin?: number | null) => {
    if (!marginType || !margin || margin <= 0) return cost
    if (marginType === 'PERCENTAGE') return Math.round(cost * (1 + margin / 100) * 100) / 100
    return Math.round((cost + margin) * 100) / 100
  }

  // Apply margin to package-level delivery costs (margin is reservation-level)
  const marginType = (reservation as any).shippingMarginType || null
  const marginVal = Number((reservation as any).shippingMargin) || 0

  // Priced once here from the reservation already in hand (items + packages),
  // rather than one query per option — see paymentLineForOption.
  const billingAnchor = await getBillingAnchor()

  const packages = reservation.packages.map((pkg) => {
    const itemsSubtotal = pkg.items.reduce((sum, i) => sum + deriveItemAmount(i, reservation), 0)
    const pkgDeliveryRaw = Number(pkg.deliveryCost) || 0
    const pkgReturnRaw = Number(pkg.returnCost) || 0
    const pkgDelivery = applyMargin(pkgDeliveryRaw, marginType, marginVal)
    const pkgReturn = applyMargin(pkgReturnRaw, marginType, marginVal)
    const pkgTotals = computePackageTotals(itemsSubtotal, pkgDelivery, pkgReturn)
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      isActive: pkg.isActive,
      itemsByCategory: groupByCategory(pkg.items as any),
      subtotal: itemsSubtotal,
      deliveryCost: pkgDelivery,
      returnCost: pkgReturn,
      discountAmount: pkgTotals.discountAmount,
      taxAmount: pkgTotals.taxAmount,
      total: pkgTotals.total,
      paymentLine: paymentLineForOption(reservation, reservation.items, reservation.packages, billingAnchor, pkg.id),
    }
  })

  // Derived from the active package's own lines rather than the stored reservation
  // columns, which go stale whenever pricing rules change ahead of a re-save.
  const activeFinancials = computeReservationFinancials({
    order: reservation,
    items: activeItems,
    discountType: reservation.discountType,
    discountValue: reservation.discountValue,
    taxRate: reservation.taxRate,
    deliveryCost: activePackage?.deliveryCost ?? reservation.deliveryCost,
    returnCost: activePackage?.returnCost ?? reservation.returnCost,
    shippingMarginType: marginType,
    shippingMargin: marginVal,
    rentalCreditAmount: (reservation as any).rentalCreditAmount,
  })
  const activeSubtotal = activeFinancials.itemsSubtotal
  const clientDelivery = activeFinancials.deliveryCost
  const clientReturn = activeFinancials.returnCost

  if (reservation.reservationType === 'FLOW') {
    return buildFlowQuote(reservation, activeItems as QuoteReservation['items'], activeFinancials, issuedAt, tokenExpiresAt)
  }

  return serialize({
    reservationNumber: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    status: reservation.status,
    // Quote lifecycle — surfaced so the client sees when it was issued and how
    // long the pricing holds. The order-level expiration wins when set; the token
    // expiry is the fallback for links issued before that field existed.
    issuedAt,
    expiresAt: reservation.quoteExpiresAt ?? tokenExpiresAt,
    clientName: reservation.client.name,
    companyName: reservation.client.companyName,
    projectName: reservation.projectName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    // Active package items (backward compatible)
    itemsByCategory: groupByCategory(activeItems as any),
    subtotal: activeSubtotal,
    discountAmount: activeFinancials.discountAmount,
    taxRate,
    taxAmount: activeFinancials.taxAmount,
    total: activeFinancials.total,
    deliveryCost: clientDelivery,
    returnCost: clientReturn,
    // Shipping detail for online quote display
    deliveryMethod: reservation.deliveryMethod,
    deliveryAddress: reservation.deliveryAddress,
    deliveryDate: reservation.deliveryDate,
    deliveryNotes: reservation.deliveryNotes,
    returnMethod: reservation.returnMethod,
    returnDate: reservation.returnDate,
    billingCycleType: reservation.billingCycleType,
    isRecurring: reservation.isRecurring,
    notes: reservation.notes,
    // Rent-to-Own fields
    rtoTermMonths: reservation.rtoTermMonths,
    rtoMonthlyPayment: reservation.rtoMonthlyPayment ? Number(reservation.rtoMonthlyPayment) : null,
    rtoBuyoutPrice: reservation.rtoBuyoutPrice ? Number(reservation.rtoBuyoutPrice) : null,
    // Multi-package data
    packages: packages.length > 1 ? packages : undefined,
    // The active option's line, for a client viewing a quote with no options to
    // switch between (or before they've picked one) — quote-portal.tsx renders
    // whichever option is selected out of packages[] instead, once there's more than one.
    paymentLine: paymentLineForOption(reservation, reservation.items, reservation.packages, billingAnchor),
  })
}

/**
 * The client's view of a Flow order (ported from v1 buildQuote's FLOW branch):
 * the payment schedule, the gear with quantities only, and the terms they agree
 * to — the frozen snapshot once approved, else a live render. Shaped by the pure
 * flowQuotePayload, which the client-safe test exercises.
 */
async function buildFlowQuote(
  reservation: QuoteReservation,
  activeItems: QuoteReservation['items'],
  financials: ReturnType<typeof computeReservationFinancials>,
  issuedAt: Date | null,
  tokenExpiresAt: Date | null,
) {
  const terms = await flowTermsForReservation(reservation.id)
  const payload = flowQuotePayload({
    order: reservation,
    lines: activeItems,
    extras: {
      discountAmount: financials.discountAmount,
      taxRate: financials.taxRate,
      deliveryCost: financials.deliveryCost,
      returnCost: financials.returnCost,
    },
    terms,
    issuedAt,
    tokenExpiresAt,
  })
  if ('error' in payload) return { error: payload.error }
  return serialize(payload)
}

/**
 * Approve a quote — confirms the reservation and records signature (NO AUTH).
 */
export async function approveQuote(
  token: string,
  signerName: string,
  signatureDataUrl: string,
  quantityChanges?: Array<{ itemId: string; newQuantity: number }>,
  selectedPackageId?: string,
  autopay?: { method: 'ACH' | 'CARD' },
  /** The Flow terms `version` the client's page displayed when they signed. */
  termsVersion?: unknown,
  /** The Flow schedule fingerprint the client's page was sent (flowQuotePayload). */
  scheduleHash?: unknown,
) {
  if (typeof token !== 'string' || !token) throw new Error('Quote not found')
  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: {
      reservation: {
        include: {
          packages: true,
          items: {
            include: {
              asset: {
                include: {
                  units: {
                    where: { status: 'AVAILABLE' },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!quoteToken) throw new Error('Quote not found')

  // The signature is drawn on the page and arrives as a PNG data URL. It is put
  // straight into the signed PDF, whose renderer would fetch a remote URL, so
  // anything else from this public endpoint is refused.
  if (
    typeof signatureDataUrl !== 'string' ||
    signatureDataUrl.length > 2_000_000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl)
  ) {
    throw new Error('Sign in the box to approve.')
  }

  const { reservation } = quoteToken

  // Early, friendly refusal. The same rules are enforced atomically inside the
  // transaction below (token claim + status guard), which is what actually holds.
  const linkProblem = quoteAnswerProblem(quoteToken, reservation.status)
  if (linkProblem) throw new Error(linkProblem)

  // The name of record from here on: trimmed, non-empty, sane length. Every
  // downstream write (autopay authorization, signed document, signed PDF,
  // status history, internal email) uses this value, never the raw argument.
  const nameCheck = validateSignerName(signerName)
  if (!nameCheck.ok) throw new Error(nameCheck.error)
  const validatedSignerName = nameCheck.name

  // Phase 6: a quote whose figure changed after approval (or was never cleared)
  // cannot be accepted until the new figure is approved and sent again.
  const portalHold = await portalQuoteHold(reservation.id)
  if (portalHold) throw new Error(portalHold)

  // Flow (v1): approved as quoted, with autopay authorized, and the terms the
  // client agreed to frozen onto the order. The terms are rendered here from the
  // current settings — never taken from the browser — and built before the
  // transaction opens, because the render reads through the global client. The
  // version and schedule fingerprint rendered here are also what the client's
  // page must have shown (checkFlowApproval): terms edited by staff, or an order
  // re-priced, after the client opened the quote must not be silently frozen
  // onto an order the client never saw.
  let flowApproval: {
    snapshot: Awaited<ReturnType<typeof buildFlowApprovalBasis>>['snapshot']
    autopayMethod: 'ACH' | 'CARD'
    signerName: string
  } | null = null
  // The rental path's option and quantity choice, checked against this order.
  let choice: ApprovalChoice = { switchTo: null, scopePackageId: null, changes: [] }
  if (reservation.reservationType === 'FLOW') {
    const { snapshot, scheduleHash: currentScheduleHash } = await buildFlowApprovalBasis(reservation.id)
    const check = checkFlowApproval({
      signerName: validatedSignerName,
      quantityChanges,
      selectedPackageId,
      activePackageId: reservation.packages.find((p) => p.isActive)?.id ?? null,
      autopayMethod: autopay && typeof autopay === 'object' ? (autopay as { method?: unknown }).method : undefined,
      displayedTermsVersion: termsVersion,
      currentTermsVersion: snapshot.version,
      displayedScheduleHash: scheduleHash,
      currentScheduleHash,
    })
    if (!check.ok) throw new Error(check.error)
    flowApproval = { snapshot, autopayMethod: check.autopayMethod, signerName: check.signerName }
    // Nothing below may re-rate a Flow line with rental maths: `choice` stays empty.
  } else {
    const activePackageId = reservation.packages.find((p) => p.isActive)?.id ?? null
    const buildGroupIds = groupIdsOf(reservation.items)
    const checked = validateApprovalChoice({
      selectedPackageId,
      quantityChanges,
      packageIds: reservation.packages.map((p) => p.id),
      activePackageId,
      lines: reservation.items.map((item) => ({
        id: item.id,
        packageId: item.packageId,
        quantity: item.quantity,
        // A cloud host's config rows are hidden from the client (buildQuote), and a
        // sales build — heading or part — is priced as a whole: its quantities
        // are stored multiplied by the machine count, so a client edit would corrupt them.
        editable: !(item.parentId && item.cloudProductId) && !item.isGroup && !buildGroupIds.has(item.parentId ?? ''),
      })),
    })
    if (!checked.ok) throw new Error(checked.error)
    choice = checked

    for (const change of choice.changes) {
      const item = reservation.items.find((i) => i.id === change.itemId)!
      if (item.assetId && item.asset) {
        const max = item.quantity + (item.asset.units?.length ?? 0)
        if (change.newQuantity > max) {
          throw new Error(`Not enough units available for "${item.asset.name}". Max: ${max}`)
        }
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Claim the token first, atomically. Two concurrent approvals can both pass
    // the checks above (they run outside this transaction, against a snapshot
    // read earlier), but only one `updateMany` can flip usedAt from null here —
    // the loser gets 0 rows and must not touch anything else, since for Flow
    // that "anything else" is a payment authorization.
    const claimed = await tx.quoteToken.updateMany({
      where: { id: quoteToken.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) {
      throw new Error('This quote has already been answered.')
    }

    // Only one approval per order: the token claim above is per link, so two
    // links for one order could each claim their own. The status guard is the
    // order-level claim — whichever approval moves the order out of a quote
    // status first wins, and the other writes nothing.
    const now = new Date()
    const approved = await tx.reservation.updateMany({
      where: { id: reservation.id, status: ANSWERABLE },
      data: {
        status: 'APPROVED',
        approvedAt: now,
        confirmedAt: now,
        actionRequired: false,
        actionRequiredNote: null,
        ...(flowApproval ? {
          flowTermsSnapshot: flowApproval.snapshot as unknown as Prisma.InputJsonValue,
          flowTermsVersion: flowApproval.snapshot.version,
          flowAutopayMethod: flowApproval.autopayMethod,
          flowAutopayAuthorizedBy: flowApproval.signerName,
          flowAutopayAuthorizedAt: now,
        } : {}),
      },
    })
    if (approved.count !== 1) {
      throw new Error('This quote can no longer be approved')
    }

    // Switch to the option the client chose — validated above as one of this
    // order's own, and scoped to it again here.
    if (choice.switchTo) {
      await tx.package.updateMany({
        where: { reservationId: reservation.id },
        data: { isActive: false },
      })
      await tx.package.updateMany({
        where: { id: choice.switchTo, reservationId: reservation.id },
        data: { isActive: true },
      })
    }

    // A new option or new quantities re-price the order the way every staff edit
    // does (setActivePackage, updateReservationItemQuantity): the option's lines
    // only, each derived (a part included in its parent charges nothing), then
    // calculateReservationTotals for discount, credit, tax and shipping margin.
    if (choice.switchTo || choice.changes.length > 0) {
      const scoped = choice.scopePackageId
        ? reservation.items.filter((item) => item.packageId === choice.scopePackageId)
        : reservation.items
      let newSubtotal = 0
      for (const item of scoped) {
        const change = choice.changes.find((c) => c.itemId === item.id)
        const quantity = change ? change.newQuantity : item.quantity
        const amount = deriveItemAmount({ ...item, quantity }, reservation)
        newSubtotal += amount
        if (change) {
          await tx.reservationItem.updateMany({
            where: { id: item.id, reservationId: reservation.id },
            data: { quantity, subtotal: amount },
          })
        }
      }

      // Switching option brings that option's delivery and return with it, as
      // setActivePackage does; otherwise the order's own stand.
      const switchedTo = choice.switchTo ? reservation.packages.find((p) => p.id === choice.switchTo) : null
      const deliveryCost = Number(switchedTo ? switchedTo.deliveryCost : reservation.deliveryCost) || 0
      const returnCost = Number(switchedTo ? switchedTo.returnCost : reservation.returnCost) || 0
      const { discountAmount, taxAmount, total } = calculateReservationTotals({
        itemsSubtotal: newSubtotal,
        discountType: reservation.discountType,
        discountValue: Number(reservation.discountValue) || 0,
        taxRate: Number(reservation.taxRate) || 0,
        deliveryCost,
        returnCost,
        shippingMarginType: reservation.shippingMarginType || null,
        shippingMargin: Number(reservation.shippingMargin) || 0,
        rentalCreditAmount: Number(reservation.rentalCreditAmount) || 0,
      })

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          subtotal: newSubtotal,
          discountAmount,
          taxAmount,
          total,
          ...(switchedTo ? { deliveryCost, returnCost } : {}),
          // Rent-to-own payments follow the total (reservations.ts maybeRecalcRto).
          ...(reservation.reservationType === 'RENT_TO_OWN' && reservation.rtoTermMonths && total > 0
            ? { rtoMonthlyPayment: total / reservation.rtoTermMonths, rtoBuyoutPrice: total }
            : {}),
        },
      })
    }

    // Store signature on the proposal document if one exists
    const proposalDoc = await tx.document.findFirst({
      where: {
        entityType: 'RESERVATION',
        entityId: reservation.id,
        documentType: 'PROPOSAL',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (proposalDoc) {
      await tx.document.update({
        where: { id: proposalDoc.id },
        data: {
          isSigned: true,
          signedBy: validatedSignerName,
          signedAt: new Date(),
        },
      })
    }
  })

  // Generate signed quote PDF document
  try {
    // Plain server module (moved out of the 'use server' documents.ts so it is not a callable action).
    const { generateSignedQuoteDocument } = await import('@/lib/documents/signed-quote')
    await generateSignedQuoteDocument(reservation.id, signatureDataUrl, validatedSignerName)
  } catch (error) {
    console.error('Failed to generate signed quote document:', error)
  }

  // The tick-box above the signature pad says they agree to the rental terms
  // and conditions, so approving here settles the account's rental agreement —
  // and files the signed quote against the account as the artefact for it. Runs
  // after the PDF so there is something to file; non-critical in the same way
  // the history row below is, because the order is approved either way and a
  // failure here must not report that it isn't.
  try {
    const { settleAgreementFromQuote } = await import('@/lib/requirements/quote-terms')
    await settleAgreementFromQuote(reservation.id, validatedSignerName, new Date())
  } catch (error) {
    console.error('Failed to settle the rental agreement from a signed quote:', error)
  }

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservation.id,
      fromStatus: reservation.status,
      toStatus: 'APPROVED',
      notes: `Approved via quote link by ${validatedSignerName}`,
    })
  } catch { /* non-critical */ }

  // Send internal notification
  try {
    const { quoteApprovedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { recipientsFor } = await import('@/lib/notifications/recipients')

    const updatedRes = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: {
        client: true,
        packages: { include: { items: true } },
      },
    })
    if (updatedRes) {
      // Find the active (selected) package after the transaction committed
      const activePackage = updatedRes.packages.find((p) => p.isActive)
      const recipients = await recipientsFor('reservations')
      const template = quoteApprovedEmail({
        clientName: updatedRes.client.name,
        reservationNumber: updatedRes.reservationNumber,
        reservationId: updatedRes.id,
        signerName: validatedSignerName,
        total: Number(updatedRes.total),
        selectedPackageName: updatedRes.packages.length > 1 && activePackage
          ? activePackage.name
          : undefined,
      })
      for (const email of recipients) {
        await sendEmail({ to: email, subject: template.subject, html: template.html })
      }
    }
  } catch (error) {
    console.error('Failed to send quote approved notification:', error)
  }

  return { success: true }
}

/**
 * Request changes to a quote (NO AUTH).
 */
export async function requestQuoteChanges(token: string, changeNotes: string) {
  if (typeof token !== 'string' || !token) throw new Error('Quote not found')
  const noteCheck = cleanAnswerNote(changeNotes, { required: true })
  if (!noteCheck.ok) throw new Error(noteCheck.error)
  changeNotes = noteCheck.note!

  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: { client: true } } },
  })

  if (!quoteToken) throw new Error('Quote not found')
  const previousStatus = quoteToken.reservation.status
  const linkProblem = quoteAnswerProblem(quoteToken, previousStatus)
  if (linkProblem) throw new Error(linkProblem)

  // A link answers once, and only while the order is still a quote: claim the
  // link, then move the order only if it has not moved since it was read.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quoteToken.updateMany({
      where: { id: quoteToken.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) throw new Error('This quote has already been answered.')

    const moved = await tx.reservation.updateMany({
      where: { id: quoteToken.reservationId, status: ANSWERABLE },
      data: {
        status: 'REVISION',
        actionRequired: true,
        actionRequiredNote: changeNotes,
      },
    })
    if (moved.count !== 1) throw new Error('This quote can no longer be answered.')
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: quoteToken.reservationId,
      fromStatus: previousStatus,
      toStatus: 'REVISION',
      notes: `Client requested changes: ${changeNotes}`,
    })
  } catch { /* non-critical */ }

  // Send internal notification email
  try {
    const { quoteChangesRequestedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { recipientsFor } = await import('@/lib/notifications/recipients')

    const recipients = await recipientsFor('reservations')
    const template = quoteChangesRequestedEmail({
      clientName: quoteToken.reservation.client.name,
      reservationNumber: quoteToken.reservation.reservationNumber,
      reservationId: quoteToken.reservation.id,
      changeNotes,
    })

    for (const email of recipients) {
      await sendEmail({ to: email, subject: template.subject, html: template.html })
    }
  } catch (error) {
    console.error('Failed to send change request notification:', error)
  }

  return { success: true }
}

/**
 * Send quote link email to client (requires editor auth).
 */
export async function sendQuoteLinkEmail(
  reservationId: string,
  recipientEmail?: string,
  message?: string,
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      packages: { include: { items: true } },
    },
  })

  if (!reservation) throw new Error('Reservation not found')
  if (!['DRAFT', 'REVISION', 'QUOTE_SENT', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only send quote links for draft, revision, sent, or approved reservations')
  }

  const toEmail = recipientEmail?.trim() || reservation.client.email
  if (!toEmail) throw new Error('Client has no email address')

  const { token, url } = await generateQuoteToken(reservationId)

  const { quotePageLinkEmail } = await import('@/lib/email/templates')
  const { sendEmail } = await import('@/lib/email')

  // Build package summaries for the email with correct per-package totals
  const emailDiscountType = reservation.discountType
  const emailDiscountValue = Number(reservation.discountValue) || 0
  const emailTaxRate = Number(reservation.taxRate) || 0
  const emailPackages = reservation.packages.length > 1
    ? reservation.packages.map((pkg) => {
        const itemsSubtotal = pkg.items.reduce((sum, i) => sum + Number(i.subtotal), 0)
        const pkgDelivery = Number(pkg.deliveryCost) || 0
        const pkgReturn = Number(pkg.returnCost) || 0
        let disc = 0
        if (emailDiscountType === 'PERCENTAGE' && emailDiscountValue > 0) {
          disc = itemsSubtotal * (emailDiscountValue / 100)
        } else if (emailDiscountType === 'FIXED' && emailDiscountValue > 0) {
          disc = Math.min(emailDiscountValue, itemsSubtotal)
        }
        const afterDisc = itemsSubtotal - disc
        const tax = afterDisc * (emailTaxRate / 100)
        const total = afterDisc + tax + pkgDelivery + pkgReturn
        return { name: pkg.name, total, itemCount: pkg.items.length }
      })
    : undefined

  const template = quotePageLinkEmail({
    clientName: reservation.client.name,
    reservationNumber: reservation.reservationNumber,
    quoteUrl: url,
    startDate: new Date(reservation.startDate).toLocaleDateString(),
    endDate: new Date(reservation.endDate).toLocaleDateString(),
    total: Number(reservation.total),
    projectName: reservation.projectName || undefined,
    message: message?.trim() || undefined,
    reservationType: reservation.reservationType,
    // Re-read: generateQuoteToken above stamps a default expiration when unset.
    validUntil: (await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { quoteExpiresAt: true },
    }))?.quoteExpiresAt?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    packages: emailPackages,
  })

  const result = await sendEmail({
    to: toEmail,
    subject: template.subject,
    html: template.html,
    audience: 'client',
    clientId: reservation.clientId,
  })

  if (!result.success) throw new Error(result.error || 'Failed to send email')

  // This link is now the client's: only a sent link's opens count as client views.
  await prisma.quoteToken.update({
    where: { token },
    data: { sentAt: new Date(), sentTo: toEmail },
  })

  // Auto-transition to QUOTE_SENT if currently DRAFT or REVISION
  if (reservation.status === 'DRAFT' || reservation.status === 'REVISION') {
    const previousStatus = reservation.status
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'QUOTE_SENT',
        quoteSentAt: new Date(),
        actionRequired: false,
        actionRequiredNote: null,
      },
    })

    try {
      const { recordStatusChange } = await import('./status-history')
      await recordStatusChange({
        entityType: 'RESERVATION',
        entityId: reservationId,
        fromStatus: previousStatus,
        toStatus: 'QUOTE_SENT',
        changedById: authResult.userId!,
        notes: 'Quote link emailed to client',
      })
    } catch { /* non-critical */ }

    const { advanceLeadOnQuoteSent } = await import('@/lib/leads/quote-sent')
    await advanceLeadOnQuoteSent(reservationId, authResult.userId)

    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/dashboard/orders/${reservationId}`)
    revalidatePath('/dashboard/orders')
  }

  return { success: true, url }
}

/**
 * Record a client opening a quote link (NO AUTH — called from the quote page once
 * it has rendered in a browser, so mail scanners that only fetch the URL don't
 * count). Ignored for a logged-in staff user, for links never emailed (previews),
 * for expired links and for reloads within 30 minutes. The first count tells the
 * Orders recipients; a failed notice never loses the count.
 */
export async function recordQuoteView(token: string) {
  if (typeof token !== 'string' || !token) return
  const session = await auth()
  if (session?.user?.id) return

  const qt = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { select: { id: true, reservationNumber: true, total: true, client: { select: { name: true } } } } },
  })
  const now = new Date()
  if (!qt || !countsAsView(qt, now)) return

  // Counted only if nobody else counted since this read, so two tabs opening at
  // once are one view and one notice.
  const counted = await prisma.quoteToken.updateMany({
    where: { id: qt.id, lastViewedAt: qt.lastViewedAt },
    data: {
      viewCount: { increment: 1 },
      lastViewedAt: now,
      ...(qt.firstViewedAt ? {} : { firstViewedAt: now }),
    },
  })
  if (counted.count !== 1 || qt.firstViewedAt) return

  try {
    const { quoteViewedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { recipientsFor } = await import('@/lib/notifications/recipients')
    const { dayYear } = await import('@/lib/format')

    const recipients = await recipientsFor('reservations')
    const template = quoteViewedEmail({
      clientName: qt.reservation.client.name,
      reservationNumber: qt.reservation.reservationNumber,
      reservationId: qt.reservation.id,
      sentTo: qt.sentTo,
      sentAt: qt.sentAt ? dayYear(qt.sentAt) : undefined,
      total: Number(qt.reservation.total),
    })
    for (const email of recipients) {
      await sendEmail({ to: email, subject: template.subject, html: template.html })
    }
  } catch (error) {
    console.error('Failed to send quote viewed notification:', error)
  }
}

/**
 * Deny/decline a quote (NO AUTH).
 */
export async function denyQuote(token: string, reason?: string) {
  if (typeof token !== 'string' || !token) throw new Error('Quote not found')
  const noteCheck = cleanAnswerNote(reason, { required: false })
  if (!noteCheck.ok) throw new Error(noteCheck.error)
  reason = noteCheck.note ?? undefined

  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: { client: true } } },
  })

  if (!quoteToken) throw new Error('Quote not found')

  const reservation = quoteToken.reservation
  const previousStatus = reservation.status
  const linkProblem = quoteAnswerProblem(quoteToken, previousStatus)
  if (linkProblem) throw new Error(linkProblem)

  // Same one-answer rule as approval: claim the link, then move the order only
  // while it is still a quote — a spent or stale link can never lose an order.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quoteToken.updateMany({
      where: { id: quoteToken.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) throw new Error('This quote has already been answered.')

    const moved = await tx.reservation.updateMany({
      where: { id: reservation.id, status: ANSWERABLE },
      data: {
        status: 'LOST',
        actionRequired: false,
        actionRequiredNote: reason ? `Client declined: ${reason}` : 'Client declined the quote',
      },
    })
    if (moved.count !== 1) throw new Error('This quote can no longer be answered.')
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservation.id,
      fromStatus: previousStatus,
      toStatus: 'LOST',
      notes: reason ? `Client declined via quote link: ${reason}` : 'Client declined via quote link',
    })
  } catch { /* non-critical */ }

  // Asks this order had answered go back to Lost with it — the same rule markLost follows.
  try {
    const { loseAsksLinkedTo } = await import('@/lib/tracker/order-outcome')
    await loseAsksLinkedTo(reservation.id, reason ? `Client declined: ${reason}` : 'Client declined the quote')
  } catch (error) {
    console.error('Failed to close asks linked to a declined quote:', error)
  }

  // Send internal notification
  try {
    const { quoteDeniedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { recipientsFor } = await import('@/lib/notifications/recipients')

    const recipients = await recipientsFor('reservations')
    const template = quoteDeniedEmail({
      clientName: reservation.client.name,
      reservationNumber: reservation.reservationNumber,
      reservationId: reservation.id,
      reason: reason || undefined,
    })

    for (const email of recipients) {
      await sendEmail({ to: email, subject: template.subject, html: template.html })
    }
  } catch (error) {
    console.error('Failed to send quote denied notification:', error)
  }

  return { success: true }
}

/**
 * Clear action required flag on a reservation (requires editor auth).
 */
export async function clearActionRequired(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      actionRequired: false,
      actionRequiredNote: null,
    },
  })

  return { success: true }
}


/**
 * Set when a quote's pricing stops being honored.
 *
 * Moves the order's date and, in the same transaction, the cutoff of every link
 * not yet answered, so the order, the PDF, the email and the link all agree. A
 * link's own `expiresAt` is what actually kills it, which is why moving only the
 * order's date would leave a "valid until" that the link ignores.
 */
export async function setQuoteExpiry(
  reservationId: string,
  isoDate: string,
): Promise<{ status: 'ok'; expiresOn: string } | { status: 'error'; message: string }> {
  const authResult = await requireEditor()
  if (!authResult.authorized) return { status: 'error', message: authResult.error || 'Unauthorized' }

  const parsed = new Date(`${isoDate}T12:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || Number.isNaN(parsed.getTime())) {
    return { status: 'error', message: 'Pick a valid date.' }
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true, quoteExpiresAt: true },
  })
  if (!reservation) return { status: 'error', message: 'Order not found.' }

  const { canSetExpiry, endOfExpiryDay } = await import('@/lib/quotes/expiry')
  const allowed = canSetExpiry(reservation.status, parsed)
  if (!allowed.ok) return { status: 'error', message: allowed.message }

  await prisma.$transaction([
    prisma.reservation.update({ where: { id: reservationId }, data: { quoteExpiresAt: parsed } }),
    prisma.quoteToken.updateMany({
      where: { reservationId, usedAt: null },
      data: { expiresAt: endOfExpiryDay(parsed) },
    }),
  ])

  const { logAudit } = await import('@/lib/actions/audit')
  await logAudit({
    action: 'UPDATE',
    entityType: 'Reservation',
    entityId: reservationId,
    oldValues: { quoteExpiresAt: reservation.quoteExpiresAt },
    newValues: { quoteExpiresAt: parsed },
    userId: authResult.userId,
  })

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/dashboard/orders/${reservationId}`)
  return { status: 'ok', expiresOn: isoDate }
}

/** The note an expired-link request leaves, so a second press can tell one is already waiting. */
const REFRESH_NOTE = 'Client asked for a refreshed quote (their link expired).'

/**
 * The expired page's button (NO AUTH). Flags the order and tells the team.
 *
 * Works on an expired link by design. Refused for a spent link and for an order
 * that is no longer a quote, and quiet when a request is already waiting, so a
 * public button cannot be used to mail the team repeatedly.
 */
export async function requestQuoteRefresh(
  token: string,
): Promise<{ status: 'ok'; message: string } | { status: 'error'; message: string }> {
  if (typeof token !== 'string' || !token) return { status: 'error', message: 'Quote not found.' }

  const link = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: { client: { select: { name: true } } } } },
  })
  if (!link) return { status: 'error', message: 'Quote not found.' }
  if (link.usedAt) return { status: 'error', message: 'This quote has already been answered.' }

  const order = link.reservation
  if (!['QUOTE_SENT', 'REVISION'].includes(order.status)) {
    return { status: 'error', message: 'This quote can no longer be refreshed. Reply to the email it came in.' }
  }

  const done = { status: 'ok' as const, message: 'Thank you. We have your request and will send an updated quote.' }
  if (order.actionRequired && order.actionRequiredNote === REFRESH_NOTE) return done

  const claimed = await prisma.reservation.updateMany({
    where: { id: order.id, OR: [{ actionRequired: false }, { actionRequiredNote: { not: REFRESH_NOTE } }] },
    data: { actionRequired: true, actionRequiredNote: REFRESH_NOTE },
  })
  if (claimed.count !== 1) return done

  try {
    const { sendEmail } = await import('@/lib/email')
    const { recipientsFor } = await import('@/lib/notifications/recipients')
    const { escapeHtml } = await import('@/lib/email/layout')
    const { APP_URL } = await import('@/lib/email/client')
    const recipients = await recipientsFor('reservations')
    const subject = `Quote refresh requested: ${order.reservationNumber}`
    const html = `<p>${escapeHtml(order.client.name)} opened an expired quote link for <strong>${escapeHtml(order.reservationNumber)}</strong> and asked for an updated quote.</p><p><a href="${APP_URL}/dashboard/orders/${order.id}">Open the order</a>, then extend the quote's expiry or revise it.</p>`
    for (const email of recipients) await sendEmail({ to: email, subject, html })
  } catch (error) {
    console.error('Failed to send quote refresh notice:', error)
  }

  return done
}
