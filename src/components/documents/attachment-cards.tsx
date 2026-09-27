import { Card } from "@/components/record/record-card";
import { RecordDocuments } from "@/components/documents/record-documents";
import { UPLOAD_TYPES } from "@/lib/documents/upload";
import { getRecordDocuments } from "@/lib/queries/record-documents";

/** A PO's uploads: the vendor quote it was raised from, the invoice, the packing slip. */
export async function POAttachmentsCard({ id }: { id: string }) {
  const types = UPLOAD_TYPES.PURCHASE_ORDER;
  const documents = await getRecordDocuments("PURCHASE_ORDER", id, types.map((t) => t.value));
  return (
    <Card title="Attachments" meta={documents.length ? `${documents.length} on file` : "vendor quote, invoice"}>
      <RecordDocuments
        entityType="PURCHASE_ORDER"
        entityId={id}
        types={types}
        documents={documents}
        empty="Nothing attached yet. Add the vendor quote this PO was raised from."
        trashReason="Removed from the purchase order"
      />
    </Card>
  );
}

/** A unit's coverage paperwork: the plan agreement or certificate, the receipt. */
export async function CoverageDocuments({ unitId }: { unitId: string }) {
  const types = UPLOAD_TYPES.UNIT_COVERAGE;
  const documents = await getRecordDocuments("UNIT_COVERAGE", unitId);
  return (
    <div className="border-t border-hairline pt-2">
      <p className="px-4 pb-1 text-micro uppercase text-ink-muted">Coverage documents</p>
      <RecordDocuments
        entityType="UNIT_COVERAGE"
        entityId={unitId}
        types={types}
        documents={documents}
        empty="No coverage paperwork attached — add the plan agreement or certificate."
        trashReason="Removed from the unit's coverage"
      />
    </div>
  );
}
