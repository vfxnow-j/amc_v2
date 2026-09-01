import { FileText, PenLine } from "lucide-react";
import { Card, CardEmpty } from "@/components/record/record-card";
import { dayYear } from "@/lib/format";
import { getOrderDocuments } from "@/lib/queries/order-documents";
import type { DocumentType, ReservationStatus } from "@/generated/prisma/client";

/**
 * The paperwork, on the order it belongs to.
 *
 * A quote goes out and comes back signed, and until now the order record said
 * nothing about either: `approveQuote` has always called
 * `generateSignedQuoteDocument`, which renders the quote with the client's
 * signature on it and files it against the order — and nothing in v2 read that
 * back. The document existed and could not be opened.
 *
 * `PROPOSAL` is the stored type for a quote, signed or not — `saveDocument`
 * maps QUOTE onto it, because the enum has no QUOTE member. So the label here
 * comes from `isSigned` rather than the type alone: a signed proposal is a
 * signed quote and calling it "Proposal" hides the only document on the order
 * that proves the client agreed to the price.
 */
const TYPE_LABEL: Record<DocumentType, string> = {
  ORDER_DETAIL: "Order detail",
  DELIVERY_NOTE: "Delivery note",
  INVOICE: "Invoice",
  PRO_FORMA: "Pro forma invoice",
  PURCHASE_ORDER: "Purchase order",
  PROPOSAL: "Quote",
  RENTAL_AGREEMENT: "Rental agreement",
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function OrderDocumentsCard({
  id,
  status,
}: {
  id: string;
  status: ReservationStatus;
}) {
  const documents = await getOrderDocuments(id);
  const signed = documents.filter((document) => document.isSigned).length;

  return (
    <Card
      title="Documents"
      meta={
        documents.length === 0
          ? undefined
          : signed > 0
            ? `${documents.length} · ${signed} signed`
            : `${documents.length}`
      }
    >
      {documents.length === 0 ? (
        <CardEmpty>
          {status === "DRAFT"
            ? "Nothing filed yet. Sending the quote and having the client sign it online files the signed copy here."
            : "Nothing filed against this order. A quote signed through the online link is filed here automatically; delivery notes and order details are filed when they are printed."}
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {documents.map((document) => (
            <li key={document.id}>
              <a
                href={`/api/documents/${document.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                {document.isSigned ? (
                  <PenLine
                    className="size-[13px] flex-none translate-y-[2px] text-accent-text"
                    aria-hidden
                  />
                ) : (
                  <FileText
                    className="size-[13px] flex-none translate-y-[2px] text-ink-faint"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">
                    {document.isSigned && document.type === "PROPOSAL"
                      ? "Signed quote"
                      : TYPE_LABEL[document.type]}
                  </span>
                  <span className="block truncate text-ink-faint">
                    {document.isSigned && document.signedBy
                      ? `Signed by ${document.signedBy}${
                          document.signedAt ? ` · ${dayYear(document.signedAt)}` : ""
                        }`
                      : `${dayYear(document.createdAt)} · ${size(document.fileSize)}`}
                  </span>
                </span>
                <span className="flex-none text-ink-faint">Open</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
