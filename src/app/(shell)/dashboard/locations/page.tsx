import { Suspense } from "react";
import {
  CellLink,
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
  { key: "parent", label: "Within", width: "150px" },
  { key: "address", label: "Address", width: "minmax(0,1.3fr)" },
  { key: "fleet", label: "In fleet", width: "72px", align: "right" },
  { key: "free", label: "Free", width: "64px", align: "right" },
  { key: "out", label: "Out", width: "64px", align: "right" },
  { key: "service", label: "Service", width: "72px", align: "right" },
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

  // Retired and sold units keep the location they were last at, so the counts
  // above deliberately exclude them and the footer says how many were left out.
  // The alternative is a shelf count that includes hardware that isn't there.
  const gone = locations.reduce(
    (sum, location) => sum + (location.total - location.inFleet),
    0,
  );

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
        <>
          {gone > 0
            ? `${gone} retired or sold ${gone === 1 ? "unit is" : "units are"} filed here and not counted`
            : null}
          {/* Worth saying only when true: these units can be booked but not
              found, which is a job rather than a statistic. */}
          {gone > 0 && unlocated > 0 ? " · " : null}
          {unlocated > 0 ? (
            <span className="text-accent-text">
              {unlocated} in-fleet {unlocated === 1 ? "unit has" : "units have"}{" "}
              no location
            </span>
          ) : null}
        </>
      }
      rows={locations.map((location) => ({
        id: location.id,
        // The row that reads "0 free" is the one worth acting on, and until the
        // location record existed it was a dead end.
        href: `/dashboard/locations/${location.id}`,
        cells: {
          name: <span className="font-bold">{location.name}</span>,
          parent: (
            <span className="text-ink-muted">{location.parentName ?? "—"}</span>
          ),
          address: (
            <span className="text-ink-muted">{location.address ?? "—"}</span>
          ),
          fleet: (
            <span className="text-ink-muted">
              {location.inFleet || "—"}
            </span>
          ),
          // Nothing free here is worth seeing at a glance: it is the difference
          // between "pull it from LA" and "somebody has to drive".
          free:
            location.inFleet === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : location.free === 0 ? (
              <span className="font-bold text-accent-text">0</span>
            ) : (
              <span>{location.free}</span>
            ),
          out: (
            <span className="text-ink-muted">{location.out || "—"}</span>
          ),
          service: (
            <span className="text-ink-muted">{location.service || "—"}</span>
          ),
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
        // No row link: a transfer has no record of its own, and the four things
        // it names — the unit, what it is, and the two shelves — are four
        // different destinations with no primary one among them.
        cells: {
          date: (
            <span className="tabular-nums text-ink-muted">
              {DAY.format(transfer.date)}
            </span>
          ),
          unit: (
            <CellLink href={`/dashboard/units/${transfer.unit.id}`}>
              <span className="font-bold tabular-nums">
                {transfer.unit.barcode}
              </span>
            </CellLink>
          ),
          asset: (
            <CellLink href={`/dashboard/assets/${transfer.asset.id}`}>
              {transfer.asset.name}
            </CellLink>
          ),
          from: (
            <CellLink href={`/dashboard/locations/${transfer.from.id}`}>
              {transfer.from.name}
            </CellLink>
          ),
          to: (
            <CellLink href={`/dashboard/locations/${transfer.to.id}`}>
              {transfer.to.name}
            </CellLink>
          ),
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
