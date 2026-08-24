import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { StatusText } from "@/components/inventory/record-cards";
import { dayYear } from "@/lib/format";
import { getAuditItems, getAuditProgress } from "@/lib/queries/audit-record";
import type { AuditItemStatus } from "@/generated/prisma/client";

/** Cards behind the audit record. */

export const AUDIT_ITEM_LABEL: Record<AuditItemStatus, string> = {
  PENDING: "To scan",
  VERIFIED: "Found",
  ISSUE: "Issue",
  MISSING: "Missing",
  UNEXPECTED: "Not in scope",
};

/**
 * Where the count has got to.
 *
 * Counted off the `AuditItem` rows rather than read from the audit's stored
 * counters: those are denormalized, incremented by each scan, and the items are
 * the physical record. When the two disagree the strip says so — a derived
 * counter must never quietly overrule what was actually scanned.
 */
export async function AuditProgressStrip({ id }: { id: string }) {
  const { counted, stored, drifted } = await getAuditProgress(id);

  if (counted.total === 0) {
    return (
      <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
        <p className="text-body text-balance text-ink-muted">
          This audit has no items yet. Starting it takes a snapshot of every unit
          in scope, and each one becomes a line to find.
        </p>
      </section>
    );
  }

  const exceptions = counted.issue + counted.missing + counted.unexpected;

  return (
    <section className="flex flex-col gap-2 rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Tally label="In scope" value={counted.total} />
        <Tally label="Found" value={counted.verified} />
        <Tally label="To scan" value={counted.pending} />
        <Tally label="Missing" value={counted.missing} alarm={counted.missing > 0} />
        <Tally
          label="Not in scope"
          value={counted.unexpected}
          alarm={counted.unexpected > 0}
        />
        <Tally label="Issues" value={counted.issue} alarm={counted.issue > 0} />
        <p className="ml-auto max-w-xs text-right text-detail text-balance text-ink-muted">
          {exceptions === 0
            ? counted.pending === 0
              ? "Everything in scope was found where it should be"
              : `${counted.verified} of ${counted.total} found, nothing unexpected so far`
            : `${exceptions} ${exceptions === 1 ? "exception" : "exceptions"} to work through`}
        </p>
      </div>

      {drifted ? (
        <p className="rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint">
          {/* Reported, not repaired: writing the counters back from the items
              would erase the evidence that something wrote outside the scan
              path. */}
          The audit&rsquo;s stored counters disagree with its items — it records{" "}
          {stored.verified} found and {stored.missing} missing against{" "}
          {counted.verified} and {counted.missing} on the rows themselves. The
          rows are what was scanned; the counters are a running total kept
          alongside them, and something has written outside the scan path.
        </p>
      ) : null}
    </section>
  );
}

function Tally({
  label,
  value,
  alarm,
}: {
  label: string;
  value: number;
  alarm?: boolean;
}) {
  return (
    <span className="flex min-w-[86px] flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`text-[20px] font-bold tabular-nums tracking-[-0.02em] ${
          alarm ? "text-accent-text" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Every line of the count, exceptions first.
 *
 * The order is deliberate: what didn't match is the whole output of an audit,
 * and a screen that put 99 verified rows above 3 missing ones would bury it. An
 * unknown barcode has no unit to link to — the scan captured a code that isn't
 * registered — so the row shows the raw code and says so rather than linking
 * nowhere.
 */
export async function AuditItemsCard({ id }: { id: string }) {
  const { rows, total } = await getAuditItems(id);

  if (total === 0) {
    return (
      <Card title="Items">
        <CardEmpty>
          Nothing to count yet. Starting the audit snapshots the units in scope,
          and each becomes a line here to find or fail to find.
        </CardEmpty>
      </Card>
    );
  }

  const columns =
    "grid grid-cols-[96px_minmax(0,1.2fr)_96px_minmax(0,1fr)_84px] items-center gap-2";

  return (
    <Card
      title="Items"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown, exceptions first`
          : `all ${total} shown, exceptions first`
      }
      className="min-h-0"
    >
      <div
        className={`${columns} px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
      >
        <span>Unit</span>
        <span>Asset</span>
        <span>State</span>
        <span>Where it is now</span>
        <span className="text-right">Scanned</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {rows.map((row) => {
          const cells = (
            <>
              <span className="truncate font-bold tabular-nums">
                {row.barcode ?? <Unset>No code</Unset>}
              </span>
              <span className="truncate">
                {row.assetName ?? (
                  <Unset>Not a registered unit</Unset>
                )}
              </span>
              <span className="truncate">
                <ItemState status={row.status} />
              </span>
              <span className="truncate text-ink-muted">
                {row.currentStatus ? (
                  <>
                    <StatusText status={row.currentStatus} />
                    {row.currentLocation ? ` · ${row.currentLocation}` : ""}
                  </>
                ) : (
                  <Unset>Unknown</Unset>
                )}
              </span>
              <span className="text-right tabular-nums text-ink-faint">
                {row.scannedAt ? dayYear(row.scannedAt) : <Unset>—</Unset>}
              </span>
            </>
          );

          const className = `${columns} rounded-row px-2 py-[6px] text-detail`;

          return (
            <li key={row.id}>
              {row.unitId ? (
                <Link
                  href={`/dashboard/units/${row.unitId}`}
                  className={`${className} hover:bg-row-hover`}
                >
                  {cells}
                </Link>
              ) : (
                <div className={className}>{cells}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Exceptions read in accent; a found item is the quiet case. */
function ItemState({ status }: { status: AuditItemStatus }) {
  const label = AUDIT_ITEM_LABEL[status];
  if (status === "VERIFIED") return <span className="text-ink-muted">{label}</span>;
  if (status === "PENDING") return <span className="text-ink-faint">{label}</span>;
  return <span className="font-bold text-accent-text">{label}</span>;
}
