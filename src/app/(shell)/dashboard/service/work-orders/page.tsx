import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { getWorkOrders, WORK_ORDER_LABEL } from "@/lib/queries/service";

export const metadata = { title: "Work orders" };

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** WO · Unit · Fault · Tech · Runs · State */
const COLUMNS = "grid-cols-[108px_96px_1fr_112px_56px_128px]";

async function Queue({ includeClosed }: { includeClosed: boolean }) {
  const rows = await getWorkOrders(includeClosed);

  if (rows.length === 0) {
    return (
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-sm text-center text-body text-balance text-ink-muted">
          {includeClosed
            ? "No work orders have been raised yet."
            : "Nothing is on the bench — every unit that came back passed. Raise a work order from a check-in when one doesn’t."}
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <div
        className={`grid ${COLUMNS} gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
      >
        <span>Work order</span>
        <span>Unit</span>
        <span>Fault</span>
        <span>Tech</span>
        <span className="text-right">Runs</span>
        <span>State</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {rows.map((row, index) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/service/work-orders/${row.id}`}
              className={`grid ${COLUMNS} items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${
                row.hasFailure
                  ? "bg-accent-tint"
                  : index % 2 === 1
                    ? "bg-row-alt"
                    : ""
              } hover:bg-row-hover`}
            >
              <span className="truncate font-bold">{row.number}</span>
              <span className="truncate">{row.barcode}</span>
              <span className="truncate">
                {row.fault}
                <span className="text-ink-faint"> · {row.assetName}</span>
              </span>
              <span className="truncate text-ink-muted">
                {row.tech ?? "Unassigned"}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {row.runs || "—"}
              </span>
              <span
                className={
                  row.hasFailure
                    ? "truncate font-bold text-accent-text"
                    : "truncate text-ink-muted"
                }
              >
                {WORK_ORDER_LABEL[row.status]}
                <span className="text-ink-faint">
                  {" "}
                  · {DAY.format(row.openedAt)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="px-4 py-3 text-detail text-ink-muted">
        {rows.length} shown
        {includeClosed ? "" : " · open work only"}
      </p>
    </section>
  );
}

/**
 * Service center → Work orders.
 *
 * The queue is what the bench works from. A row with a failed test run takes
 * the accent tint, because that is the one that needs a decision rather than
 * more time.
 */
export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const includeClosed = all === "1";

  return (
    <>
      <PageHeader
        eyebrow="Service center"
        title="Work orders"
        blurb="Raised when a unit fails on return. A unit with one open isn’t bookable."
        actions={
          <Link
            href={includeClosed ? "/dashboard/service/work-orders" : "/dashboard/service/work-orders?all=1"}
            className="rounded-pill bg-sunken px-[14px] py-2 text-pill text-ink transition-colors hover:bg-row-hover"
          >
            {includeClosed ? "Open work only" : "Include closed"}
          </Link>
        }
      />
      <Suspense
        fallback={
          <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
            <div className="flex flex-col gap-[2px] px-2 pt-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="h-[30px] animate-pulse rounded-row bg-row-alt" />
              ))}
            </div>
          </section>
        }
      >
        <Queue includeClosed={includeClosed} />
      </Suspense>
    </>
  );
}
