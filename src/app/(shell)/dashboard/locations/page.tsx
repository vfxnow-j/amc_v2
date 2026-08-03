import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import {
  getLocations,
  getRecentTransfers,
  getUnlocatedUnitCount,
} from "@/lib/queries/inventory";

export const metadata = { title: "Locations & transfers" };

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
});

const LOCATION_COLUMNS: Column[] = [
  { key: "name", label: "Location", width: "minmax(0,1fr)" },
  { key: "parent", label: "Within", width: "160px" },
  { key: "address", label: "Address", width: "minmax(0,1.4fr)" },
  { key: "units", label: "Units", width: "70px", align: "right" },
];

const TRANSFER_COLUMNS: Column[] = [
  { key: "date", label: "Moved", width: "96px" },
  { key: "unit", label: "Unit", width: "120px" },
  { key: "asset", label: "Asset", width: "minmax(0,1.2fr)" },
  { key: "from", label: "From", width: "minmax(0,1fr)" },
  { key: "to", label: "To", width: "minmax(0,1fr)" },
];

async function Locations() {
  const [locations, unlocated] = await Promise.all([
    getLocations(),
    getUnlocatedUnitCount(),
  ]);

  return (
    <ListTable
      title="Locations"
      grow={false}
      columns={LOCATION_COLUMNS}
      total={locations.length}
      empty={
        <>
          No locations are defined. Add one before moving units around —
          transfers need somewhere to move from and to.
        </>
      }
      footerNote={
        // Worth saying only when true: these units can be booked but not found.
        unlocated > 0 ? (
          <span className="text-accent-text">
            {unlocated} in-fleet {unlocated === 1 ? "unit has" : "units have"} no
            location
          </span>
        ) : null
      }
      rows={locations.map((location) => ({
        id: location.id,
        cells: {
          name: <span className="font-bold">{location.name}</span>,
          parent: (
            <span className="text-ink-muted">{location.parentName ?? "—"}</span>
          ),
          address: (
            <span className="text-ink-muted">{location.address ?? "—"}</span>
          ),
          units: location.units || <span className="text-ink-faint">—</span>,
        },
      }))}
    />
  );
}

async function Transfers() {
  const transfers = await getRecentTransfers();

  return (
    <ListTable
      title="Recent transfers"
      columns={TRANSFER_COLUMNS}
      total={transfers.length}
      empty={
        <>
          Nothing has been transferred between locations. A transfer is recorded
          when a unit physically moves — it isn&rsquo;t an approval step.
        </>
      }
      rows={transfers.map((transfer) => ({
        id: transfer.id,
        cells: {
          date: (
            <span className="tabular-nums text-ink-muted">
              {DAY.format(transfer.date)}
            </span>
          ),
          unit: (
            <span className="font-bold tabular-nums">{transfer.barcode}</span>
          ),
          asset: transfer.assetName,
          from: <span className="text-ink-muted">{transfer.from}</span>,
          to: transfer.to,
        },
      }))}
    />
  );
}

/**
 * Inventory → Locations & transfers.
 *
 * v1's top nav linked to `/dashboard/locations`, which never existed — the only
 * locations screen was the settings one. Promoted here because where a unit
 * physically is belongs with the fleet, not with configuration.
 *
 * The transfers card is a **log, not a queue**: `AssetTransfer` has no status
 * column, so a row is a move that already happened. The build plan called it an
 * "in-flight queue"; the schema can't support that reading, and labelling it one
 * would promise an approval step that doesn't exist.
 */
export default async function LocationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Locations & transfers"
        blurb="Where the fleet physically sits, and what has moved lately"
      />

      <Suspense fallback={<ListTableSkeleton rows={5} />}>
        <Locations />
      </Suspense>

      <Suspense fallback={<ListTableSkeleton rows={8} />}>
        <Transfers />
      </Suspense>
    </>
  );
}
