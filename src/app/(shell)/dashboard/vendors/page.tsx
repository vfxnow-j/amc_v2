import { Suspense } from "react";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { getVendors } from "@/lib/queries/inventory";

export const metadata = { title: "Vendors" };

const COLUMNS: Column[] = [
  { key: "name", label: "Vendor", width: "minmax(0,1.2fr)" },
  { key: "contact", label: "Contact", width: "minmax(0,1fr)" },
  { key: "email", label: "Email", width: "minmax(0,1.2fr)" },
  { key: "phone", label: "Phone", width: "132px" },
  { key: "units", label: "Units", width: "70px", align: "right" },
  { key: "pos", label: "POs", width: "60px", align: "right" },
];

async function Table({ search }: { search: string }) {
  const vendors = await getVendors(search);

  return (
    <ListTable
      columns={COLUMNS}
      total={vendors.length}
      empty={
        search ? (
          <>No vendor matches &ldquo;{search}&rdquo;.</>
        ) : (
          <>
            No vendors yet. Add one when you raise a purchase order — a vendor is
            who the hardware came from, and what warranty claims go back to.
          </>
        )
      }
      rows={vendors.map((vendor) => ({
        id: vendor.id,
        cells: {
          name: <span className="font-bold">{vendor.name}</span>,
          contact: (
            <span className="text-ink-muted">{vendor.contactName ?? "—"}</span>
          ),
          email: (
            <span className="text-ink-muted">{vendor.contactEmail ?? "—"}</span>
          ),
          phone: (
            <span className="tabular-nums text-ink-muted">
              {vendor.contactPhone ?? "—"}
            </span>
          ),
          units: vendor.units || <span className="text-ink-faint">—</span>,
          pos: vendor.purchaseOrders || <span className="text-ink-faint">—</span>,
        },
      }))}
    />
  );
}

/**
 * Inventory → Vendors.
 *
 * One screen, not two: v1's `/dashboard/settings/vendors` is a byte-for-byte
 * copy of `/dashboard/vendors` apart from its back-link, and the duplicate is
 * not rebuilt (`lib/nav/clusters.ts`).
 */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Vendors"
        blurb="Who the hardware came from"
        actions={<ListSearch placeholder="Search vendors, contacts" />}
      />

      <Suspense key={search} fallback={<ListTableSkeleton />}>
        <Table search={search} />
      </Suspense>
    </>
  );
}
