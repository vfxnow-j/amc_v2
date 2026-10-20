import Link from "next/link";
import { ReleaseBoard, type BoardRow } from "@/components/entities/inventory/release-board";
import { READONLY_NOTICE } from "@/components/entities/inventory/fields";
import { Notice } from "@/components/feedback/notice";
import { ListSearch } from "@/components/list/list-search";
import { Card } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { BUSINESS_TIME_ZONE } from "@/lib/billing/calendar";
import { locationNames, locationOptions, userNames } from "@/lib/entities/main-lookup";
import { latestReleases, matchesQuery, parseQuery, parseTab } from "@/lib/entities/screens";
import { getDeployed, getUnitsByLocation } from "@/lib/queries/entity-inventory";
import { getReleasesFor } from "@/lib/queries/entity-screens";
import { gateEntityPage } from "../../gate";

const SINCE = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric" });

const TAB = "h-9 flex-none rounded-pill px-3 text-pill leading-9";

export default async function ReleasePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string | string[]; q?: string | string[] }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug, { write: true });
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const q = parseQuery(sp.q);
  const base = `/entity/${slug}/release`;
  const qs = q ? `&q=${encodeURIComponent(q)}` : "";

  let rows: BoardRow[] = [];
  let total = 0;
  const locations = ctx.canWrite ? await locationOptions() : [];

  if (tab === "release") {
    const { units, stock } = await getUnitsByLocation(ctx.db);
    const stored = units.filter((u) => u.status === "IN_STORAGE");
    const held = stock.filter((s) => !s.deployed && s.quantity > 0);
    total = stored.length + held.length;
    const places = await locationNames([...stored.map((u) => u.currentLocationId), ...held.map((s) => s.locationId)].filter((x): x is string => !!x));
    const at = (id: string | null) => (id ? (places.get(id) ?? "Unknown location") : "No location recorded");
    rows = [
      ...stored
        .filter((u) => matchesQuery(q, u.item.name, u.serial, u.ownerTag, u.scanTag))
        .map((u): BoardRow => {
          const label = u.serial || u.ownerTag || u.scanTag || "Unit";
          return {
            key: u.id, itemId: u.itemId, itemName: u.item.name, detail: [u.serial, u.ownerTag, u.scanTag].filter(Boolean).join(" · ") || "Unit", where: at(u.currentLocationId), since: null,
            target: { kind: "unit", type: "RELEASE", unitId: u.id, itemName: u.item.name, label, fromName: u.currentLocationId ? at(u.currentLocationId) : null },
          };
        }),
      ...held
        .filter((s) => matchesQuery(q, s.item.name))
        .map((s): BoardRow => ({
          key: s.id, itemId: s.itemId, itemName: s.item.name, detail: `${s.quantity} counted`, where: at(s.locationId), since: null,
          target: { kind: "stock", type: "RELEASE", itemId: s.itemId, itemName: s.item.name, fromLocationId: s.locationId, fromName: at(s.locationId), available: s.quantity },
        })),
    ];
  } else {
    const { units, stock } = await getDeployed(ctx.db);
    total = units.length + stock.length;
    const releases = await getReleasesFor(ctx.db, units.map((u) => u.id), [...new Set(stock.map((s) => s.itemId))]);
    const last = latestReleases(releases);
    const [places, people] = await Promise.all([
      locationNames([...units.map((u) => u.currentLocationId), ...stock.map((s) => s.locationId)].filter((x): x is string => !!x)),
      userNames([...last.values()].map((n) => n.actorUserId)),
    ]);
    const at = (id: string | null) => (id ? (places.get(id) ?? "Unknown location") : "No location recorded");
    const since = (key: string) => {
      const n = last.get(key);
      if (!n) return null;
      return `${SINCE.format(n.occurredAt)} by ${people.get(n.actorUserId) ?? "unknown user"}${n.recipient ? ` · to ${n.recipient}` : ""}`;
    };
    rows = [
      ...units
        .filter((u) => matchesQuery(q, u.item.name, u.serial, u.ownerTag, u.scanTag))
        .map((u): BoardRow => ({
          key: u.id, itemId: u.itemId, itemName: u.item.name, detail: [u.serial, u.ownerTag, u.scanTag].filter(Boolean).join(" · ") || "Unit", where: at(u.currentLocationId), since: since(`u:${u.id}`),
          target: { kind: "unit", type: "RETURN", unitId: u.id, itemName: u.item.name, label: u.serial || u.ownerTag || u.scanTag || "Unit", fromName: u.currentLocationId ? at(u.currentLocationId) : null },
        })),
      ...stock
        .filter((s) => matchesQuery(q, s.item.name))
        .map((s): BoardRow => ({
          key: s.id, itemId: s.itemId, itemName: s.item.name, detail: `${s.quantity} counted`, where: at(s.locationId), since: since(`s:${s.itemId}:${s.locationId}`),
          target: { kind: "stock", type: "RETURN", itemId: s.itemId, itemName: s.item.name, fromLocationId: s.locationId, fromName: at(s.locationId), available: s.quantity },
        })),
    ];
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.detail.localeCompare(b.detail));

  const empty = q
    ? `Nothing matches “${q}”.`
    : tab === "release"
      ? total === 0 ? "Nothing is in storage. Receive gear first." : "Nothing to show."
      : "Nothing is out on site.";

  return (
    <>
      <PageHeader
        eyebrow={ctx.entity.name}
        title="Release & return"
        blurb={tab === "release" ? "What we hold, ready to go out." : "What is out on site, ready to come back."}
        actions={
          <>
            <ListSearch placeholder="Search item, serial, tag" />
            <Link href={`${base}?tab=release${qs}`} aria-current={tab === "release" ? "page" : undefined} className={`${TAB} ${tab === "release" ? "bg-accent-solid text-accent-on-solid" : "bg-sunken text-ink hover:bg-row-hover"}`}>Release</Link>
            <Link href={`${base}?tab=return${qs}`} aria-current={tab === "return" ? "page" : undefined} className={`${TAB} ${tab === "return" ? "bg-accent-solid text-accent-on-solid" : "bg-sunken text-ink hover:bg-row-hover"}`}>Return</Link>
          </>
        }
      />
      {!ctx.canWrite ? <Notice tone="error">{READONLY_NOTICE}</Notice> : null}
      <Card title={tab === "release" ? "In storage" : "Deployed"} meta={q ? `${rows.length} of ${total}` : `${rows.length}`}>
        <ReleaseBoard
          slug={slug}
          rows={rows}
          locations={locations}
          canWrite={ctx.canWrite}
          whereLabel={tab === "release" ? "Stored at" : "Deployed at"}
          empty={empty}
        />
      </Card>
    </>
  );
}
