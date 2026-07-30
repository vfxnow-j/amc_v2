import Link from "next/link";
import { getReservationList } from "@/lib/queries/reservations";
import { VIEW_LABEL, type View } from "@/lib/reservations/views";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
});
const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Order · Client · Window · Units · Value · State */
const COLUMNS = "grid-cols-[136px_1fr_136px_66px_84px_112px]";

function windowLabel(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${DAY.format(start)} – ${sameYear ? DAY_YEAR.format(end) : DAY_YEAR.format(end)}`;
}

/** What this view's emptiness means, and the way out of it. */
const EMPTY: Record<View, React.ReactNode> = {
  open: (
    <>
      No orders are running. Approve a quote to start one, or{" "}
      <Link href="/dashboard/reservations/new" className="text-accent-text hover:underline">
        build a new order
      </Link>
      .
    </>
  ),
  "out-now": (
    <>
      Nothing is out with a client — every unit is on the shelf. Check units out
      from an order once it&rsquo;s approved.
    </>
  ),
  quotes: (
    <>
      No quotes are in play.{" "}
      <Link href="/dashboard/reservations/new" className="text-accent-text hover:underline">
        Build one
      </Link>{" "}
      and send it for approval.
    </>
  ),
  archive: <>Nothing has been completed, cancelled or lost yet.</>,
  all: (
    <>
      There are no orders at all yet.{" "}
      <Link href="/dashboard/reservations/new" className="text-accent-text hover:underline">
        Build the first one
      </Link>
      .
    </>
  ),
};

export async function ReservationTable({
  view,
  search,
  page,
}: {
  view: View;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getReservationList({
    view,
    search,
    page,
  });

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (rows.length === 0) {
    return (
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-sm text-center text-body text-balance text-ink-muted">
          {search ? (
            <>
              Nothing in {VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;. Try a
              different term, or switch to All.
            </>
          ) : (
            EMPTY[view]
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <div
        className={`grid ${COLUMNS} gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
      >
        <span>Order</span>
        <span>Client</span>
        <span>Window</span>
        <span className="text-right">Units</span>
        <span className="text-right">Value</span>
        <span>State</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {rows.map((row, index) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/reservations/${row.id}`}
              className={`grid ${COLUMNS} items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${
                row.isLate ? "bg-accent-tint" : index % 2 === 1 ? "bg-row-alt" : ""
              } hover:bg-row-hover`}
            >
              <span className="truncate font-bold">{row.reservationNumber}</span>
              <span className="truncate">
                {row.clientName}
                {row.projectName ? (
                  <span className="text-ink-faint"> · {row.projectName}</span>
                ) : null}
              </span>
              <span className="truncate text-ink-muted">
                {windowLabel(row.start, row.end)}
                {row.isRecurring ? (
                  // The end date is a billing boundary on these, not a return.
                  <span className="text-ink-faint"> · recurring</span>
                ) : null}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {row.unitsOut > 0
                  ? `${row.unitsOut}/${row.unitsOrdered}`
                  : row.unitsOrdered || "—"}
              </span>
              <span className="text-right tabular-nums">
                {MONEY.format(row.value)}
              </span>
              <span
                className={`truncate ${
                  row.isLate ? "font-bold text-accent-text" : "text-ink-muted"
                }`}
              >
                {row.isLate ? "Overdue back" : STATUS_LABEL[row.status]}
                {row.type !== "RENTAL" ? (
                  <span className="text-ink-faint"> · {TYPE_LABEL[row.type]}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="flex items-center gap-3 px-4 py-3 text-detail text-ink-muted">
        <span>
          {total <= pageSize
            ? `All ${total} shown`
            : `${first}–${last} of ${total} shown`}
        </span>
        {pages > 1 ? (
          <span className="ml-auto flex items-center gap-2">
            <PageLink
              view={view}
              search={search}
              page={page - 1}
              disabled={page <= 1}
            >
              ← Previous
            </PageLink>
            <span>
              Page {page} of {pages}
            </span>
            <PageLink
              view={view}
              search={search}
              page={page + 1}
              disabled={page >= pages}
            >
              Next →
            </PageLink>
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function PageLink({
  view,
  search,
  page,
  disabled,
  children,
}: {
  view: View;
  search: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="opacity-40">{children}</span>;
  }
  const params = new URLSearchParams();
  if (view !== "open") params.set("view", view);
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();

  return (
    <Link
      href={query ? `/dashboard/reservations?${query}` : "/dashboard/reservations"}
      className="text-accent-text hover:underline"
    >
      {children}
    </Link>
  );
}

export function ReservationTableSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="flex flex-col gap-[2px] px-2 pt-5">
        {Array.from({ length: 14 }, (_, index) => (
          // 30px is the real row height — the table must not reflow.
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}
