import Link from "next/link";
import { ListSearch } from "@/components/list/list-search";
import { ListTable, type Column, type Row } from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { parseQuery } from "@/lib/entities/screens";
import { getItems } from "@/lib/queries/entity-inventory";
import { gateEntityPage } from "../../gate";

const COLUMNS: Column[] = [
  { key: "name", label: "Item", width: "minmax(0,2fr)" },
  { key: "make", label: "Make / model", width: "minmax(0,1.5fr)" },
  { key: "category", label: "Category", width: "minmax(0,1fr)" },
  { key: "mode", label: "Tracking", width: "96px" },
  { key: "stored", label: "In storage", width: "88px", align: "right" },
  { key: "deployed", label: "Deployed", width: "88px", align: "right" },
];

const BUTTON = "h-9 flex-none rounded-pill bg-sunken px-3 text-pill leading-9 text-ink hover:bg-row-hover";

export default async function InventoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug);
  const q = parseQuery((await searchParams).q);
  const items = await getItems(ctx.db, q);
  const base = `/entity/${slug}/inventory`;

  const rows: Row[] = items.map((i) => ({
    id: i.id,
    href: `${base}/${i.id}`,
    cells: {
      name: i.name,
      make: [i.manufacturer, i.model].filter(Boolean).join(" ") || "—",
      category: i.category ?? "—",
      mode: i.trackingMode === "SERIALIZED" ? "By unit" : "By quantity",
      stored: i.inStorage,
      deployed: i.deployed,
    },
  }));

  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title="Inventory"
        blurb={q ? `${items.length} matching “${q}”` : `${items.length} item${items.length === 1 ? "" : "s"} on record`}
        actions={
          <>
            <ListSearch placeholder="Search name, make, model" />
            {ctx.canWrite ? (
              <>
                <Link href={`/entity/${slug}/import`} className={BUTTON}>Import CSV</Link>
                <Link href={`${base}/new`} className="h-9 flex-none rounded-pill bg-accent-solid px-4 text-pill leading-9 text-accent-on-solid">New item</Link>
              </>
            ) : null}
          </>
        }
      />
      <ListTable
        columns={COLUMNS}
        rows={rows}
        total={rows.length}
        empty={
          q
            ? `Nothing matches “${q}”.`
            : ctx.canWrite
              ? "No items yet. Use New item to add one, or Import CSV to add a list."
              : "No items yet. Someone with write access will add them."
        }
      />
    </>
  );
}
