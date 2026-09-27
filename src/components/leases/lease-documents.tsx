"use client";

import { RecordDocuments, type RecordDoc } from "@/components/documents/record-documents";

const TYPES = [
  { value: "LEASE_AGREEMENT", label: "Agreement" },
  { value: "STATEMENT", label: "Statement" },
  { value: "PAYOFF_LETTER", label: "Payoff letter" },
  { value: "OTHER", label: "Other" },
] as const;

/** A lease's own paperwork: the agreement, lender statements, the payoff letter. */
export function LeaseDocuments({ leaseId, documents }: { leaseId: string; documents: RecordDoc[] }) {
  return (
    <RecordDocuments
      entityType="LEASE"
      entityId={leaseId}
      types={TYPES}
      documents={documents}
      empty="No documents yet. Upload the agreement first — it’s what the terms on this page come from."
      trashReason="Removed from the lease record"
    />
  );
}
