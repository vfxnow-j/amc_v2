import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import {
  AUDIT_TABS,
  AUDIT_TAB_LABEL,
  isAuditTab,
  type AuditTab,
} from "@/lib/inventory/labels";
import {
  getAudits,
  getAuditTabCounts,
  getScanLists,
} from "@/lib/queries/inventory";

export const metadata = { title: "Audits & scan lists" };

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
});

const SCOPE_LABEL: Record<string, string> = {
  FULL: "Full",
  PARTIAL: "Partial",
  CATEGORY: "Category",
  LOCATION: "Location",
  CLIENT_ORDER: "Client order",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "Counting",
  COMPLETED: "Done",
};

const AUDIT_COLUMNS: Column[] = [
  { key: "name", label: "Audit", width: "minmax(0,1.4fr)" },
  { key: "scope", label: "Scope", width: "112px" },
  { key: "status", label: "Status", width: "92px" },
  { key: "counted", label: "Counted", width: "104px", align: "right" },
  { key: "exceptions", label: "Exceptions", width: "96px", align: "right" },
  { key: "when", label: "Opened", width: "96px" },
];

const SCAN_COLUMNS: Column[] = [
  { key: "name", label: "Scan list", width: "minmax(0,1.4fr)" },
  { key: "description", label: "Note", width: "minmax(0,1.6fr)" },
  { key: "items", label: "Scanned", width: "88px", align: "right" },
  { key: "updated", label: "Last scan", width: "104px" },
];

async function Tabs({ tab }: { tab: AuditTab }) {
  const counts = await getAuditTabCounts();
  return (
    <FilterTabs
      param="tab"
      value={tab}
      fallback="audits"
      label="Audits and scan lists"
      options={AUDIT_TABS.map((option) => ({
        value: option,
        label: AUDIT_TAB_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function Audits() {
  const audits = await getAudits();

  return (
    <ListTable
      columns={AUDIT_COLUMNS}
      total={audits.length}
      empty={
        <>
          No stock count has been run. An audit scans a scope of units and
          reports what it couldn&rsquo;t match — it never repairs the record on
          its own.
        </>
      }
      rows={audits.map((audit) => ({
        id: audit.id,
        // Exceptions are the reason to open one of these.
        flagged: audit.exceptions > 0,
        cells: {
          name: <span className="font-bold">{audit.name}</span>,
          scope: (
            <span className="text-ink-muted">
              {SCOPE_LABEL[audit.scope] ?? audit.scope}
            </span>
          ),
          status: (
            <span className="text-ink-muted">
              {STATUS_LABEL[audit.status] ?? audit.status}
            </span>
          ),
          counted: (
            <span className="text-ink-muted">
              {audit.totalItems === 0
                ? "—"
                : `${audit.verifiedCount}/${audit.totalItems}`}
            </span>
          ),
          exceptions:
            audit.exceptions > 0 ? (
              <span className="font-bold text-accent-text">
                {audit.exceptions}
              </span>
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          when: (
            <span className="tabular-nums text-ink-muted">
              {DAY.format(audit.startedAt ?? audit.createdAt)}
            </span>
          ),
        },
      }))}
    />
  );
}

async function ScanLists() {
  const lists = await getScanLists();

  return (
    <ListTable
      columns={SCAN_COLUMNS}
      total={lists.length}
      empty={
        <>
          No scan lists yet. A scan list is a free-form gather — scan whatever is
          in front of you and name it later. Use an audit when you already know
          what should be there.
        </>
      }
      rows={lists.map((list) => ({
        id: list.id,
        cells: {
          name: <span className="font-bold">{list.name}</span>,
          description: (
            <span className="text-ink-muted">{list.description ?? "—"}</span>
          ),
          items: list.items || <span className="text-ink-faint">—</span>,
          updated: (
            <span className="tabular-nums text-ink-muted">
              {DAY.format(list.updatedAt)}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Inventory → Audits & scan lists: the Stage 3 merge of two v1 siblings.
 *
 * They're one screen because they answer the same question at different levels
 * of rigour — an audit checks reality against an expected set, a scan list just
 * gathers barcodes. Two tabs rather than two rail slots.
 */
export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab: AuditTab = isAuditTab(params.tab) ? params.tab : "audits";

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Audits & scan lists"
        blurb="Counting what's actually on the shelf"
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={220} />}>
          <Tabs tab={tab} />
        </Suspense>
      </div>

      <Suspense key={tab} fallback={<ListTableSkeleton />}>
        {tab === "audits" ? <Audits /> : <ScanLists />}
      </Suspense>
    </>
  );
}
