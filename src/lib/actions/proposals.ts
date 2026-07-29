'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import fs from 'fs/promises'
import path from 'path'

// Stable project root (same logic as documents.ts)
function getProjectRoot(): string {
  const cwd = process.cwd()
  if (cwd.endsWith(path.join('.next', 'standalone'))) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

const DOCUMENTS_ROOT = path.join(getProjectRoot(), 'documents')

function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(DOCUMENTS_ROOT)) {
    return absolutePath.substring(DOCUMENTS_ROOT.length + 1)
  }
  const docsIdx = absolutePath.indexOf('/documents/')
  if (docsIdx !== -1) {
    return absolutePath.substring(docsIdx + '/documents/'.length)
  }
  return absolutePath
}

/**
 * Save a proposal — creates or updates the PROPOSAL document for a reservation.
 * Stores both the PDF file and the proposal JSON state (for re-editing).
 */
export async function saveProposal(
  reservationId: string,
  pdfBase64: string | null,
  filename: string,
  proposalData?: unknown
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const folder = path.join(DOCUMENTS_ROOT, 'reservations', reservationId)
  await fs.mkdir(folder, { recursive: true })

  let fileSize = 0
  const filePath = path.join(folder, filename)

  // Write PDF to disk if provided
  if (pdfBase64) {
    const buffer = Buffer.from(pdfBase64, 'base64')
    await fs.writeFile(filePath, buffer)
    fileSize = buffer.length
  }

  // Check for existing proposal document on this reservation
  const existing = await prisma.document.findFirst({
    where: {
      documentType: 'PROPOSAL',
      entityType: 'RESERVATION',
      entityId: reservationId,
    },
    orderBy: { createdAt: 'desc' },
  })

  let document
  if (existing) {
    // Update existing document
    const updateData: Record<string, unknown> = {
      metadata: proposalData ? (proposalData as object) : existing.metadata,
    }
    if (pdfBase64) {
      updateData.filename = filename
      updateData.filePath = toRelativePath(filePath)
      updateData.fileSize = fileSize
    }
    document = await prisma.document.update({
      where: { id: existing.id },
      data: updateData,
    })
  } else {
    // Create new document
    document = await prisma.document.create({
      data: {
        documentType: 'PROPOSAL',
        filename,
        filePath: toRelativePath(filePath),
        fileSize,
        entityType: 'RESERVATION',
        entityId: reservationId,
        metadata: proposalData ? (proposalData as object) : undefined,
        createdById: authResult.userId!,
      },
    })
  }

  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return serialize(document)
}

/**
 * Save only the proposal draft state (no PDF generation required).
 */
export async function saveProposalDraft(
  reservationId: string,
  proposalData: unknown
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const existing = await prisma.document.findFirst({
    where: {
      documentType: 'PROPOSAL',
      entityType: 'RESERVATION',
      entityId: reservationId,
    },
    orderBy: { createdAt: 'desc' },
  })

  let document
  if (existing) {
    document = await prisma.document.update({
      where: { id: existing.id },
      data: { metadata: proposalData as object },
    })
  } else {
    // Create a draft document (no PDF yet)
    const folder = path.join(DOCUMENTS_ROOT, 'reservations', reservationId)
    await fs.mkdir(folder, { recursive: true })

    document = await prisma.document.create({
      data: {
        documentType: 'PROPOSAL',
        filename: 'proposal-draft.pdf',
        filePath: toRelativePath(path.join(folder, 'proposal-draft.pdf')),
        fileSize: 0,
        entityType: 'RESERVATION',
        entityId: reservationId,
        metadata: proposalData as object,
        createdById: authResult.userId!,
      },
    })
  }

  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return serialize(document)
}

/**
 * Load the most recent proposal draft data for a reservation.
 */
export async function loadProposalDraft(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const document = await prisma.document.findFirst({
    where: {
      documentType: 'PROPOSAL',
      entityType: 'RESERVATION',
      entityId: reservationId,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!document || !document.metadata) return null

  return {
    id: document.id,
    metadata: document.metadata,
    updatedAt: document.updatedAt?.toISOString?.() || document.createdAt.toISOString(),
    hasPdf: document.fileSize > 0,
  }
}

export async function sendProposalEmail(
  reservationId: string,
  pdfBase64: string,
  filename: string,
  recipientEmail: string,
  message?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { client: true },
  })

  if (!reservation) throw new Error('Reservation not found')

  const { sendEmail } = await import('@/lib/email')

  const projectName = reservation.projectName || reservation.reservationNumber
  const clientName = reservation.client?.name || 'Valued Client'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e293b;">Project Proposal</h2>
      <p>Dear ${clientName},</p>
      ${message ? `<p>${message.replace(/\n/g, '<br/>')}</p>` : '<p>Please find attached our proposal for your review.</p>'}
      <p>Project: <strong>${projectName}</strong></p>
      <p>Please review the attached proposal at your convenience. We look forward to working with you.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 12px;">This proposal was generated from reservation ${reservation.reservationNumber}.</p>
    </div>
  `

  const buffer = Buffer.from(pdfBase64, 'base64')

  const result = await sendEmail({
    to: recipientEmail,
    subject: `Proposal: ${projectName}`,
    html,
    attachments: [{
      filename,
      content: buffer,
      contentType: 'application/pdf',
    }],
  })

  if (!result.success) {
    throw new Error(result.error || 'Failed to send email')
  }

  return { success: true }
}
