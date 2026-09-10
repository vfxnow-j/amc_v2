import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/prisma";

/**
 * The document store behind the requirements portal.
 *
 * A plain module rather than an action file, for the reason `lib/leads/
 * onboarding.ts` already sets out at length: two callers reach this code and
 * only one of them has a session. The portal at `/requirements/[token]` is
 * opened by a person outside the business with no login at all, and the client
 * record's Requirements card is opened by staff.
 *
 * That split matters more here than anywhere else in v2, because of how
 * `"use server"` actually works. Every export of a `"use server"` file that
 * reaches the client graph is given a callable action id — and
 * `lib/actions/agreement.ts` reaches it, through `settings/document-actions.tsx`
 * and `documents/print-dropdown.tsx`. Before this split, `uploadClientDocument`
 * and `signAgreementForClient` sat in that file with **no authorization check of
 * any kind**: an ungated action that writes a file to disk, stamps
 * `idVerifiedAt`/`coiVerifiedAt` on any client id it is handed, and records a
 * signed rental agreement. Wiring the public portal to those exports would have
 * shipped that hole rather than closing it.
 *
 * So the unguarded machinery lives here, importable only by server code, and
 * `lib/actions/agreement.ts` keeps nothing but gated wrappers: `requireEditor`
 * / `requireAdmin` for the staff paths, and a token check for the public ones.
 * Neither gate can be sidestepped by reaching for the other one.
 */

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(path.join(".next", "standalone"))) {
    return path.resolve(cwd, "..", "..");
  }
  return cwd;
}

export const DOCUMENTS_ROOT = path.join(getProjectRoot(), "documents");

/**
 * `Document.filePath` is stored relative to the document root — an absolute
 * path would break the moment the app moved directory, and this instance was
 * restored from another box.
 */
export function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(DOCUMENTS_ROOT)) {
    return absolutePath.substring(DOCUMENTS_ROOT.length + 1);
  }
  const docsIdx = absolutePath.indexOf("/documents/");
  if (docsIdx !== -1) {
    return absolutePath.substring(docsIdx + "/documents/".length);
  }
  return absolutePath;
}

export const TEMPLATE_DIR = path.join(DOCUMENTS_ROOT, "templates");
export const TEMPLATE_FILENAME = "rental-agreement.pdf";
export const TEMPLATE_PATH = path.join(TEMPLATE_DIR, TEMPLATE_FILENAME);
export const TEMPLATE_SETTING_KEY = "rental_agreement_template";

export type TemplateMeta = {
  filename: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
};

/**
 * The template's metadata, or null.
 *
 * Null when the `Setting` row is missing **and** when the row exists but the
 * file behind it does not. This instance is exactly the second case: the
 * refresh from v1 copied `documents/` across without the templates directory,
 * so a row alone would have the app claim a template it cannot open, and
 * `signAgreement` would then throw halfway through a client's signing session
 * rather than the screen saying up front that there is nothing to sign.
 */
export async function readTemplateMeta(): Promise<TemplateMeta | null> {
  const setting = await prisma.setting.findUnique({
    where: { key: TEMPLATE_SETTING_KEY },
  });
  if (!setting) return null;

  try {
    await fs.access(TEMPLATE_PATH);
  } catch {
    return null;
  }

  return setting.value as TemplateMeta;
}

/** The template's path on disk, or null when there isn't one. */
export async function templatePathIfPresent(): Promise<string | null> {
  try {
    await fs.access(TEMPLATE_PATH);
    return TEMPLATE_PATH;
  } catch {
    return null;
  }
}

/** Replace the one rental agreement template. One file, never versioned. */
export async function writeTemplate(
  bytes: Buffer,
  originalFilename: string,
  userId: string,
): Promise<TemplateMeta> {
  await fs.mkdir(TEMPLATE_DIR, { recursive: true });
  await fs.writeFile(TEMPLATE_PATH, bytes);

  const meta: TemplateMeta = {
    filename: originalFilename,
    fileSize: bytes.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: userId,
  };

  await prisma.setting.upsert({
    where: { key: TEMPLATE_SETTING_KEY },
    update: { value: meta },
    create: { key: TEMPLATE_SETTING_KEY, value: meta },
  });

  return meta;
}

export async function removeTemplate(): Promise<void> {
  try {
    await fs.unlink(TEMPLATE_PATH);
  } catch {
    // Already gone. The Setting row is still cleared, because a row pointing at
    // nothing is worse than no row.
  }
  await prisma.setting.deleteMany({ where: { key: TEMPLATE_SETTING_KEY } });
}

// ---------------------------------------------------------------------------
// Client documents
// ---------------------------------------------------------------------------

export type ClientDocType = "ID_FRONT" | "ID_BACK" | "COI";

/**
 * Write one uploaded document against a client and update what it satisfies.
 *
 * Takes bytes, not base64. The public upload arrives as multipart form data on
 * a route handler and is already a Buffer; base64 was only ever there because
 * the caller was a Server Function, which cannot carry one.
 *
 * COI is satisfied by a single file. ID is not: a driving licence has two
 * sides, and stamping `idVerifiedAt` off the front alone would mark an account
 * settled on half a document. So the ID case re-reads what is on file and only
 * stamps once both sides are there — which also makes the two uploads order-
 * independent, and lets someone who lost the tab finish the job later.
 */
export async function storeClientDocument(
  clientId: string,
  docType: ClientDocType,
  bytes: Buffer,
  filename: string,
): Promise<{ documentId: string; satisfied: "ID" | "COI" | null }> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) throw new Error("Client not found");

  const clientDocDir = path.join(DOCUMENTS_ROOT, "clients", clientId);
  await fs.mkdir(clientDocDir, { recursive: true });

  // Only the extension survives from what the browser sent. The stored name is
  // ours — a filename is attacker-controlled text, and this one becomes a path.
  const safeName = filename.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
  const ext = path.extname(safeName).slice(0, 12) || ".pdf";
  const storedFilename = `${docType.toLowerCase()}-${Date.now()}${ext}`;
  const filePath = path.join(clientDocDir, storedFilename);

  // The file lands first and the row second, so the rollback runs in a
  // `finally` rather than after a result has been inspected: if the row throws,
  // the bytes are already on disk and nothing points at them. An orphaned file
  // in a client's document folder is not harmless — it is a customer's ID
  // sitting outside the record that says whose it is.
  let document: { id: string };
  let committed = false;
  await fs.writeFile(filePath, bytes);
  try {
    const systemUser = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    document = await prisma.document.create({
      data: {
        // There is no client-document type in the enum, so the agreement type
        // is reused and the real kind is carried in `metadata.documentCategory`
        // — which is what the ID pairing check below reads back.
        documentType: "RENTAL_AGREEMENT",
        filename: storedFilename,
        filePath: toRelativePath(filePath),
        fileSize: bytes.length,
        entityType: "CLIENT",
        entityId: clientId,
        metadata: { originalFilename: filename, documentCategory: docType },
        createdById: systemUser?.id || "system",
      },
      select: { id: true },
    });
    committed = true;
  } finally {
    if (!committed) await fs.unlink(filePath).catch(() => {});
  }

  if (docType === "COI") {
    await prisma.client.update({
      where: { id: clientId },
      data: { coiVerifiedAt: new Date() },
    });
    return { documentId: document.id, satisfied: "COI" };
  }

  const idDocs = await prisma.document.findMany({
    where: {
      entityType: "CLIENT",
      entityId: clientId,
      deletedAt: null,
      metadata: { path: ["documentCategory"], string_starts_with: "ID_" },
    },
    select: { metadata: true },
  });

  const categories = idDocs.map(
    (doc) => (doc.metadata as { documentCategory?: string } | null)?.documentCategory,
  );
  if (categories.includes("ID_FRONT") && categories.includes("ID_BACK")) {
    await prisma.client.update({
      where: { id: clientId },
      data: { idVerifiedAt: new Date() },
    });
    return { documentId: document.id, satisfied: "ID" };
  }

  return { documentId: document.id, satisfied: null };
}

// ---------------------------------------------------------------------------
// The signed agreement
// ---------------------------------------------------------------------------

/**
 * Put a signature on the rental agreement and file the result.
 *
 * Throws when there is no template, and that refusal is load-bearing: the
 * signature is only meaningful against the document it was shown, so signing
 * "nothing" must fail loudly rather than record an agreement with no paper
 * behind it.
 */
export async function signAgreement(
  clientId: string,
  signerName: string,
  signatureDataUrl: string,
  reservationId?: string,
): Promise<{ documentId: string }> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");

  const templatePath = await templatePathIfPresent();
  if (!templatePath) throw new Error("No rental agreement template configured");

  const clientDocDir = path.join(DOCUMENTS_ROOT, "clients", clientId);
  await fs.mkdir(clientDocDir, { recursive: true });

  const templateBuffer = await fs.readFile(templatePath);
  const signedPdfBytes = await embedSignatureOnPdf(
    templateBuffer,
    signatureDataUrl,
    signerName,
  );

  const signedFilename = `rental-agreement-signed-${Date.now()}.pdf`;
  const signedPath = path.join(clientDocDir, signedFilename);
  await fs.writeFile(signedPath, Buffer.from(signedPdfBytes));

  const fileSize = signedPdfBytes.length;

  const systemUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  // Same rollback rule as an uploaded document, and it matters more here: a
  // signed agreement left on disk with no row is a contract the app cannot
  // find and cannot prove it holds.
  let committed = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const relPath = toRelativePath(signedPath);

      const document = await tx.document.create({
        data: {
          documentType: "RENTAL_AGREEMENT",
          filename: signedFilename,
          filePath: relPath,
          fileSize,
          entityType: "CLIENT",
          entityId: clientId,
          isSigned: true,
          signedBy: signerName,
          signedAt: new Date(),
          metadata: { signatureDataUrl },
          createdById: systemUser?.id || "system",
        },
        select: { id: true },
      });

      // Filed against the order too, so it shows on the record the warehouse
      // and billing actually read rather than only on the account.
      if (reservationId) {
        await tx.document.create({
          data: {
            documentType: "RENTAL_AGREEMENT",
            filename: signedFilename,
            filePath: relPath,
            fileSize,
            entityType: "RESERVATION",
            entityId: reservationId,
            isSigned: true,
            signedBy: signerName,
            signedAt: new Date(),
            metadata: { signatureDataUrl, clientId },
            createdById: systemUser?.id || "system",
          },
        });
      }

      await tx.client.update({
        where: { id: clientId },
        data: {
          agreementSignedAt: new Date(),
          agreementSignerName: signerName,
        },
      });

      return { documentId: document.id };
    });
    committed = true;
    return result;
  } finally {
    if (!committed) await fs.unlink(signedPath).catch(() => {});
  }
}

/**
 * Embeds the customer's signature image, printed name, and date onto the
 * last page of the rental agreement PDF.
 */
async function embedSignatureOnPdf(
  templateBytes: Buffer,
  signatureDataUrl: string,
  signerName: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, "");
  const sigImageBytes = Buffer.from(base64Data, "base64");
  const sigImage = await pdfDoc.embedPng(sigImageBytes);

  const maxSigWidth = 200;
  const maxSigHeight = 60;
  const sigAspect = sigImage.width / sigImage.height;
  let sigW = maxSigWidth;
  let sigH = sigW / sigAspect;
  if (sigH > maxSigHeight) {
    sigH = maxSigHeight;
    sigW = sigH * sigAspect;
  }

  const marginLeft = 50;
  const marginBottom = 60;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const blockX = marginLeft;
  const lineY = marginBottom + 90;

  lastPage.drawText("Customer Signature", {
    x: blockX,
    y: lineY + sigH + 14,
    size: 8,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  lastPage.drawImage(sigImage, {
    x: blockX,
    y: lineY + 4,
    width: sigW,
    height: sigH,
  });

  lastPage.drawLine({
    start: { x: blockX, y: lineY },
    end: { x: blockX + 220, y: lineY },
    thickness: 0.75,
    color: rgb(0.3, 0.3, 0.3),
  });

  lastPage.drawText(signerName, {
    x: blockX,
    y: lineY - 14,
    size: 10,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  const dateBlockX = width - marginLeft - 180;

  lastPage.drawText("Date", {
    x: dateBlockX,
    y: lineY + sigH + 14,
    size: 8,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  lastPage.drawText(dateStr, {
    x: dateBlockX,
    y: lineY + 18,
    size: 11,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  lastPage.drawLine({
    start: { x: dateBlockX, y: lineY },
    end: { x: dateBlockX + 180, y: lineY },
    thickness: 0.75,
    color: rgb(0.3, 0.3, 0.3),
  });

  return pdfDoc.save();
}
