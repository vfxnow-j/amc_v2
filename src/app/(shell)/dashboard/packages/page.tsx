import { Suspense } from "react";
import Link from "next/link";
import { FilterTabs } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { NewPackage } from "@/components/packages/new-package";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import { listClientPackages, listTemplates } from "@/lib/queries/packages";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";

export const metadata = { title: "Packages" };

const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };

/** Package · Lines · What it comes to · Updated */
const OUR_COLUMNS: Column[] = [
  { key: "name", label: "Package", width: "minmax(0,1.3fr)" },
  { key: "lines", label: "What's in it", width: "minmax(0,2fr)" },
  { key: "price", label: "At current rates", width: "170px", align: "right" },
];

/** Client · Option · What went out · Order · Type · State */
const CLIENT_COLUMNS: Column[] = [
  { key: "client", label: "Client", width: "minmax(0,1fr)" },
  { key: "option", label: "Option", width: "minmax(0,0.9fr)" },
  { key: "lines", label: "What went out", width: "minmax(0,1.8fr)" },
  { key: "order", label: "Order", width: "132px" },
  { key: "type", label: "Type", width: "92px" },
  { key: "status", label: "State", width: "112px" },
];

async function OurPackages({ archived }: { archived: boolean }) {
  const { rows, archivedCount } = await listTemplates({ archived });

  return (
    <ListTable
      columns={OUR_COLUMNS}
      total={rows.length}
      footerNote={
        archivedCount > 0 ? (
          <Link
            href={archived ? "/dashboard/packages" : "/dashboard/packages?archived=1"}
            className="text-accent-text hover:underline"
          >
            {archived ? `· ${archivedCount} in use` : `· ${archivedCount} archived`}
          </Link>
        ) : undefined
      }
      empty={
        archived ? (
          <>Nothing archived.</>
        ) : (
          <>
            No packages yet. Build one here — a workstation spec, a render farm, an
            edit suite — and it turns up in Add line on every quote, ready to drop
            in.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/packages/${row.id}`,
        cells: {
          name: (
            <span className="min-w-0">
              <span className="block truncate font-bold">{row.name}</span>
              {row.description ? (
                <span className="block truncate text-detail text-ink-muted">{row.description}</span>
              ) : null}
            </span>
          ),
          lines:
            row.lines.length === 0 ? (
              <span className="text-ink-faint">No lines yet</span>
            ) : (
              <span className="truncate text-ink-muted">
                {row.lines.map((line) => `${line.quantity}× ${line.label}`).join(", ")}
              </span>
            ),
          price: (
            <span className="tabular-nums">
              {row.totals.byPeriod.length || row.totals.once ? (
                <>
                  {row.totals.byPeriod
                    .map((t) => `${money(t.amount)}/${PERIOD[t.pricingType] ?? t.pricingType.toLowerCase()}`)
                    .join(" + ")}
                  {row.totals.once ? (
                    <span className="text-ink-muted">
                      {row.totals.byPeriod.length ? " + " : ""}
                      {money(row.totals.once)} once
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </span>
          ),
        },
      }))}
    />
  );
}

async function ClientPackages({ page, query }: { page: number; query: string }) {
  const { rows, total, pageSize } = await listClientPackages({ page, query });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hrefFor = (next: number) => {
    const params = new URLSearchParams({ view: "clients" });
    if (query) params.set("q", query);
    if (next > 1) params.set("page", String(next));
    return `/dashboard/packages?${params.toString()}`;
  };

  return (
    <ListTable
      columns={CLIENT_COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        query ? (
          <>No client packages match “{query}”.</>
        ) : (
          <>
            Nothing has gone ahead with a client yet. When a client approves a quote,
            the option they chose shows here.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/orders/${row.order.id}?option=${row.id}`,
        cells: {
          client: <span className="truncate font-bold">{row.client.name}</span>,
          option: (
            <span className="min-w-0 truncate">
              {row.name}
              {row.order.options > 1 ? (
                <span className="text-ink-faint"> · chosen of {row.order.options}</span>
              ) : null}
            </span>
          ),
          lines: (
            <span className="truncate text-ink-muted">
              {row.lines.length
                ? row.lines.map((line) => `${line.quantity}× ${line.label}`).join(", ")
                : "No lines"}
            </span>
          ),
          order: <span className="tabular-nums text-ink-muted">{row.order.number}</span>,
          type: <span className="text-ink-muted">{TYPE_LABEL[row.order.type]}</span>,
          status: <span className="text-ink-muted">{STATUS_LABEL[row.order.status]}</span>,
        },
      }))}
    />
  );
}

/**
 * Inventory → Packages (moved from Operate, 2026-09-17).
 *
 * Two things share the name, and the screen keeps them apart:
 *
 * - **Our packages** are predefined — a spec built once here, found by Add line
 *   on any quote and dropped in whole. Rates follow the assets' current rates
 *   unless a package line sets its own.
 * - **Client packages** are what went ahead with clients: the quote option a
 *   client approved, on an order that was committed. Where a reorder starts, and
 *   what the client portal will show a client as theirs. Each opens its order on
 *   that option, where it can be saved back into our packages.
 *
 * The old screen listed every order's packages as shipping groups, which is
 * what the model's delivery and return costs suggest — but in use they are the
 * quote options v1 let a client choose between.
 */
export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; q?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "clients" ? "clients" : "ours";
  const page = Math.max(1, Number(params.page) || 1);
  const query = params.q?.trim() ?? "";
  const archived = params.archived === "1";

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Packages"
        blurb={
          view === "ours"
            ? "Built to spec once, dropped into any quote from Add line"
            : "The options clients chose, on orders that went ahead"
        }
        actions={view === "ours" ? <NewPackage /> : null}
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          param="view"
          value={view}
          fallback="ours"
          label="Packages"
          options={[
            { value: "ours", label: "Our packages" },
            { value: "clients", label: "Client packages" },
          ]}
        />
        {view === "clients" ? (
          <div className="ml-auto w-full max-w-xs">
            <ListSearch placeholder="Search clients, orders, projects" />
          </div>
        ) : null}
      </div>

      <Suspense key={`${view}-${page}-${query}-${archived}`} fallback={<ListTableSkeleton />}>
        {view === "ours" ? (
          <OurPackages archived={archived} />
        ) : (
          <ClientPackages page={page} query={query} />
        )}
      </Suspense>
    </>
  );
}
