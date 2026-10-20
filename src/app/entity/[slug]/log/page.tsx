import Link from "next/link";
import { toLogRows } from "@/components/entities/inventory/log-rows";
import { MovementLog } from "@/components/entities/inventory/movement-log";
import { FIELD, PILL } from "@/components/entities/inventory/fields";
import { Card } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { locationNames, userNames } from "@/lib/entities/main-lookup";
import { LOG_TYPES, parseLogFilter } from "@/lib/entities/screens";
import { getItems } from "@/lib/queries/entity-inventory";
import { getLog } from "@/lib/queries/entity-screens";
import { gateEntityPage } from "../../gate";

export default async function LogPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ item?: string | string[]; type?: string | string[] }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug);
  const filter = parseLogFilter(await searchParams);
  const [movements, items] = await Promise.all([getLog(ctx.db, filter), getItems(ctx.db)]);

  // Two batched lookups for the whole page, not one per row.
  const [places, people] = await Promise.all([
    locationNames(movements.flatMap((m) => [m.fromLocationId, m.toLocationId]).filter((x): x is string => !!x)),
    userNames(movements.map((m) => m.actorUserId)),
  ]);
  const filtered = !!(filter.itemId || filter.type);
  const knownItem = filter.itemId ? items.find((i) => i.id === filter.itemId) : null;

  return (
    <>
      <PageHeader eyebrow={ctx.entity.name} title="Movement log" blurb="Every receive, move, release and return, newest first. Nothing here is ever edited; a mistake is logged as a correction." />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
        <label className="flex min-w-48 flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Item</span>
          <select name="item" defaultValue={knownItem ? knownItem.id : ""} className={FIELD}>
            <option value="">All items</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-36 flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Type</span>
          <select name="type" defaultValue={filter.type ?? ""} className={FIELD}>
            <option value="">All types</option>
            {LOG_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
        <button type="submit" className={`${PILL} h-9`}>Filter</button>
        {filtered ? <Link href={`/entity/${slug}/log`} className="h-9 text-pill leading-9 text-ink-muted hover:text-ink">Clear</Link> : null}
      </form>
      <Card title="Movements" meta={`latest ${movements.length}`}>
        <MovementLog
          slug={slug}
          rows={toLogRows(movements, places, people)}
          canWrite={ctx.canWrite}
          empty={filtered ? "No movements match that filter." : "No movements yet."}
        />
      </Card>
    </>
  );
}
