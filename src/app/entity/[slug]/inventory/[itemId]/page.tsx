import Link from "next/link";
import { notFound } from "next/navigation";
import { EditItem } from "@/components/entities/inventory/edit-item";
import { toLogRows } from "@/components/entities/inventory/log-rows";
import { MovementLog } from "@/components/entities/inventory/movement-log";
import { StockTable } from "@/components/entities/inventory/stock-table";
import { UnitTable } from "@/components/entities/inventory/unit-table";
import { Card } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { locationNames, locationOptions, userNames } from "@/lib/entities/main-lookup";
import { getItem, getMovements } from "@/lib/queries/entity-inventory";
import { gateEntityPage } from "../../../gate";

export default async function ItemPage({ params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await params;
  const ctx = await gateEntityPage(slug);
  const item = await getItem(ctx.db, itemId);
  if (!item) notFound();
  const movements = await getMovements(ctx.db, { itemId });

  const ids = [
    ...item.units.map((u) => u.currentLocationId),
    ...item.stock.map((s) => s.locationId),
    ...movements.flatMap((m) => [m.fromLocationId, m.toLocationId]),
  ].filter((x): x is string => !!x);
  const [places, people, locations] = await Promise.all([
    locationNames(ids),
    userNames(movements.map((m) => m.actorUserId)),
    ctx.canWrite ? locationOptions() : Promise.resolve([]),
  ]);
  const place = (id: string | null) => (id ? (places.get(id) ?? "Unknown location") : null);
  const serialized = item.trackingMode === "SERIALIZED";
  const trackingLabel = serialized ? "by unit" : "by quantity";

  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title={item.name}
        blurb={[[item.manufacturer, item.model].filter(Boolean).join(" "), item.category?.name, `Tracked ${trackingLabel}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href={`/entity/${slug}/inventory`} className="text-pill text-ink-muted hover:text-ink">Back to Inventory</Link>
            {ctx.canWrite ? (
              <EditItem
                slug={slug}
                itemId={item.id}
                trackingLabel={trackingLabel}
                initial={{
                  name: item.name, manufacturer: item.manufacturer ?? "", model: item.model ?? "", category: item.category?.name ?? "",
                  description: item.description ?? "", notes: item.notes ?? "",
                }}
              />
            ) : null}
          </>
        }
      />

      {item.description || item.notes ? (
        <Card title="Details">
          <dl className="grid gap-3 px-4 pb-4 text-body sm:grid-cols-2">
            {item.description ? <div><dt className="text-micro uppercase text-ink-muted">Description</dt><dd className="whitespace-pre-wrap">{item.description}</dd></div> : null}
            {item.notes ? <div><dt className="text-micro uppercase text-ink-muted">Notes</dt><dd className="whitespace-pre-wrap">{item.notes}</dd></div> : null}
          </dl>
        </Card>
      ) : null}

      {serialized ? (
        <Card title="Units" meta={`${item.units.length}`}>
          <UnitTable
            slug={slug}
            itemName={item.name}
            canWrite={ctx.canWrite}
            locations={locations}
            units={item.units.map((u) => ({
              id: u.id, serial: u.serial, ownerTag: u.ownerTag, scanTag: u.scanTag, status: u.status, locationName: place(u.currentLocationId),
            }))}
          />
        </Card>
      ) : (
        <Card title="Stock">
          <StockTable
            slug={slug}
            itemId={item.id}
            itemName={item.name}
            canWrite={ctx.canWrite}
            locations={locations}
            stock={item.stock
              .map((s) => ({ id: s.id, locationId: s.locationId, locationName: place(s.locationId) ?? "Unknown location", deployed: s.deployed, quantity: s.quantity }))
              .sort((a, b) => Number(a.deployed) - Number(b.deployed) || a.locationName.localeCompare(b.locationName))}
          />
        </Card>
      )}

      <Card title="History" meta={`latest ${movements.length}`}>
        <MovementLog slug={slug} rows={toLogRows(movements, places, people)} canWrite={ctx.canWrite} />
      </Card>
    </>
  );
}
