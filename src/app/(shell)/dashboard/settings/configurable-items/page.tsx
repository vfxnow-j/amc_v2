import Link from "next/link";
import { redirect } from "next/navigation";
import { ListTable, type Column } from "@/components/list/list-table";
import { MakeConfigurable } from "@/components/settings/configurable-items";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { money } from "@/lib/format";
import { listConfigurableItems, SLOT_LABEL } from "@/lib/queries/configurable";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Configurable items" };

const COLUMNS: Column[] = [
  { key: "name", label: "Item", width: "minmax(0,1.4fr)" },
  { key: "slots", label: "Configured with", width: "minmax(0,1.4fr)" },
  { key: "base", label: "Base parts", width: "96px", align: "right" },
  { key: "rate", label: "Base rate", width: "110px", align: "right" },
];

/**
 * Settings → Configurable items (owner, 2026-09-17).
 *
 * Kept deliberately simple, because v1's version — categories flagged to host
 * or be sub-items — was clunky: choose an item, then say what it can be
 * configured with. A workstation's base parts are included in its rate and
 * listed as its spec; everything else is an upgrade priced on top. On an order,
 * the line's Configure button offers exactly these.
 */
export default async function ConfigurableItemsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) return <SettingsDenied id="configurable-items" role={user.title} />;

  const rows = await listConfigurableItems();

  return (
    <>
      <SettingsHeader id="configurable-items" actions={<MakeConfigurable />} />
      <ListTable
        columns={COLUMNS}
        total={rows.length}
        empty={
          <>
            Nothing is configurable yet. Choose an item — a workstation — with{" "}
            <span className="text-ink">Make an item configurable</span>, then add what it can be configured with:
            its GPU, memory and storage options and any add-ons, each with a price.
          </>
        }
        rows={rows.map((row) => ({
          id: row.id,
          href: `/dashboard/settings/configurable-items/${row.id}`,
          cells: {
            name: (
              <span className="min-w-0">
                <span className="block truncate font-bold">{row.name}</span>
                <span className="block truncate text-detail text-ink-muted">
                  {row.category ?? "Uncategorized"} · {row.units} {row.units === 1 ? "unit" : "units"}
                </span>
              </span>
            ),
            slots: (
              <span className="truncate text-ink-muted">
                {row.slots.map((slot) => `${SLOT_LABEL[slot.slot]} ${slot.count}`).join(" · ")}
              </span>
            ),
            base: <span className="tabular-nums text-ink-muted">{row.base}</span>,
            rate: <span className="tabular-nums">{money(row.monthlyRate)}/mo</span>,
          },
        }))}
        footerNote={
          <Link href="/dashboard/assets" className="text-accent-text hover:underline">
            · items are assets
          </Link>
        }
      />
    </>
  );
}
