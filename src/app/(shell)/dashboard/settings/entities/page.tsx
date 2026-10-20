import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { ListTable, type Column } from "@/components/list/list-table";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { BUSINESS_TIME_ZONE } from "@/lib/billing/calendar";
import { readBackupFiles } from "@/lib/backups/read";
import {
  assessBackup,
  assessVerify,
  formatBytes,
  summariseDatabases,
  type BackupStatus,
  type VerifyStatus,
} from "@/lib/backups/status";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "Entities" };

const COLUMNS: Column[] = [
  { key: "name", label: "Name", width: "minmax(0,1fr)" },
  { key: "slug", label: "Slug", width: "minmax(0,1fr)" },
  { key: "modules", label: "Workspaces", width: "110px" },
  { key: "status", label: "Status", width: "110px" },
];

function whenPt(value: unknown): string {
  const time = typeof value === "string" ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime())) return "unknown";
  return time.toLocaleString("en-US", { timeZone: BUSINESS_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
}

/**
 * Read-only: what scripts/backup-v2.sh and scripts/verify-backups.sh last wrote.
 * Entity ledger rows can never be edited, so a backup is the only recovery; a
 * stale or failed one is shown as a warning rather than left to be noticed.
 */
function BackupCard({ status, verify }: { status: BackupStatus | null; verify: VerifyStatus | null }) {
  const backup = assessBackup(status);
  const restore = assessVerify(verify);
  const { count, bytes } = summariseDatabases(status);
  const healthy = backup.state === "ok" && restore.state === "ok";
  const problem = [backup, restore].filter((v) => v.state !== "ok").map((v) => v.reason);

  return (
    <section aria-labelledby="backups-heading" className="mb-6">
      <h2 id="backups-heading" className="mb-2 text-card-title text-ink">
        Backups
      </h2>
      {!healthy && (
        <Notice tone="error" className="mb-3">
          {problem.join(" ")} Run <code>npm run backups:run</code> and <code>npm run backups:verify</code> on the
          server, or check the schedule.
        </Notice>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-detail sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Last backup</dt>
          <dd>
            {backup.state === "never"
              ? "No backup has run yet"
              : `${whenPt(status?.lastRunAt)} PT${backup.state === "failed" ? " (failed)" : ""}`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Contents</dt>
          <dd className="tabular-nums">
            {status ? `${count} database${count === 1 ? "" : "s"}, ${formatBytes(bytes)}` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Last restore test</dt>
          <dd>
            {restore.state === "never"
              ? "No restore test has run yet"
              : `${whenPt(verify?.verifiedAt)} PT, ${verify?.ok === true ? "passed" : "failed"}`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Copies are kept</dt>
          <dd>On this server only. Not a defence against losing the machine.</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Settings → Entities. Super admin only: creating one provisions a database.
 */
export default async function EntitiesPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/login");
  if (viewer.role !== "SUPER_ADMIN") return <SettingsDenied id="entities" role={viewer.title} />;

  const entities = await prisma.entity.findMany({ orderBy: { name: "asc" } });
  const { status, verify } = await readBackupFiles();

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
      <BackupCard status={status} verify={verify} />
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
