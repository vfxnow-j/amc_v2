import Link from "next/link";
import { redirect } from "next/navigation";
import { ListTable, type Column } from "@/components/list/list-table";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "Entities" };

const COLUMNS: Column[] = [
  { key: "name", label: "Name", width: "minmax(0,1fr)" },
  { key: "slug", label: "Slug", width: "minmax(0,1fr)" },
  { key: "modules", label: "Workspaces", width: "110px" },
  { key: "status", label: "Status", width: "110px" },
];

/**
 * Settings → Entities. Super admin only: creating one provisions a database.
 */
export default async function EntitiesPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/login");
  if (viewer.role !== "SUPER_ADMIN") return <SettingsDenied id="entities" role={viewer.title} />;

  const entities = await prisma.entity.findMany({ orderBy: { name: "asc" } });

  return (
    <>
      <SettingsHeader
        id="entities"
        actions={
          <Link
            href="/dashboard/settings/entities/new"
            className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
          >
            New entity
          </Link>
        }
      />
      <ListTable
        columns={COLUMNS}
        total={entities.length}
        empty={<>No entities yet. Create one to give an owner its own inventory in a database of its own.</>}
        rows={entities.map((entity) => ({
          id: entity.id,
          href: `/dashboard/settings/entities/${entity.id}`,
          cells: {
            name: <span className="font-bold">{entity.name}</span>,
            slug: <span className="text-ink-muted">{entity.slug}</span>,
            modules: <span className="tabular-nums text-ink-muted">{entity.modules.length}</span>,
            status: entity.active ? (
              <span className="text-ink-muted">Active</span>
            ) : (
              <span className="text-ink-faint">Deactivated</span>
            ),
          },
        }))}
      />
    </>
  );
}
