import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { BUSINESS_TIME_ZONE } from "@/lib/billing/calendar";
import { movementLabel } from "@/lib/entities/nav";
import { locationNames, userNames } from "@/lib/entities/main-lookup";
import { getDashboard } from "@/lib/queries/entity-inventory";
import { gateEntityPage } from "../gate";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "2-digit",
  hour: "numeric",
  minute: "2-digit",
});

export default async function EntityDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug);
  const dash = await getDashboard(ctx.db);

  const locationIds = dash.recent.flatMap((m) => [m.fromLocationId, m.toLocationId]).filter((x): x is string => !!x);
  const [places, people] = await Promise.all([
    locationNames(locationIds),
    userNames(dash.recent.map((m) => m.actorUserId)),
  ]);
  const place = (id: string | null) => (id ? (places.get(id) ?? "Unknown location") : null);

  const figures = [
    { label: "Items", value: dash.items },
    { label: "In storage", value: dash.inStorage },
    { label: "Deployed", value: dash.deployed },
  ];

  return (
    <>
      <PageHeader eyebrow="Gear we store for" title={ctx.entity.name} blurb="What we hold, what is out on site, and what moved last." />

      <section aria-label="Totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {figures.map((f) => (
          <div key={f.label} className="rounded-card bg-panel px-4 py-3 shadow-sm">
            <p className="text-micro uppercase text-ink-muted">{f.label}</p>
            <p className="mt-1 text-page-title tabular-nums">{f.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-card bg-panel p-4 shadow-sm">
        <h2 className="text-micro uppercase text-ink-muted">Recent movements</h2>
        {dash.items === 0 && dash.recent.length === 0 ? (
          <p className="mt-3 text-body text-ink-muted">
            Nothing is on record for {ctx.entity.name} yet. Start in{" "}
            <Link href={`/entity/${slug}/inventory`} className="font-bold text-ink underline">Inventory</Link>
            {ctx.canWrite ? ": add a New item or Import a list." : "; someone with write access will add the first items."}
          </p>
        ) : dash.recent.length === 0 ? (
          <p className="mt-3 text-body text-ink-muted">No movements yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {dash.recent.map((m) => {
              const from = place(m.fromLocationId);
              const to = place(m.toLocationId);
              const unit = m.unit?.serial || m.unit?.ownerTag;
              const correction = !!m.correctsId;
              return (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-body">
                  <span className={`rounded-tile px-2 py-px text-detail font-bold ${correction ? "bg-sunken text-ink-muted" : "bg-sunken text-ink"}`}>
                    {movementLabel(m)}
                  </span>
                  <span className="font-bold">
                    {m.item.name}
                    {unit ? <span className="font-normal text-ink-muted"> · {unit}</span> : null}
                    {!correction && !m.unitId ? <span className="font-normal text-ink-muted"> × {m.quantity}</span> : null}
                  </span>
                  {from || to ? (
                    <span className="text-ink-muted">{from ?? "—"} → {to ?? "—"}</span>
                  ) : null}
                  {m.recipient ? <span className="text-ink-muted">to {m.recipient}</span> : null}
                  <span className="ml-auto text-detail text-ink-faint">
                    {people.get(m.actorUserId) ?? "Unknown user"} · {WHEN.format(m.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
