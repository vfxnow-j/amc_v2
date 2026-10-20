'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'

/**
 * Taking draft invoices out of the books.
 *
 * Only a DRAFT can go: nothing has been sent, so no client holds it. It also
 * must have no payment recorded against it and never have reached QuickBooks —
 * an invoice that did is void-only, because deleting it here would leave the
 * books and the app disagreeing. The refusal names the invoice, so a
 * multi-select that includes one such draft says which and removes none.
 *
 * Billing is unaffected by deleting a draft: the run decides what to raise from
 * the order's own billing dates, and a first-cycle check that ignores void
 * invoices, never from the invoice list.
 */

export type DraftInvoiceRow = {
  id: string
  invoiceNumber: string
  client: string
  orderNumber: string | null
  total: number
  createdAt: string
}

export type DeleteDraftsOutcome =
  | { status: 'ok'; deleted: number; total: number }
  | { status: 'error'; message: string }

/** Every draft, newest first — what the clean-up dialog lists. */
export async function listDraftInvoices(): Promise<DraftInvoiceRow[]> {
  const auth = await requireAdmin()
  if (!auth.authorized) return []
  const rows = await prisma.invoice.findMany({
    where: { status: 'DRAFT' },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      createdAt: true,
      client: { select: { name: true, companyName: true } },
      reservation: { select: { reservationNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    client: row.client.companyName || row.client.name,
    orderNumber: row.reservation?.reservationNumber ?? null,
    total: Number(row.total),
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function deleteDraftInvoices(ids: string[]): Promise<DeleteDraftsOutcome> {
  const auth = await requireAdmin()
  if (!auth.authorized) return { status: 'error', message: auth.error ?? 'Admin access required' }

  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return { status: 'error', message: 'Choose at least one draft to delete.' }
  if (unique.length > 200) return { status: 'error', message: 'Delete at most 200 drafts at a time.' }

  const rows = await prisma.invoice.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      qbInvoiceId: true,
      reservationId: true,
      clientId: true,
      _count: { select: { payments: true } },
    },
  })
  if (rows.length !== unique.length) {
    return { status: 'error', message: 'One of those invoices no longer exists. Reload and choose again.' }
  }
  for (const row of rows) {
    if (row.status !== 'DRAFT') {
      return { status: 'error', message: `${row.invoiceNumber} is ${row.status.toLowerCase()}, not a draft, so it can only be voided. Nothing was deleted.` }
    }
    if (row._count.payments > 0) {
      return { status: 'error', message: `${row.invoiceNumber} has a payment recorded against it. Nothing was deleted.` }
    }
    if (row.qbInvoiceId) {
      return { status: 'error', message: `${row.invoiceNumber} is already in QuickBooks, so it has to be voided there. Nothing was deleted.` }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction: a payment or a send landing between
      // the read above and here must stop the delete, not be deleted under.
      const stillDraft = await tx.invoice.count({ where: { id: { in: unique }, status: 'DRAFT', qbInvoiceId: null, payments: { none: {} } } })
      if (stillDraft !== unique.length) throw new Error('An invoice changed while you were deleting. Reload and try again.')
      await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: unique } } })
      await tx.invoice.deleteMany({ where: { id: { in: unique } } })
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'The drafts could not be deleted. Nothing was changed.' }
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total), 0)
  for (const row of rows) {
    await logAudit({
      action: 'DELETE',
      entityType: 'Invoice',
      entityId: row.id,
      oldValues: { invoiceNumber: row.invoiceNumber, status: 'DRAFT', total: Number(row.total), reservationId: row.reservationId, clientId: row.clientId },
    })
  }

  revalidatePath('/dashboard/invoices')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/forecast')
  return { status: 'ok', deleted: rows.length, total }
}
