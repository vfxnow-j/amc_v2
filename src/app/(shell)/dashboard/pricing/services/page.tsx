import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { Card, CardEmpty } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { PricingTabs } from "@/components/pricing/pricing-tabs";
import {
  ServiceForm,
  SERVICE_KIND_LABEL,
  type ServiceDraft,
} from "@/components/pricing/service-form";
import { money } from "@/lib/format";
import { getServices } from "@/lib/queries/operate";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Services" };

const COLUMNS: Column[] = [
  { key: "name", label: "Service", width: "minmax(0,1.1fr)" },
  { key: "description", label: "Note", width: "minmax(0,1.6fr)" },
  { key: "kind", label: "Kind", width: "128px" },
  { key: "rate", label: "Default rate", width: "112px", align: "right" },
  { key: "unit", label: "Charged", width: "104px" },
  { key: "ordered", label: "Ordered", width: "82px", align: "right" },
];

async function drafts(): Promise<ServiceDraft[]> {
  const services = await getServices();
  return services.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    defaultRate: service.defaultRate,
    unit: service.unit,
    kind: service.kind,
    active: service.active,
    usedOnOrders: service.timesOrdered,
  }));
}

async function FormCard({
  canEdit,
  canDelete,
  editing,
}: {
  canEdit: boolean;
  canDelete: boolean;
  editing?: string;
}) {
  if (!canEdit) {
    return (
      <Card title="Read-only">
        <CardEmpty>
          Your access lets you read the catalogue but not change it. Ask an
          administrator to add a service or move a rate.
        </CardEmpty>
      </Card>
    );
  }

  const rows = await drafts();
  const selected = editing ? rows.find((row) => row.id === editing) : undefined;

  return (
    <Card
      title={selected ? `Edit ${selected.name}` : "Add a service"}
      meta={selected ? selected.unit : "or pick a row"}
    >
      {/* Keyed on the selection so picking another row remounts the form with
          that service's fields, rather than an effect copying props into state. */}
      <ServiceForm
        key={selected?.id ?? "new"}
        service={selected ?? null}
        canDelete={canDelete}
      />
    </Card>
  );
}

async function Table({
  editing,
  canEdit,
}: {
  editing?: string;
  canEdit: boolean;
}) {
  const rows = await drafts();
  const withdrawn = rows.filter((row) => !row.active).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={rows.length}
      footerNote={withdrawn > 0 ? <>{withdrawn} not offered</> : null}
      empty={
        <>
          No services defined. These are the labour lines an order can carry —
          setup, on-site support, managed service — priced flat or by the hour.
        </>
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: canEdit ? `/dashboard/pricing/services?edit=${row.id}` : undefined,
        flagged: row.id === editing,
        cells: {
          name: (
            <span className={row.active ? "font-bold" : "font-bold opacity-60"}>
              {row.name}
              {row.active ? null : (
                <span className="font-normal text-ink-faint"> · off</span>
              )}
            </span>
          ),
          description: (
            <span className="text-ink-muted">{row.description ?? "—"}</span>
          ),
          kind: (
            <span className="text-ink-muted">{SERVICE_KIND_LABEL[row.kind]}</span>
          ),
          rate: row.defaultRate ? (
            money(row.defaultRate)
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          unit: <span className="text-ink-muted">{row.unit}</span>,
          ordered: row.usedOnOrders || <span className="text-ink-faint">—</span>,
        },
      }))}
    />
  );
}

/**
 * Operate → Pricing → Services. Moved from Operate → Services, 2026-09-09.
 *
 * The list has existed since the Operate cluster was built; what it never had
 * was a way to add to it. `createService`, `updateService` and `deleteService`
 * were ported months ago and reachable from nothing, so the six rows in this
 * database are the six that came over from v1 — two managed-service lines and
 * four professional-services ones. This is the wiring, in the same shape as
 * Cloud beside it: form on the left, catalogue on the right, `?edit=` picking
 * the row.
 *
 * `kind` was added on 2026-09-09 because `unit` was doing two jobs and could
 * only do one: "Per Day" says nothing about whether a day is an engineer's or a
 * van's. The six existing rows were classified once, by hand, from their names —
 * a correction of data the column did not exist to hold, not a rule. Nothing in
 * the app infers a kind from a name and nothing should.
 *
 * LOGISTICS has no rows yet. An order's delivery and return costs live on the
 * order itself, in fourteen columns no v2 screen has ever shown; wiring those
 * onto the order record comes first, and default logistics rates land here
 * after.
 *
 * The default rate is a starting figure. Adding a service to an order copies it
 * onto the line and the line is what charges, so editing here never moves an
 * order that already carries the service — the same rule as the catalogue tab.
 */
export default async function ServicesPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const editing = params.edit;
  // The ported actions gate on requireEditor; a VIEWER gets the read-only card.
  const canEdit = user.role !== "VIEWER";

  return (
    <>
      <PageHeader
        eyebrow="Operate · Pricing"
        title="Services"
        blurb="Labour an order can carry, and what each one starts at"
      />

      <PricingTabs current="services" />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Suspense fallback={null}>
          <FormCard
            canEdit={canEdit}
            canDelete={isAdminRole(user.role)}
            editing={editing}
          />
        </Suspense>

        <Suspense key={editing ?? "none"} fallback={<ListTableSkeleton />}>
          <Table editing={editing} canEdit={canEdit} />
        </Suspense>
      </div>
    </>
  );
}
