import Link from "next/link";
import { Notice } from "@/components/feedback/notice";
import { ItemForm } from "@/components/entities/inventory/item-form";
import { READONLY_NOTICE } from "@/components/entities/inventory/fields";
import { PageHeader } from "@/components/shell/page-header";
import { gateEntityPage } from "../../../gate";

export default async function NewItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug);
  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title="New item"
        blurb="What it is and how it is counted. Units or stock come in through Receive."
        actions={<Link href={`/entity/${slug}/inventory`} className="text-pill text-ink-muted hover:text-ink">Back to Inventory</Link>}
      />
      {ctx.canWrite ? <ItemForm slug={slug} /> : <Notice tone="error">{READONLY_NOTICE}</Notice>}
    </>
  );
}
