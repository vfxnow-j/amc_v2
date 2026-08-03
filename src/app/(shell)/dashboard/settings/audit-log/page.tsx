import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { AuditFilters } from "@/components/settings/audit-filters";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import {
  AUDIT_PAGE_SIZE,
  getAuditFilterOptions,
  getAuditPage,
  type AuditFilters as Filters,
} from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { stamp } from "@/lib/settings/format";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Audit log" };

const COLUMNS: Column[] = [
  { key: "when", label: "When", width: "152px" },
  { key: "who", label: "Who", width: "minmax(0,1fr)" },
  { key: "did", label: "Did", width: "92px" },
  { key: "what", label: "To what", width: "minmax(0,0.9fr)" },
  { key: "ref", label: "Reference", width: "minmax(0,1.1fr)" },
  { key: "from", label: "From", width: "128px", align: "right" },
];

/** Actions that remove or hand out access — worth spotting in a scan. */
const HEAVY = new Set(["DELETE", "REJECT"]);

/**
 * Settings → Audit log.
 *
 * Who did what, when, and from which address. Read to reconstruct a sequence
 * after something turns out wrong, which is why the timestamp carries the time
 * of day and why the default order is newest first.
 *
 * v1 painted every action a different colour — eleven badges, one per verb.
 * That reads as decoration at a glance and hides the thing worth spotting, so
 * this tints only DELETE and REJECT: the two that took something away.
 *
 * Fifty rows a page, and no attempt at infinite scroll — this table is nearly
 * two hundred rows today and grows with every write in the app. A page number
 * in the URL is what makes "the third page of Steve's deletes" a thing somebody
 * can come back to.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    action?: string;
    entityType?: string;
    userId?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="audit-log" role={user.title} />;

  const params = await searchParams;
  const filters: Filters = {
    action: params.action,
    entityType: params.entityType,
    userId: params.userId,
    search: params.q?.trim() || undefined,
  };
  const page = Math.max(1, Number(params.page) || 1);
  const key = JSON.stringify({ ...filters, page });

  return (
    <>
      <SettingsHeader
        id="audit-log"
        actions={<ListSearch placeholder="Search a record id, name or email" />}
      />

      <Suspense fallback={<div className="h-[30px]" />}>
        <Filters_ />
      </Suspense>

      <Suspense key={key} fallback={<ListTableSkeleton rows={16} />}>
        <Table filters={filters} page={page} params={params} />
      </Suspense>
    </>
  );
}

async function Filters_() {
  const options = await getAuditFilterOptions();
  return (
    <AuditFilters
      actions={options.actions}
      entityTypes={options.entityTypes}
      users={options.users}
    />
  );
}

async function Table({
  filters,
  page,
  params,
}: {
  filters: Filters;
  page: number;
  params: Record<string, string | undefined>;
}) {
  const { rows, total, pages } = await getAuditPage(filters, page);

  function hrefFor(next: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "page") query.set(key, value);
    }
    if (next > 1) query.set("page", String(next));
    const search = query.toString();
    return search
      ? `/dashboard/settings/audit-log?${search}`
      : "/dashboard/settings/audit-log";
  }

  const filtered =
    !!filters.action || !!filters.entityType || !!filters.userId || !!filters.search;

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={AUDIT_PAGE_SIZE}
      pagination={{ page, pages, hrefFor }}
      empty={
        filtered ? (
          <>
            Nothing matches those filters. Clear one — the pickers only offer
            values the log actually contains, so an empty result means the
            combination never happened.
          </>
        ) : (
          <>
            Nothing has been logged yet. Entries appear as people create, change
            and delete records — there is nothing to configure here.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        cells: {
          when: (
            <span className="tabular-nums text-ink-muted">{stamp(row.at)}</span>
          ),
          who: row.who ? (
            <span className="font-bold">{row.who}</span>
          ) : (
            // A null user is a cron job or an unauthenticated webhook, not a
            // missing name.
            <span className="text-ink-faint">System</span>
          ),
          did: HEAVY.has(row.action) ? (
            <span className="font-bold text-destructive">{row.action}</span>
          ) : (
            <span className="text-ink-muted">{row.action}</span>
          ),
          what: <span className="text-ink-muted">{row.entityType}</span>,
          ref: row.entityId ? (
            <code className="text-detail text-ink-faint" title={row.entityId}>
              {row.entityId}
            </code>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          from: (
            <span className="tabular-nums text-ink-faint">
              {row.ipAddress ?? "—"}
            </span>
          ),
        },
      }))}
    />
  );
}
