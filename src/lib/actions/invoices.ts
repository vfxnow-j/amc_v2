'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import type { InvoiceStatus } from '@/lib/types'

export type InvoiceFormData = {
  clientId: string
  reservationId?: string
  issueDate?: Date
  dueDate: Date
  taxRate?: number
  notes?: string
  terms?: string
  items: {
    description: string
    quantity: number
    unitPrice: number
    assetId?: string
    checkoutId?: string
  }[]
}

export type InvoiceFilters = {
  search?: string
  status?: InvoiceStatus
  clientId?: string
  startDate?: Date
  endDate?: Date
}

export type PaymentData = {
  amount: number
  paymentDate?: Date
  paymentMethod?: string
  reference?: string
  notes?: string
}

// Generate unique invoice number
async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: `INV-${year}-`,
      },
    },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })

  let sequence = 1
  if (lastInvoice?.invoiceNumber) {
    const match = lastInvoice.invoiceNumber.match(/INV-\d{4}-(\d+)/)
    if (match) {
      sequence = parseInt(match[1], 10) + 1
    }
  }

  return `INV-${year}-${sequence.toString().padStart(5, '0')}`
}

export async function getInvoices(filters: InvoiceFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, clientId, startDate, endDate } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { client: { companyName: { contains: search, mode: 'insensitive' } } },
      { reservation: { reservationNumber: { contains: search, mode: 'insensitive' } } },
    ]
  }

  if (status) {
    where.status = status
  }

  if (clientId) {
    where.clientId = clientId
  }

  if (startDate || endDate) {
    where.AND = []
    if (startDate) {
      where.AND.push({ issueDate: { gte: startDate } })
    }
    if (endDate) {
      where.AND.push({ issueDate: { lte: endDate } })
    }
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      client: true,
      reservation: {
        select: {
          reservationNumber: true,
          projectName: true,
        },
      },
      items: {
        include: {
          asset: {
            select: { name: true },
          },
        },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
      _count: {
        select: { payments: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(invoices)
}

export async function getInvoice(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      reservation: {
        include: {
          items: {
            include: {
              asset: true,
            },
          },
        },
      },
      items: {
        include: {
          asset: {
            select: { name: true },
          },
          checkout: {
            select: { checkoutDate: true, actualReturn: true },
          },
        },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
  })

  return serialize(invoice)
}

export async function createInvoice(data: InvoiceFormData) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const invoiceNumber = await generateInvoiceNumber()

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

  const taxRate = data.taxRate || 0
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      clientId: data.clientId,
      reservationId: data.reservationId,
      issueDate: data.issueDate || new Date(),
      dueDate: data.dueDate,
      subtotal,
      taxRate,
      taxAmount,
      total,
      notes: data.notes,
      terms: data.terms,
      status: 'DRAFT',
      items: {
        create: itemsWithAmounts.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          assetId: item.assetId,
          checkoutId: item.checkoutId,
        })),
      },
    },
    include: {
      client: true,
      items: true,
    },
  })

  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard')

  return serialize(invoice)
}

export async function updateInvoice(id: string, data: Partial<InvoiceFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const invoice = await prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    })

    if (!existingInvoice) {
      throw new Error('Invoice not found')
    }

    // Only allow edits on DRAFT invoices
    if (existingInvoice.status !== 'DRAFT') {
      throw new Error('Can only edit draft invoices')
    }

    // Calculate new totals if items changed
    let subtotal = Number(existingInvoice.subtotal)
    let taxRate = Number(existingInvoice.taxRate)

    if (data.taxRate !== undefined) {
      taxRate = data.taxRate
    }

    if (data.items) {
      subtotal = 0
      const itemsWithAmounts = data.items.map((item) => {
        const amount = item.quantity * item.unitPrice
        subtotal += amount
        return {
          ...item,
          amount,
        }
      })

      // Delete existing items and create new ones
      await tx.invoiceItem.deleteMany({
        where: { invoiceId: id },
      })

      await tx.invoiceItem.createMany({
        data: itemsWithAmounts.map((item) => ({
          invoiceId: id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          assetId: item.assetId,
          checkoutId: item.checkoutId,
        })),
      })
    }

    const taxAmount = subtotal * (taxRate / 100)
    const total = subtotal + taxAmount

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        clientId: data.clientId,
        reservationId: data.reservationId,
        dueDate: data.dueDate,
        subtotal,
        taxRate,
        taxAmount,
        total,
        notes: data.notes,
        terms: data.terms,
      },
      include: {
        client: true,
        items: true,
      },
    })

    return updated
  })

  revalidatePath('/dashboard/invoices')
  revalidatePath(`/dashboard/invoices/${id}`)

  return serialize(invoice)
}

export async function sendInvoice(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { updated: invoice, client } = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { id },
      include: { client: true },
    })

    if (!existing) {
      throw new Error('Invoice not found')
    }

    if (existing.status !== 'DRAFT') {
      throw new Error('Can only send draft invoices')
    }

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: 'SENT',
      },
    })

    return { updated, client: existing.client }
  })

  // Send email notification to client (outside transaction - side effect)
  if (client.email) {
    const { invoiceCreatedEmail } = await import('@/lib/email/templates')
    const { sendEmail } = await import('@/lib/email')
    const template = invoiceCreatedEmail(
      client.name,
      invoice.invoiceNumber,
      `$${Number(invoice.total).toFixed(2)}`,
      new Date(invoice.dueDate).toLocaleDateString(),
    )
    await sendEmail({ to: client.email, subject: template.subject, html: template.html })
  }

  revalidatePath('/dashboard/invoices')
  revalidatePath(`/dashboard/invoices/${id}`)

  return invoice
}

export async function recordPayment(invoiceId: string, payment: PaymentData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const invoice = await prisma.$transaction(async (tx) => {
    const existingInvoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
    })

    if (!existingInvoice) {
      throw new Error('Invoice not found')
    }

    if (existingInvoice.status === 'VOID' || existingInvoice.status === 'CANCELLED') {
      throw new Error('Cannot record payment on voided or cancelled invoice')
    }

    // Create payment record
    await tx.payment.create({
      data: {
        invoiceId,
        amount: payment.amount,
        paymentDate: payment.paymentDate || new Date(),
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        notes: payment.notes,
      },
    })

    // Update invoice amounts
    const newAmountPaid = Number(existingInvoice.amountPaid) + payment.amount
    const total = Number(existingInvoice.total)

    let newStatus: InvoiceStatus = existingInvoice.status as InvoiceStatus
    if (newAmountPaid >= total) {
      newStatus = 'PAID'
    } else if (newAmountPaid > 0) {
      newStatus = 'PARTIAL'
    }

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newAmountPaid,
        status: newStatus,
      },
      include: {
        client: true,
        payments: true,
      },
    })

    return updated
  })

  revalidatePath('/dashboard/invoices')
  revalidatePath(`/dashboard/invoices/${invoiceId}`)
  revalidatePath('/dashboard')

  return serialize(invoice)
}

export async function voidInvoice(id: string, reason?: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
    })

    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status === 'PAID') {
      throw new Error('Cannot void a fully paid invoice')
    }

    const result = await tx.invoice.update({
      where: { id },
      data: {
        status: 'VOID',
        notes: reason
          ? invoice.notes
            ? `${invoice.notes}\n\nVoid reason: ${reason}`
            : `Void reason: ${reason}`
          : invoice.notes,
      },
    })

    return result
  })

  revalidatePath('/dashboard/invoices')
  revalidatePath(`/dashboard/invoices/${id}`)

  return updated
}

export async function markOverdue() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Mark overdue invoices (called by cron job)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  await prisma.invoice.updateMany({
    where: {
      status: { in: ['SENT', 'PARTIAL'] },
      dueDate: { lt: today },
    },
    data: {
      status: 'OVERDUE',
    },
  })

  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard')
}

export async function createInvoiceFromReservation(reservationId: string, dueDate: Date, taxRate?: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      items: {
        include: {
          asset: true,
        },
      },
    },
  })

  if (!reservation) {
    throw new Error('Reservation not found')
  }

  // Build invoice items from reservation
  const items = reservation.items.map((item) => ({
    description: `${item.asset?.name || item.description || 'Ad-hoc item'} (${item.pricingType} rate)`,
    quantity: Number(item.quantity) || 1,
    unitPrice: Number(item.rate),
    assetId: item.assetId || undefined,
  }))

  // Inherit tax rate from reservation if not provided
  const effectiveTaxRate = taxRate ?? (Number(reservation.taxRate) || 0)

  return createInvoice({
    clientId: reservation.clientId,
    reservationId: reservation.id,
    dueDate,
    taxRate: effectiveTaxRate,
    items,
    notes: reservation.projectName ? `Project: ${reservation.projectName}` : undefined,
  })
}

// Create invoice for only the add-on items (added since last billing)
export async function createInvoiceForAddOns(reservationId: string, dueDate: Date, taxRate?: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      client: true,
      items: { include: { asset: true } },
    },
  })

  if (!reservation) throw new Error('Reservation not found')

  // Cutoff: items added after the last billing (or confirmation/creation)
  const cutoffDate = reservation.lastBilledDate || reservation.confirmedAt || reservation.createdAt
  const addOnItems = reservation.items.filter(
    (item) => new Date(item.addedAt) > new Date(cutoffDate)
  )

  if (addOnItems.length === 0) {
    throw new Error('No add-on items found to invoice')
  }

  const items = addOnItems.map((item) => ({
    description: `${item.asset?.name || item.description || 'Ad-hoc item'} (${item.pricingType} rate) - Add-On`,
    quantity: Number(item.quantity) || 1,
    unitPrice: Number(item.rate),
    assetId: item.assetId || undefined,
  }))

  const effectiveTaxRate = taxRate ?? (Number(reservation.taxRate) || 0)

  const invoice = await createInvoice({
    clientId: reservation.clientId,
    reservationId: reservation.id,
    dueDate,
    taxRate: effectiveTaxRate,
    items,
    notes: reservation.projectName
      ? `Project: ${reservation.projectName} (add-on items)`
      : 'Add-on items invoice',
  })

  // Update lastBilledDate so these add-ons won't be re-invoiced
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { lastBilledDate: new Date() },
  })

  revalidatePath(`/dashboard/reservations/${reservationId}`)

  return invoice
}

export async function getInvoiceStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [total, draft, sent, paid, overdue] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: 'DRAFT' } }),
    prisma.invoice.count({ where: { status: 'SENT' } }),
    prisma.invoice.count({ where: { status: 'PAID' } }),
    prisma.invoice.count({ where: { status: 'OVERDUE' } }),
  ])

  // Calculate outstanding amount
  const outstandingInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
    },
    select: {
      total: true,
      amountPaid: true,
    },
  })

  const outstandingAmount = outstandingInvoices.reduce(
    (sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)),
    0
  )

  return {
    total,
    draft,
    sent,
    paid,
    overdue,
    outstandingAmount,
  }
}

export async function getClients() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.client.findMany({
    select: {
      id: true,
      name: true,
      companyName: true,
    },
    orderBy: { name: 'asc' },
  })
}
