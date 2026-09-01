import type { DocumentType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The paperwork on an order.
 *
 * `lib/actions/documents.getDocuments` exists but is a server action with a
 * side effect — it regenerates purchase-order PDFs on read — and it returns
 * every column. A record card wants a read, so this is one.
 *
 * Signed documents sort first regardless of age. A signed quote is the one
 * document on an order that answers a question nothing else can — that the
 * client agreed, in writing, to these numbers — and burying it under three
 * delivery notes because they are newer gets that exactly backwards.
 */

export type OrderDocument = {
  id: string;
  type: DocumentType;
  filename: string;
  fileSize: number;
  isSigned: boolean;
  signedBy: string | null;
  signedAt: Date | null;
  createdAt: Date;
};

export async function getOrderDocuments(id: string): Promise<OrderDocument[]> {
  const documents = await prisma.document.findMany({
    where: { entityType: "RESERVATION", entityId: id, deletedAt: null },
    orderBy: [{ isSigned: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      documentType: true,
      filename: true,
      fileSize: true,
      isSigned: true,
      signedBy: true,
      signedAt: true,
      createdAt: true,
    },
  });

  return documents.map((document) => ({
    id: document.id,
    type: document.documentType,
    filename: document.filename,
    fileSize: document.fileSize,
    isSigned: document.isSigned,
    signedBy: document.signedBy,
    signedAt: document.signedAt,
    createdAt: document.createdAt,
  }));
}
