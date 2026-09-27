import "server-only";
import type { DocumentType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { RecordDoc } from "@/components/documents/record-documents";

/**
 * The files attached to one record, for RecordDocuments: live ones only
 * (trashed ones are in Settings → Documents), newest first, with who uploaded.
 */
export async function getRecordDocuments(
  entityType: string,
  entityId: string,
  types?: DocumentType[],
): Promise<RecordDoc[]> {
  const documents = await prisma.document.findMany({
    where: { entityType, entityId, deletedAt: null, ...(types ? { documentType: { in: types } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, documentType: true, fileSize: true, createdAt: true, createdById: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(documents.map((doc) => doc.createdById))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((user) => [user.id, user.name]));
  return documents.map((doc) => ({
    id: doc.id,
    filename: doc.filename,
    documentType: doc.documentType,
    fileSize: doc.fileSize,
    createdAt: doc.createdAt.toISOString(),
    uploadedBy: nameOf.get(doc.createdById) ?? null,
  }));
}
