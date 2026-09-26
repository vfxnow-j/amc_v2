'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'
import { addDays } from 'date-fns'
import { calculateNextBillingDate, generateInvoiceNumber, getBillingPeriod } from '@/lib/utils/billing'
import type { BillingCycleType } from '@/lib/types'
import { addDays as addCalendarDays, anchorAfter, billedPeriods, intendedDay, isAnchoredCycle } from '@/lib/billing/calendar'
import { cycleInvoice, cycleTermsFor, toCycleLine } from '@/lib/billing/cycle-invoice'
import { termEnd } from '@/lib/billing/payment-schedule'
import { formatPeriodCount, roundMoney } from '@/lib/pricing/periods'
import { getBillingAnchor } from '@/lib/settings/business'
import { requireAdmin, requireAuth } from '@/lib/auth-utils'

export type BillingRunResult = {
  processed: number
  invoicesCreated: string[]
  errors: string[]
}

export async function runBillingCycle(): Promise<BillingRunResult> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const now = new Date()
  const result: BillingRunResult = { processed: 0, invoicesCreated: [], errors: [] }

  const dueReservations = await prisma.reservation.findMany({
    where: {
      status: 'ACTIVE',
      billingCycleType: { not: 'ONE_TIME' },
      isRecurring: true,
      notBilled: false,
      nextBillingDate: { lte: now },
    },
    include: {
      client: true,
      // Only the quote option the client went ahead with bills.
      items: {
        where: { OR: [{ packageId: null }, { package: { isActive: true } }] },
        include: { asset: true },
      },
      packages: { where: { isActive: true }, select: { deliveryCost: true, returnCost: true } },
    },
  })

  const anchor = await getBillingAnchor()

  for (const reservation of dueReservations) {
    // Skip if recurrence end date has passed
    if (reservation.recurrenceEndDate && new Date(reservation.recurrenceEndDate) < now) {
      continue
    }
    // A committed term ends billing (owner, 2026-09-26). RTO counts installments instead.
    const termStop = reservation.reservationType !== 'RENT_TO_OWN' && reservation.termMonths
      ? termEnd(reservation.startDate, reservation.termMonths)
      : null
    if (termStop && reservation.nextBillingDate && intendedDay(reservation.nextBillingDate).getTime() >= termStop.getTime()) {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { nextBillingDate: null } })
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        const invoiceNumber = await generateInvoiceNumber(tx)

        const isRTO = reservation.reservationType === 'RENT_TO_OWN'
        const periodsCompleted = reservation.billingPeriodsCompleted || 0
        const periodNumber = periodsCompleted + 1

        // Calculate billing period boundaries (e.g. Apr 1 – Apr 30 for monthly)
        const billingDate = reservation.nextBillingDate || new Date()
        const cycle = reservation.billingCycleType as BillingCycleType
        const { periodStart, periodEnd } = getBillingPeriod(
          billingDate,
          cycle,
          reservation.billingCycleDays ?? undefined,
          anchor
        )
        // Anchored cycles bill up to the next anchor. On the anchor that is one
        // whole period; off it — an invoice date scheduled before the business
        // moved its billing day — it is the stretch up to the new day, prorated.
        const anchoredNext = isAnchoredCycle(cycle) ? anchorAfter(billingDate, cycle, anchor) : null
        // The last stretch of a committed term stops at the term's end.
        const stretchEnd = anchoredNext && termStop && anchoredNext.getTime() > termStop.getTime() ? termStop : anchoredNext
        const share = isAnchoredCycle(cycle) && stretchEnd
          ? billedPeriods(billingDate, stretchEnd, cycle, anchor)
          : 1
        const priorInvoices = await tx.invoice.count({
          where: { reservationId: reservation.id, status: { notIn: ['VOID', 'CANCELLED'] } },
        })
        const billedTo = termStop && periodEnd.getTime() >= termStop.getTime() ? addCalendarDays(termStop, -1) : periodEnd

        // For RTO, use the fixed monthly payment amount; otherwise calculate from items
        let subtotal = 0
        let cycleTax: number | null = null
        let invoiceItems
        if (isRTO && reservation.rtoMonthlyPayment) {
          // RTO: single line item for the monthly installment
          const monthlyPayment = Number(reservation.rtoMonthlyPayment)
          subtotal = monthlyPayment
          invoiceItems = reservation.items.map((item) => {
            const qty = Number(item.quantity) || 1
            const price = Number(item.rate)
            const amount = qty * price
            return {
              description: `${item.asset?.name || item.description || 'Ad-hoc item'} — RTO Installment ${periodNumber} of ${reservation.rtoTermMonths}`,
              quantity: qty,
              unitPrice: price,
              amount,
              assetId: item.assetId,
            }
          })
        } else {
          // What the quote says: the discount, parts inside a system's price
          // left out, one-time lines and delivery on the first invoice only.
          const priced = cycleInvoice({
            lines: reservation.items.map(toCycleLine),
            share,
            first: priorInvoices === 0,
            terms: cycleTermsFor({
              ...reservation,
              deliveryCost: reservation.packages[0]?.deliveryCost ?? reservation.deliveryCost,
              returnCost: reservation.packages[0]?.returnCost ?? reservation.returnCost,
            }),
            shareNote: Math.abs(share - 1) < 0.0005 ? '' : ` × ${formatPeriodCount(share)}`,
          })
          invoiceItems = priced.items
          subtotal = priced.subtotal
          cycleTax = priced.taxAmount
        }

        const resTaxRate = Number(reservation.taxRate) || 0
        const taxAmount = cycleTax ?? roundMoney(subtotal * (resTaxRate / 100))
        const total = roundMoney(subtotal + taxAmount)

        const paymentTerms = reservation.paymentTerms ?? reservation.client.paymentTerms ?? 30
        const dueDate = addDays(new Date(), paymentTerms)

        // Format period label for notes
        const periodLabel = periodNumber >= 12 && periodNumber % 12 === 0
          ? `${periodNumber / 12} year${periodNumber / 12 > 1 ? 's' : ''}`
          : `${periodNumber} month${periodNumber > 1 ? 's' : ''}`

        let notes: string
        if (isRTO) {
          notes = `RTO Installment ${periodNumber} of ${reservation.rtoTermMonths}` +
            (reservation.projectName ? ` — Project: ${reservation.projectName}` : '')
        } else {
          const projectPart = reservation.projectName ? `Project: ${reservation.projectName} — ` : ''
          notes = `${projectPart}Recurring billing period ${periodNumber} (${periodLabel})`
        }

        await tx.invoice.create({
          data: {
            invoiceNumber,
            clientId: reservation.clientId,
            reservationId: reservation.id,
            issueDate: new Date(),
            dueDate,
            subtotal,
            taxRate: resTaxRate,
            taxAmount,
            total,
            status: 'DRAFT',
            notes,
            periodNumber,
            periodStartDate: periodStart,
            periodEndDate: billedTo,
            items: { create: invoiceItems },
          },
        })

        // Anchored cycles step to the next anchor after the date just billed, so
        // a run that is late bills every missed period in turn instead of
        // skipping to the future. Legacy cycles keep counting from today.
        const nextBilling = anchoredNext ?? calculateNextBillingDate(
          new Date(),
          cycle,
          reservation.billingCycleDay,
          reservation.billingCycleDays ?? undefined,
          anchor
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resUpdate: any = {
          lastBilledDate: new Date(),
          // Once the term's last stretch is billed, the schedule ends.
          nextBillingDate: termStop && nextBilling && nextBilling.getTime() >= termStop.getTime() ? null : nextBilling,
          billingPeriodsCompleted: periodNumber,
        }

        // Set RTO start date on first invoice
        if (isRTO && !reservation.rtoStartDate) {
          resUpdate.rtoStartDate = new Date()
        }

        await tx.reservation.update({
          where: { id: reservation.id },
          data: resUpdate,
        })

        result.invoicesCreated.push(invoiceNumber)
      })
      result.processed++
    } catch (error) {
      result.errors.push(
        `Reservation ${reservation.reservationNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard/orders')
  revalidatePath('/dashboard')

  return result
}

export async function getUpcomingBilling(days: number = 7) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const futureDate = addDays(new Date(), days)

  const reservations = await prisma.reservation.findMany({
    where: {
      status: 'ACTIVE',
      billingCycleType: { not: 'ONE_TIME' },
      isRecurring: true,
      nextBillingDate: { lte: futureDate, gte: new Date() },
    },
    include: { client: true },
    orderBy: { nextBillingDate: 'asc' },
  })

  return serialize(reservations)
}
