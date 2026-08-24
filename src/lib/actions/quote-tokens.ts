'use server'

import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { calculatePeriods } from '@/lib/actions/reservations'
import { computeItemSubtotal } from '@/lib/pricing/periods'
import { computeReservationFinancials, deriveItemAmount } from '@/lib/pricing/financials'
import crypto from 'crypto'

const TOKEN_EXPIRY_DAYS = 30

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
  const allowedStatuses = ['DRAFT', 'REVISION', 'QUOTE_SENT', 'APPROVED']
  if (!allowedStatuses.includes(reservation.status)) {
    throw new Error('Can only generate quote links for draft, revision, sent, or approved reservations')
  }

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
 * Fetch quote data by token (NO AUTH required — public access).
 */
export async function getQuoteByToken(token: string) {
  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: {
      reservation: {
        include: {
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
        },
      },
    },
  })

  if (!quoteToken) return { error: 'Quote not found' }
  if (quoteToken.expiresAt < new Date()) return { error: 'This quote link has expired' }
  if (quoteToken.usedAt) {
    // Return status so the page can resume the post-approval flow
    const status = quoteToken.reservation.status as string
    return { error: 'already_used', status }
  }

  const { reservation } = quoteToken

  // Helper: group items by category. Components (parentId set) stay attached to
  // their parent's display group — the UI renders them indented beneath the parent.
  type QuoteItem = {
    id: string; name: string; quantity: number; pricingType: string;
    rate: number; subtotal: number; assetId: string | null; availableUnits: number; isOneTime: boolean;
    parentId?: string | null; isComponent?: boolean; configuredTotal?: number;
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
    const buildQuoteItem = (item: typeof items[number]): QuoteItem => {
      const isComponent = !!item.parentId
      // Derived, not the stored column — the customer-facing quote must show the same
      // figure as the order page. See src/lib/pricing/financials.ts.
      const subtotal = deriveItemAmount(item, reservation)
      let configuredTotal: number | undefined
      if (!isComponent) {
        const kids = childrenByParent.get(item.id) || []
        if (kids.length > 0) {
          configuredTotal = subtotal + kids.reduce((sum, k) => sum + deriveItemAmount(k, reservation), 0)
        }
      }
      return {
        id: item.id,
        name: item.description || item.asset?.name || 'Ad-hoc item',
        quantity: item.quantity,
        pricingType: item.pricingType,
        rate: Number(item.rate),
        subtotal,
        assetId: item.assetId,
        availableUnits: item.asset?.units?.length ?? 0,
        isOneTime: item.isOneTime,
        parentId: item.parentId,
        isComponent,
        configuredTotal,
      }
    }
    // Order: parents first, each followed by its components; they share the parent's category.
    const map = new Map<string, QuoteItem[]>()
    for (const item of visibleItems) {
      if (item.parentId) continue
      const categoryName = item.asset?.category?.name || (item as any).category || 'Uncategorized'
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
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
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

  return serialize({
    reservationNumber: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    status: reservation.status,
    // Quote lifecycle — surfaced so the client sees when it was issued and how
    // long the pricing holds. The order-level expiration wins when set; the token
    // expiry is the fallback for links issued before that field existed.
    issuedAt: quoteToken.createdAt,
    expiresAt: reservation.quoteExpiresAt ?? quoteToken.expiresAt,
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
  })
}

/**
 * Approve a quote — confirms the reservation and records signature (NO AUTH).
 */
export async function approveQuote(
  token: string,
  signerName: string,
  signatureDataUrl: string,
  quantityChanges?: Array<{ itemId: string; newQuantity: number }>,
  selectedPackageId?: string
) {
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
  if (quoteToken.expiresAt < new Date()) throw new Error('Quote link expired')
  if (quoteToken.usedAt) throw new Error('Quote already responded to')

  const { reservation } = quoteToken

  if (reservation.status !== 'DRAFT' && reservation.status !== 'QUOTE_SENT') {
    throw new Error('This quote can no longer be approved')
  }

  await prisma.$transaction(async (tx) => {
    // Switch active package if client selected a different one
    if (selectedPackageId) {
      const currentActive = reservation.packages.find((p) => p.isActive)
      if (currentActive && currentActive.id !== selectedPackageId) {
        await tx.package.updateMany({
          where: { reservationId: reservation.id },
          data: { isActive: false },
        })
        await tx.package.update({
          where: { id: selectedPackageId },
          data: { isActive: true },
        })
      }
    }

    // Apply quantity changes if any
    if (quantityChanges && quantityChanges.length > 0) {
      let newSubtotal = 0

      for (const item of reservation.items) {
        const change = quantityChanges.find((c) => c.itemId === item.id)
        const newQty = change ? change.newQuantity : item.quantity

        // Validate availability
        if (item.assetId && item.asset) {
          const availableCount = item.asset.units?.length ?? 0
          if (newQty > item.quantity + availableCount) {
            throw new Error(
              `Not enough units available for "${item.asset.name}". Max: ${item.quantity + availableCount}`
            )
          }
        }

        const periods = item.isOneTime ? 1 : await calculatePeriods(reservation.startDate, reservation.endDate, item.pricingType, reservation.isRecurring)
        const itemSubtotal = computeItemSubtotal(Number(item.rate), newQty, periods)
        newSubtotal += itemSubtotal

        if (change) {
          await tx.reservationItem.update({
            where: { id: item.id },
            data: { quantity: newQty, subtotal: itemSubtotal },
          })
        }
      }

      // Recalculate totals (include logistics)
      const discountAmount = Number(reservation.discountAmount)
      const taxRate = Number(reservation.taxRate)
      const afterDiscount = newSubtotal - discountAmount
      const taxAmount = afterDiscount * (taxRate / 100)
      const logistics = (Number(reservation.deliveryCost) || 0) + (Number(reservation.returnCost) || 0)
      const total = afterDiscount + taxAmount + logistics

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          subtotal: newSubtotal,
          taxAmount,
          total,
        },
      })
    }

    // Approve the reservation
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        confirmedAt: new Date(),
        actionRequired: false,
        actionRequiredNote: null,
      },
    })

    // Mark token as used
    await tx.quoteToken.update({
      where: { id: quoteToken.id },
      data: { usedAt: new Date() },
    })

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
          signedBy: signerName,
          signedAt: new Date(),
        },
      })
    }
  })

  // Generate signed quote PDF document
  try {
    const { generateSignedQuoteDocument } = await import('./documents')
    await generateSignedQuoteDocument(reservation.id, signatureDataUrl, signerName)
  } catch (error) {
    console.error('Failed to generate signed quote document:', error)
  }

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservation.id,
      fromStatus: reservation.status,
      toStatus: 'APPROVED',
      notes: `Approved via quote link by ${signerName}`,
    })
  } catch { /* non-critical */ }

  // Send internal notification
  try {
    const { quoteApprovedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { getRecipientsForCategory } = await import('./notifications')

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
      const recipients = await getRecipientsForCategory('reservations')
      const template = quoteApprovedEmail({
        clientName: updatedRes.client.name,
        reservationNumber: updatedRes.reservationNumber,
        reservationId: updatedRes.id,
        signerName,
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
  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: { client: true } } },
  })

  if (!quoteToken) throw new Error('Quote not found')
  if (quoteToken.expiresAt < new Date()) throw new Error('Quote link expired')

  const reservation = await prisma.reservation.findUnique({ where: { id: quoteToken.reservationId } })
  const previousStatus = reservation?.status || 'QUOTE_SENT'

  await prisma.reservation.update({
    where: { id: quoteToken.reservationId },
    data: {
      status: 'REVISION',
      actionRequired: true,
      actionRequiredNote: changeNotes,
    },
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
    const { getRecipientsForCategory } = await import('./notifications')

    const recipients = await getRecipientsForCategory('reservations')
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

  const { url } = await generateQuoteToken(reservationId)

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
  })

  if (!result.success) throw new Error(result.error || 'Failed to send email')

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

    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/dashboard/orders/${reservationId}`)
    revalidatePath('/dashboard/orders')
  }

  return { success: true, url }
}

/**
 * Deny/decline a quote (NO AUTH).
 */
export async function denyQuote(token: string, reason?: string) {
  const quoteToken = await prisma.quoteToken.findUnique({
    where: { token },
    include: { reservation: { include: { client: true } } },
  })

  if (!quoteToken) throw new Error('Quote not found')
  if (quoteToken.expiresAt < new Date()) throw new Error('Quote link expired')

  const reservation = quoteToken.reservation
  const previousStatus = reservation.status

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'LOST',
        actionRequired: false,
        actionRequiredNote: reason ? `Client declined: ${reason}` : 'Client declined the quote',
      },
    })

    await tx.quoteToken.update({
      where: { id: quoteToken.id },
      data: { usedAt: new Date() },
    })
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

  // Send internal notification
  try {
    const { quoteDeniedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const { getRecipientsForCategory } = await import('./notifications')

    const recipients = await getRecipientsForCategory('reservations')
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
