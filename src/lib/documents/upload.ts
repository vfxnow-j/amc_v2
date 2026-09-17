import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { DocumentType } from "@/generated/prisma/client";

/**
 * Files people upload — a lease's agreement, statements, payoff letter
 * (owner, 2026-09-17: "each lease has its documents, very key").
 *
 * Everything else in the documents layer is generated here (PDFs of quotes, POs,
 * funding requests); this is the one path for a file that arrives from outside.
 * It goes through a route handler with multipart form data rather than a server
 * action, whose request body is capped at 1 MB — a scanned loan agreement is
 * several.
 *
 * Stored the way generated documents are: under `documents/<entity folder>/
 * <entity id>/`, a `Document` row pointing at it, served by `/api/documents/[id]`
 * behind the session, soft-deleted to the trash and restorable. The stored name
 * is prefixed so two uploads called "statement.pdf" never overwrite each other;
 * the row keeps the name the person uploaded.
 */

/** Entities that accept uploads, and the table that proves the id is real. */
export const UPLOAD_ENTITIES = {
  LEASE: { folder: "leases", exists: (id: string) => prisma.lease.count({ where: { id } }) },
} as const;

export type UploadEntity = keyof typeof UPLOAD_ENTITIES;

export const UPLOAD_TYPES: Record<UploadEntity, { value: DocumentType; label: string }[]> = {
  LEASE: [
    { value: "LEASE_AGREEMENT", label: "Agreement" },
    { value: "STATEMENT", label: "Statement" },
    { value: "PAYOFF_LETTER", label: "Payoff letter" },
    { value: "OTHER", label: "Other" },
  ],
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED = /\.(pdf|png|jpe?g|heic|webp|docx?|xlsx?|csv|txt)$/i;

function projectRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(path.join(".next", "standalone")) ? path.resolve(cwd, "..", "..") : cwd;
}

export function documentsRoot(): string {
  return path.join(projectRoot(), "documents");
}

/** A filename safe on disk, keeping its extension. */
function safeName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return base.slice(-120) || "document";
}

export type UploadProblem = { file: string; message: string };

export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!ALLOWED.test(file.name)) {
    return "Only PDF, images (PNG, JPG, HEIC, WebP), Word, Excel, CSV and text files can be uploaded.";
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "Files are capped at 25 MB.";
  return null;
}

export async function storeUpload(input: {
  entityType: UploadEntity;
  entityId: string;
  documentType: DocumentType;
  filename: string;
  bytes: Buffer;
  userId: string;
}) {
  const entity = UPLOAD_ENTITIES[input.entityType];
  const folder = path.join(documentsRoot(), entity.folder, input.entityId);
  await fs.mkdir(folder, { recursive: true });

  const name = safeName(input.filename);
  const stored = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${name}`;
  const absolute = path.join(folder, stored);
  await fs.writeFile(absolute, input.bytes);

  return prisma.document.create({
    data: {
      documentType: input.documentType,
      filename: name,
      filePath: path.relative(documentsRoot(), absolute),
      fileSize: input.bytes.length,
      entityType: input.entityType,
      entityId: input.entityId,
      createdById: input.userId,
    },
    select: { id: true, filename: true },
  });
}
