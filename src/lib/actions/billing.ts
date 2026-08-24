'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'
import { addDays } from 'date-fns'
import { calculateNextBillingDate, generateInvoiceNumber, getBillingPeriod } from '@/lib/utils/billing'
import type { BillingCycleType } from '@/lib/types'
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
      items: { include: { asset: true } },
    },
  })

  for (const reservation of dueReservations) {
    // Skip if recurrence end date has passed
    if (reservation.recurrenceEndDate && new Date(reservation.recurrenceEndDate) < now) {
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
        const { periodStart, periodEnd } = getBillingPeriod(
          billingDate,
          reservation.billingCycleType as BillingCycleType,
          reservation.billingCycleDays ?? undefined
        )

        // For RTO, use the fixed monthly payment amount; otherwise calculate from items
        let subtotal = 0
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
          invoiceItems = reservation.items.map((item) => {
            const qty = Number(item.quantity) || 1
            const price = Number(item.rate)
            const amount = qty * price
            subtotal += amount
            return {
              description: `${item.asset?.name || item.description || 'Ad-hoc item'} (${item.pricingType} rate)`,
              quantity: qty,
              unitPrice: price,
              amount,
              assetId: item.assetId,
            }
          })
        }

        const resTaxRate = Number(reservation.taxRate) || 0
        const taxAmount = subtotal * (resTaxRate / 100)
        const total = subtotal + taxAmount

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
            periodEndDate: periodEnd,
            items: { create: invoiceItems },
          },
        })

        const nextBilling = calculateNextBillingDate(
          new Date(),
          reservation.billingCycleType as BillingCycleType,
          reservation.billingCycleDay,
          reservation.billingCycleDays ?? undefined
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resUpdate: any = {
          lastBilledDate: new Date(),
          nextBillingDate: nextBilling,
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
