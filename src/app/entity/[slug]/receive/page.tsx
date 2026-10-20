import Link from "next/link";
import { Notice } from "@/components/feedback/notice";
import { ReceiveForm } from "@/components/entities/inventory/receive-form";
import { PageHeader } from "@/components/shell/page-header";
import { locationOptions } from "@/lib/entities/main-lookup";
import { getItems } from "@/lib/queries/entity-inventory";
import { gateEntityPage } from "../../gate";

export default async function ReceivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ item?: string | string[] }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug, { write: true });
  const sp = await searchParams;
  const [items, locations] = await Promise.all([getItems(ctx.db), locationOptions()]);
  const initial = Array.isArray(sp.item) ? sp.item[0] : sp.item;

  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title="Receive"
        blurb="Gear arriving into one of our locations."
        actions={<Link href={`/entity/${slug}/inventory/new`} className="h-9 flex-none rounded-pill bg-sunken px-3 text-pill leading-9 text-ink hover:bg-row-hover">New item</Link>}
      />
      {locations.length === 0 ? (
        <Notice tone="error">There are no locations to store gear in yet. Add one under Settings → Locations first.</Notice>
      ) : (
        <ReceiveForm
          slug={slug}
          items={items.map((i) => ({ id: i.id, name: i.name, make: [i.manufacturer, i.model].filter(Boolean).join(" "), trackingMode: i.trackingMode }))}
          locations={locations}
          initialItemId={initial}
        />
      )}
    </>
  );
}
