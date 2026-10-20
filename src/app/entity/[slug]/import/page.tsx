import Link from "next/link";
import { CsvImport } from "@/components/entities/inventory/csv-import";
import { READONLY_NOTICE } from "@/components/entities/inventory/fields";
import { Notice } from "@/components/feedback/notice";
import { PageHeader } from "@/components/shell/page-header";
import { gateEntityPage } from "../../gate";

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug, { write: true });
  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title="Import CSV"
        blurb="Bring in items with their units or stock from a spreadsheet."
        actions={<Link href={`/entity/${slug}/inventory`} className="text-pill text-ink-muted hover:text-ink">Back to Inventory</Link>}
      />
      {ctx.canWrite ? <CsvImport slug={slug} /> : <Notice tone="error">{READONLY_NOTICE}</Notice>}
    </>
  );
}
