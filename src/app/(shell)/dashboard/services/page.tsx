import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import { getServices } from "@/lib/queries/operate";

export const metadata = { title: "Services" };

const COLUMNS: Column[] = [
  { key: "name", label: "Service", width: "minmax(0,1.1fr)" },
  { key: "description", label: "Note", width: "minmax(0,1.8fr)" },
  { key: "rate", label: "Default rate", width: "112px", align: "right" },
  { key: "unit", label: "Charged", width: "108px" },
  { key: "ordered", label: "Ordered", width: "82px", align: "right" },
];

async function Table() {
  const services = await getServices();
  const inactive = services.filter((service) => !service.active).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={services.length}
      footerNote={inactive > 0 ? <>{inactive} not offered</> : null}
      empty={
        <>
          No services defined. These are the labour lines an order can carry —
          setup, on-site support, a delivery run — priced flat or by the hour.
        </>
      }
      rows={services.map((service) => ({
        id: service.id,
        cells: {
          name: (
            <span className={service.active ? "font-bold" : "font-bold opacity-60"}>
              {service.name}
              {service.active ? null : (
                <span className="font-normal text-ink-faint"> · off</span>
              )}
            </span>
          ),
          description: (
            <span className="text-ink-muted">{service.description ?? "—"}</span>
          ),
          rate: service.defaultRate
            ? money(service.defaultRate)
            : <span className="text-ink-faint">—</span>,
          unit: <span className="text-ink-muted">{service.unit}</span>,
          ordered: service.timesOrdered || (
            <span className="text-ink-faint">—</span>
          ),
        },
      }))}
    />
  );
}

/**
 * Operate → Services: the professional-services catalogue.
 *
 * Sits in Operate rather than Revenue for the same reason cloud does — these
 * are things the team performs, and the money reaches the books through
 * Invoices. "Ordered" counts the order lines each one has appeared on, which is
 * the only honest measure of use the schema holds.
 */
export default async function ServicesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Services"
        blurb="Labour and delivery lines an order can carry"
      />

      <Suspense fallback={<ListTableSkeleton />}>
        <Table />
      </Suspense>
    </>
  );
}
