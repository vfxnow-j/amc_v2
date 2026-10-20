import Link from "next/link";
import { Card } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { locationNames } from "@/lib/entities/main-lookup";
import { groupDeployed, groupStored, type Group } from "@/lib/entities/screens";
import { getUnitsByLocation } from "@/lib/queries/entity-inventory";
import { gateEntityPage } from "../../gate";

function Groups({ slug, groups, empty }: { slug: string; groups: Group[]; empty: string }) {
  if (groups.length === 0) return <p className="px-4 pb-4 text-body text-ink-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      {groups.map((g) => (
        <section key={g.locationId || "none"} aria-label={g.name}>
          <h3 className="text-body font-bold">{g.name} <span className="font-normal text-ink-muted">· {g.entries.length} line{g.entries.length === 1 ? "" : "s"}</span></h3>
          <ul className="mt-1 divide-y divide-hairline">
            {g.entries.map((e) => (
              <li key={e.key} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-body">
                <Link href={`/entity/${slug}/inventory/${e.itemId}`} className="font-bold hover:underline">{e.itemName}</Link>
                <span className="tabular-nums text-ink-muted">{e.quantity !== null ? `${e.quantity} counted` : e.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default async function LocationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug);
  const { units, stock } = await getUnitsByLocation(ctx.db);
  const names = await locationNames([...units.map((u) => u.currentLocationId), ...stock.map((s) => s.locationId)].filter((x): x is string => !!x));
  const placedUnits = units.map((u) => ({ id: u.id, itemId: u.itemId, itemName: u.item.name, serial: u.serial, ownerTag: u.ownerTag, scanTag: u.scanTag, status: u.status, currentLocationId: u.currentLocationId }));
  const placedStock = stock.map((s) => ({ id: s.id, itemId: s.itemId, itemName: s.item.name, locationId: s.locationId, deployed: s.deployed, quantity: s.quantity }));
  const stored = groupStored(placedUnits, placedStock, names);
  const deployed = groupDeployed(placedUnits, placedStock, names);

  return (
    <>
      <PageHeader eyebrow={ctx.entity.name} title="Locations" blurb="Where everything is right now." />
      <Card title="In storage" meta={`${stored.length} location${stored.length === 1 ? "" : "s"}`}>
        <Groups slug={slug} groups={stored} empty="Nothing is in storage." />
      </Card>
      <Card title="Deployed at" meta={`${deployed.length} site${deployed.length === 1 ? "" : "s"}`}>
        <Groups slug={slug} groups={deployed} empty="Nothing is deployed." />
      </Card>
    </>
  );
}
