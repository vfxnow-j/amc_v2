'use server'

import { prisma } from '@/lib/prisma'
import { requireAdmin, requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { sendEmail } from '@/lib/email/send'
import { clientRequirementsRequestEmail } from '@/lib/email/templates'
import { APP_URL } from '@/lib/email/client'

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
const TEMPLATE_DIR = path.join(DOCUMENTS_ROOT, 'templates')
const TEMPLATE_FILENAME = 'rental-agreement.pdf'
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME)
const SETTING_KEY = 'rental_agreement_template'

// ============================================
// AGREEMENT TEMPLATE MANAGEMENT
// ============================================

export async function uploadAgreementTemplate(fileBase64: string, originalFilename: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await fs.mkdir(TEMPLATE_DIR, { recursive: true })

  const buffer = Buffer.from(fileBase64, 'base64')
  await fs.writeFile(TEMPLATE_PATH, buffer)

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: {
      value: {
        filename: originalFilename,
        fileSize: buffer.length,
        uploadedAt: new Date().toISOString(),
        uploadedBy: authResult.userId,
      },
    },
    create: {
      key: SETTING_KEY,
      value: {
        filename: originalFilename,
        fileSize: buffer.length,
        uploadedAt: new Date().toISOString(),
        uploadedBy: authResult.userId,
      },
    },
  })

  return { success: true }
}

export async function getAgreementTemplate() {
  const setting = await prisma.setting.findUnique({
    where: { key: SETTING_KEY },
  })

  if (!setting) return null

  const meta = setting.value as {
    filename: string
    fileSize: number
    uploadedAt: string
    uploadedBy: string
  }

  // Verify file still exists
  try {
    await fs.access(TEMPLATE_PATH)
  } catch {
    return null
  }

  return meta
}

export async function deleteAgreementTemplate() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  try {
    await fs.unlink(TEMPLATE_PATH)
  } catch {
    // File may already be deleted
  }

  await prisma.setting.deleteMany({
    where: { key: SETTING_KEY },
  })

  return { success: true }
}

export async function getAgreementTemplatePath(): Promise<string | null> {
  try {
    await fs.access(TEMPLATE_PATH)
    return TEMPLATE_PATH
  } catch {
    return null
  }
}

// ============================================
// CLIENT AGREEMENT SIGNING (Public / No Auth)
// ============================================

export async function signAgreementForClient(
  clientId: string,
  signerName: string,
  signatureDataUrl: string,
  reservationId?: string
) {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) throw new Error('Client not found')

  // Check template exists
  const templatePath = await getAgreementTemplatePath()
  if (!templatePath) throw new Error('No rental agreement template configured')

  // Save signed copy to client documents folder
  const clientDocDir = path.join(DOCUMENTS_ROOT, 'clients', clientId)
  await fs.mkdir(clientDocDir, { recursive: true })

  // Load the template and embed the signature onto the last page
  const templateBuffer = await fs.readFile(templatePath)
  const signedPdfBytes = await embedSignatureOnPdf(templateBuffer, signatureDataUrl, signerName)

  const signedFilename = `rental-agreement-signed-${Date.now()}.pdf`
  const signedPath = path.join(clientDocDir, signedFilename)
  await fs.writeFile(signedPath, Buffer.from(signedPdfBytes))

  const fileSize = signedPdfBytes.length

  // Find a system user for document attribution
  const systemUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  })

  await prisma.$transaction(async (tx) => {
    const relPath = toRelativePath(signedPath)

    // Create document record linked to the client
    await tx.document.create({
      data: {
        documentType: 'RENTAL_AGREEMENT',
        filename: signedFilename,
        filePath: relPath,
        fileSize,
        entityType: 'CLIENT',
        entityId: clientId,
        isSigned: true,
        signedBy: signerName,
        signedAt: new Date(),
        metadata: { signatureDataUrl },
        createdById: systemUser?.id || 'system',
      },
    })

    // Also link the agreement to the reservation so it shows on the order
    if (reservationId) {
      await tx.document.create({
        data: {
          documentType: 'RENTAL_AGREEMENT',
          filename: signedFilename,
          filePath: relPath,
          fileSize,
          entityType: 'RESERVATION',
          entityId: reservationId,
          isSigned: true,
          signedBy: signerName,
          signedAt: new Date(),
          metadata: { signatureDataUrl, clientId },
          createdById: systemUser?.id || 'system',
        },
      })
    }

    // Update client verification
    await tx.client.update({
      where: { id: clientId },
      data: {
        agreementSignedAt: new Date(),
        agreementSignerName: signerName,
      },
    })
  })

  return { success: true }
}

/**
 * Embeds the customer's signature image, printed name, and date onto the
 * last page of the rental agreement PDF.
 */
async function embedSignatureOnPdf(
  templateBytes: Buffer,
  signatureDataUrl: string,
  signerName: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes)
  const pages = pdfDoc.getPages()
  const lastPage = pages[pages.length - 1]
  const { width, height } = lastPage.getSize()

  // Decode the signature PNG from the data URL
  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '')
  const sigImageBytes = Buffer.from(base64Data, 'base64')
  const sigImage = await pdfDoc.embedPng(sigImageBytes)

  // Scale signature to fit nicely (max 200px wide, preserve aspect ratio)
  const maxSigWidth = 200
  const maxSigHeight = 60
  const sigAspect = sigImage.width / sigImage.height
  let sigW = maxSigWidth
  let sigH = sigW / sigAspect
  if (sigH > maxSigHeight) {
    sigH = maxSigHeight
    sigW = sigH * sigAspect
  }

  // Position: bottom-left area of the last page, above the footer margin
  const marginLeft = 50
  const marginBottom = 60

  // Draw a signature block: line, signature image, name, and date
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const blockX = marginLeft
  const lineY = marginBottom + 90

  // "Signature" label
  lastPage.drawText('Customer Signature', {
    x: blockX,
    y: lineY + sigH + 14,
    size: 8,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  })

  // Signature image
  lastPage.drawImage(sigImage, {
    x: blockX,
    y: lineY + 4,
    width: sigW,
    height: sigH,
  })

  // Signature line
  lastPage.drawLine({
    start: { x: blockX, y: lineY },
    end: { x: blockX + 220, y: lineY },
    thickness: 0.75,
    color: rgb(0.3, 0.3, 0.3),
  })

  // Printed name
  lastPage.drawText(signerName, {
    x: blockX,
    y: lineY - 14,
    size: 10,
    font,
    color: rgb(0.1, 0.1, 0.1),
  })

  // Date on the right side
  const dateBlockX = width - marginLeft - 180

  lastPage.drawText('Date', {
    x: dateBlockX,
    y: lineY + sigH + 14,
    size: 8,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  })

  lastPage.drawText(dateStr, {
    x: dateBlockX,
    y: lineY + 18,
    size: 11,
    font,
    color: rgb(0.1, 0.1, 0.1),
  })

  lastPage.drawLine({
    start: { x: dateBlockX, y: lineY },
    end: { x: dateBlockX + 180, y: lineY },
    thickness: 0.75,
    color: rgb(0.3, 0.3, 0.3),
  })

  return pdfDoc.save()
}

// ============================================
// CLIENT DOCUMENT UPLOADS (Public / No Auth)
// ============================================

export async function uploadClientDocument(
  clientId: string,
  docType: 'ID_FRONT' | 'ID_BACK' | 'COI',
  fileBase64: string,
  filename: string
) {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) throw new Error('Client not found')

  const clientDocDir = path.join(DOCUMENTS_ROOT, 'clients', clientId)
  await fs.mkdir(clientDocDir, { recursive: true })

  // Sanitize filename
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_')
  const ext = path.extname(safeName) || '.pdf'
  const storedFilename = `${docType.toLowerCase()}-${Date.now()}${ext}`
  const filePath = path.join(clientDocDir, storedFilename)

  const buffer = Buffer.from(fileBase64, 'base64')
  await fs.writeFile(filePath, buffer)

  // Find system user for attribution
  const systemUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  })

  // Create document record
  await prisma.document.create({
    data: {
      documentType: 'RENTAL_AGREEMENT', // reuse type for client docs
      filename: storedFilename,
      filePath: toRelativePath(filePath),
      fileSize: buffer.length,
      entityType: 'CLIENT',
      entityId: clientId,
      metadata: { originalFilename: filename, documentCategory: docType },
      createdById: systemUser?.id || 'system',
    },
  })

  // Update client verification dates
  if (docType === 'COI') {
    await prisma.client.update({
      where: { id: clientId },
      data: { coiVerifiedAt: new Date() },
    })
  } else {
    // For ID, check if both front and back now exist
    const idDocs = await prisma.document.findMany({
      where: {
        entityType: 'CLIENT',
        entityId: clientId,
        metadata: { path: ['documentCategory'], string_starts_with: 'ID_' },
      },
    })

    const categories = idDocs.map((d) => (d.metadata as any)?.documentCategory)
    const hasFront = categories.includes('ID_FRONT')
    const hasBack = categories.includes('ID_BACK')

    if (hasFront && hasBack) {
      await prisma.client.update({
        where: { id: clientId },
        data: { idVerifiedAt: new Date() },
      })
    }
  }

  return { success: true }
}

// ============================================
// CLIENT VERIFICATION STATUS
// ============================================

export async function getClientVerificationStatus(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      agreementSignedAt: true,
      agreementSignerName: true,
      idVerifiedAt: true,
      coiVerifiedAt: true,
      skipIdRequirement: true,
      skipCoiRequirement: true,
    },
  })

  if (!client) throw new Error('Client not found')

  const template = await getAgreementTemplate()

  return serialize({
    hasTemplate: !!template,
    agreementSigned: !!client.agreementSignedAt,
    agreementSignedAt: client.agreementSignedAt,
    agreementSignerName: client.agreementSignerName,
    idVerified: !!client.idVerifiedAt,
    idVerifiedAt: client.idVerifiedAt,
    coiVerified: !!client.coiVerifiedAt,
    coiVerifiedAt: client.coiVerifiedAt,
    skipIdRequirement: client.skipIdRequirement,
    skipCoiRequirement: client.skipCoiRequirement,
  })
}

// ============================================
// CLIENT REQUIREMENTS TOKEN (Send Request)
// ============================================

export async function sendRequirementsRequest(
  clientId: string,
  requirementTypes: ('ID' | 'COI' | 'AGREEMENT')[],
  recipientEmail?: string,
  message?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (requirementTypes.length === 0) throw new Error('At least one requirement type is required')

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, email: true },
  })
  if (!client) throw new Error('Client not found')

  const email = recipientEmail || client.email
  if (!email) throw new Error('No email address provided or on file for this client')

  const token = randomUUID()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await prisma.clientRequirementToken.create({
    data: {
      token,
      clientId,
      requirementTypes,
      expiresAt,
    },
  })

  const uploadUrl = `${APP_URL}/requirements/${token}`

  const emailContent = clientRequirementsRequestEmail({
    clientName: client.name,
    requirementTypes,
    uploadUrl,
    message,
  })

  await sendEmail({
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  return { success: true, token, url: uploadUrl }
}

export async function getRequirementsByToken(token: string) {
  const record = await prisma.clientRequirementToken.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          idVerifiedAt: true,
          coiVerifiedAt: true,
          agreementSignedAt: true,
        },
      },
    },
  })

  if (!record) return { error: 'Invalid or expired link' }

  if (record.expiresAt < new Date()) {
    return { error: 'This link has expired. Please contact us for a new one.' }
  }

  // Check if agreement template exists (needed for signing section)
  const hasTemplate = !!(await getAgreementTemplate())

  return serialize({
    clientId: record.client.id,
    clientName: record.client.name,
    companyName: record.client.companyName,
    requirementTypes: record.requirementTypes,
    idVerified: !!record.client.idVerifiedAt,
    coiVerified: !!record.client.coiVerifiedAt,
    agreementSigned: !!record.client.agreementSignedAt,
    hasTemplate,
    usedAt: record.usedAt,
  })
}

export async function submitRequirementDocuments(
  token: string,
  documents: Array<{ type: 'ID_FRONT' | 'ID_BACK' | 'COI'; fileBase64: string; filename: string }>
) {
  const record = await prisma.clientRequirementToken.findUnique({
    where: { token },
    select: { id: true, clientId: true, expiresAt: true, requirementTypes: true },
  })

  if (!record) throw new Error('Invalid link')
  if (record.expiresAt < new Date()) throw new Error('This link has expired')

  for (const doc of documents) {
    await uploadClientDocument(record.clientId, doc.type, doc.fileBase64, doc.filename)
  }

  // Mark token as used
  await prisma.clientRequirementToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  })

  return { success: true }
}

/**
 * Sign the rental agreement via a requirements token (public, no auth).
 * Validates the token, then delegates to `signAgreementForClient`.
 */
export async function signAgreementViaToken(
  token: string,
  signerName: string,
  signatureDataUrl: string
) {
  const record = await prisma.clientRequirementToken.findUnique({
    where: { token },
    select: { id: true, clientId: true, expiresAt: true, requirementTypes: true },
  })

  if (!record) throw new Error('Invalid link')
  if (record.expiresAt < new Date()) throw new Error('This link has expired')
  if (!record.requirementTypes.includes('AGREEMENT')) {
    throw new Error('Agreement signing was not requested for this link')
  }

  await signAgreementForClient(record.clientId, signerName, signatureDataUrl)

  // Mark token as used
  await prisma.clientRequirementToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  })

  return { success: true }
}
