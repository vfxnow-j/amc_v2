'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { qbFetch, isConnected } from './qb-client'

export type SyncResult = {
  synced: number
  errors: string[]
}

// Sync a single client to QuickBooks as a Customer
export async function syncCustomerToQB(clientId: string): Promise<{ qbCustomerId: string }> {
  if (!(await isConnected())) throw new Error('QuickBooks not connected')

  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) throw new Error('Client not found')

  if (client.qbCustomerId) {
    // Update existing customer
    // First get current QB customer for SyncToken
    const existing = await qbFetch(`/customer/${client.qbCustomerId}?minorversion=73`)
    const result = await qbFetch('/customer?minorversion=73', {
      method: 'POST',
      body: JSON.stringify({
        Id: client.qbCustomerId,
        SyncToken: existing.Customer.SyncToken,
        DisplayName: client.companyName || client.name,
        GivenName: client.name.split(' ')[0] || client.name,
        FamilyName: client.name.split(' ').slice(1).join(' ') || undefined,
        PrimaryEmailAddr: client.email ? { Address: client.email } : undefined,
        PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
        BillAddr: client.billingAddress ? { Line1: client.billingAddress } : undefined,
      }),
    })

    return { qbCustomerId: result.Customer.Id }
  } else {
    // Create new customer
    const result = await qbFetch('/customer?minorversion=73', {
      method: 'POST',
      body: JSON.stringify({
        DisplayName: client.companyName || client.name,
        GivenName: client.name.split(' ')[0] || client.name,
        FamilyName: client.name.split(' ').slice(1).join(' ') || undefined,
        CompanyName: client.companyName || undefined,
        PrimaryEmailAddr: client.email ? { Address: client.email } : undefined,
        PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
        BillAddr: client.billingAddress ? { Line1: client.billingAddress } : undefined,
      }),
    })

    const qbCustomerId = result.Customer.Id

    await prisma.client.update({
      where: { id: clientId },
      data: { qbCustomerId },
    })

    revalidatePath('/dashboard/clients')
    revalidatePath(`/dashboard/clients/${clientId}`)

    return { qbCustomerId }
  }
}

// Sync a single invoice to QuickBooks
export async function syncInvoiceToQB(invoiceId: string): Promise<{ qbInvoiceId: string }> {
  if (!(await isConnected())) throw new Error('QuickBooks not connected')

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      items: true,
    },
  })
  if (!invoice) throw new Error('Invoice not found')

  // Ensure client is synced to QB first
  let qbCustomerId = invoice.client.qbCustomerId
  if (!qbCustomerId) {
    const syncResult = await syncCustomerToQB(invoice.clientId)
    qbCustomerId = syncResult.qbCustomerId
  }

  // Build line items
  const lines = invoice.items.map((item, index) => ({
    LineNum: index + 1,
    Amount: Number(item.amount),
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: Number(item.quantity),
      UnitPrice: Number(item.unitPrice),
    },
  }))

  if (invoice.qbInvoiceId) {
    // Update existing QB invoice
    const existing = await qbFetch(`/invoice/${invoice.qbInvoiceId}?minorversion=73`)
    const result = await qbFetch('/invoice?minorversion=73', {
      method: 'POST',
      body: JSON.stringify({
        Id: invoice.qbInvoiceId,
        SyncToken: existing.Invoice.SyncToken,
        CustomerRef: { value: qbCustomerId },
        TxnDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        DueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        DocNumber: invoice.invoiceNumber,
        Line: lines,
        CustomerMemo: invoice.notes ? { value: invoice.notes } : undefined,
      }),
    })

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { qbSyncedAt: new Date() },
    })

    return { qbInvoiceId: result.Invoice.Id }
  } else {
    // Create new QB invoice
    const result = await qbFetch('/invoice?minorversion=73', {
      method: 'POST',
      body: JSON.stringify({
        CustomerRef: { value: qbCustomerId },
        TxnDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        DueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        DocNumber: invoice.invoiceNumber,
        Line: lines,
        CustomerMemo: invoice.notes ? { value: invoice.notes } : undefined,
      }),
    })

    const qbInvoiceId = result.Invoice.Id

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { qbInvoiceId, qbSyncedAt: new Date() },
    })

    revalidatePath('/dashboard/invoices')
    revalidatePath(`/dashboard/invoices/${invoiceId}`)

    return { qbInvoiceId }
  }
}

// Sync a single payment to QuickBooks
export async function syncPaymentToQB(paymentId: string): Promise<{ qbPaymentId: string }> {
  if (!(await isConnected())) throw new Error('QuickBooks not connected')

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: {
        include: { client: true },
      },
    },
  })
  if (!payment) throw new Error('Payment not found')

  // Ensure invoice and client are synced first
  let qbCustomerId = payment.invoice.client.qbCustomerId
  if (!qbCustomerId) {
    const syncResult = await syncCustomerToQB(payment.invoice.clientId)
    qbCustomerId = syncResult.qbCustomerId
  }

  let qbInvoiceId = payment.invoice.qbInvoiceId
  if (!qbInvoiceId) {
    const syncResult = await syncInvoiceToQB(payment.invoiceId)
    qbInvoiceId = syncResult.qbInvoiceId
  }

  const result = await qbFetch('/payment?minorversion=73', {
    method: 'POST',
    body: JSON.stringify({
      CustomerRef: { value: qbCustomerId },
      TotalAmt: Number(payment.amount),
      TxnDate: new Date(payment.paymentDate).toISOString().split('T')[0],
      Line: [
        {
          Amount: Number(payment.amount),
          LinkedTxn: [
            {
              TxnId: qbInvoiceId,
              TxnType: 'Invoice',
            },
          ],
        },
      ],
    }),
  })

  const qbPaymentId = result.Payment.Id

  await prisma.payment.update({
    where: { id: paymentId },
    data: { qbPaymentId },
  })

  return { qbPaymentId }
}

// Bulk sync all unsynced clients
export async function syncAllCustomers(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, errors: [] }

  const clients = await prisma.client.findMany({
    where: { qbCustomerId: null },
  })

  for (const client of clients) {
    try {
      await syncCustomerToQB(client.id)
      result.synced++
    } catch (error) {
      result.errors.push(`${client.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return result
}

// Bulk sync all unsynced invoices
export async function syncAllInvoices(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, errors: [] }

  const invoices = await prisma.invoice.findMany({
    where: {
      qbInvoiceId: null,
      status: { in: ['SENT', 'PARTIAL', 'PAID', 'OVERDUE'] },
    },
  })

  for (const invoice of invoices) {
    try {
      await syncInvoiceToQB(invoice.id)
      result.synced++
    } catch (error) {
      result.errors.push(`${invoice.invoiceNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return result
}

// Get sync status summary
export async function getSyncStatus() {
  const [totalClients, syncedClients, totalInvoices, syncedInvoices, totalPayments, syncedPayments] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { qbCustomerId: { not: null } } }),
    prisma.invoice.count({ where: { status: { in: ['SENT', 'PARTIAL', 'PAID', 'OVERDUE'] } } }),
    prisma.invoice.count({ where: { qbInvoiceId: { not: null } } }),
    prisma.payment.count(),
    prisma.payment.count({ where: { qbPaymentId: { not: null } } }),
  ])

  return {
    clients: { total: totalClients, synced: syncedClients },
    invoices: { total: totalInvoices, synced: syncedInvoices },
    payments: { total: totalPayments, synced: syncedPayments },
  }
}
