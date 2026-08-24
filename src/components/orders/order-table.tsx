import Link from "next/link";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
  type Row,
} from "@/components/list/list-table";
import { money, windowLabel } from "@/lib/format";
import { TYPE_FILTER_LABEL, type TypeFilter } from "@/lib/orders/types";
import { getReservationList } from "@/lib/queries/reservations";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";
import { VIEW_LABEL, type View } from "@/lib/reservations/views";

/** Order · Type · Client · Window · Units · Value · State */
const COLUMNS: Column[] = [
  { key: "number", label: "Order", width: "132px" },
  { key: "type", label: "Type", width: "96px" },
  { key: "client", label: "Client", width: "minmax(0,1.4fr)" },
  { key: "window", label: "Window", width: "136px" },
  { key: "units", label: "Units", width: "66px", align: "right" },
  { key: "value", label: "Value", width: "88px", align: "right" },
  { key: "status", label: "State", width: "116px" },
];

const NEW_ORDER = (
  <Link
    href="/dashboard/orders/new"
    className="text-accent-text hover:underline"
  >
    build a new order
  </Link>
);

/** What this view's emptiness means, and the way out of it. */
const EMPTY: Record<View, React.ReactNode> = {
  open: <>No orders are running. Approve a quote to start one, or {NEW_ORDER}.</>,
  "out-now": (
    <>
      Nothing is out with a client — every unit is on the shelf. Check units out
      from an order once it&rsquo;s approved.
    </>
  ),
  quotes: <>No quotes are in play. {NEW_ORDER} and send it for approval.</>,
  archive: <>Nothing has been completed, cancelled or lost yet.</>,
  all: <>There are no orders at all yet. {NEW_ORDER}.</>,
};

/**
 * Operate → Orders, the table.
 *
 * Built on `ListTable` rather than the bespoke markup this screen used to
 * carry: that component was extracted *from* this table and every rule it
 * enforces — 30px rows, the zebra, the qualified footer count, the tint on a
 * flagged row — came from here in the first place. Keeping a second copy meant
 * the reference implementation was the one screen not using the reference.
 *
 * The Type column is the whole point of the consolidation. It used to be a
 * suffix on the State cell, shown only when the order wasn't a rental, which
 * made a sale look like a rental with a footnote. It is a column now, so the
 * four kinds of order read as four kinds of order.
 */
export async function OrderTable({
  view,
  type,
  search,
  page,
}: {
  view: View;
  type: TypeFilter;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getReservationList({
    view,
    type,
    search,
    page,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "open") params.set("view", view);
    if (type !== "all") params.set("type", type);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/orders?${query}` : "/dashboard/orders";
  }

  const listRows: Row[] = rows.map((row) => ({
    id: row.id,
    href: `/dashboard/orders/${row.id}`,
    flagged: row.isLate,
    cells: {
      number: <span className="truncate font-bold">{row.reservationNumber}</span>,
      type: <span className="truncate text-ink-muted">{TYPE_LABEL[row.type]}</span>,
      client: (
        <span className="truncate">
          {row.clientName}
          {row.projectName ? (
            <span className="text-ink-faint"> · {row.projectName}</span>
          ) : null}
        </span>
      ),
      window: (
        <span className="truncate text-ink-muted">
          {windowLabel(row.start, row.end)}
          {row.isRecurring ? (
            // The end date is a billing boundary on these, not a return.
            <span className="text-ink-faint"> · recurring</span>
          ) : null}
        </span>
      ),
      units:
        row.unitsOut > 0
          ? `${row.unitsOut}/${row.unitsOrdered}`
          : row.unitsOrdered || "—",
      value: money(row.value),
      status: (
        <span
          className={`truncate ${
            row.isLate ? "font-bold text-accent-text" : "text-ink-muted"
          }`}
        >
          {row.isLate ? "Overdue back" : STATUS_LABEL[row.status]}
        </span>
      ),
    },
  }));

  return (
    <ListTable
      columns={COLUMNS}
      rows={listRows}
      total={total}
      pageSize={pageSize}
      page={page}
      pagination={{ page, pages, hrefFor }}
      empty={
        search ? (
          <>
            Nothing in {VIEW_LABEL[view]}
            {type === "all" ? "" : ` · ${TYPE_FILTER_LABEL[type]}`} matches
            &ldquo;{search}&rdquo;. Try a different term, or widen the filters.
          </>
        ) : type === "all" ? (
          EMPTY[view]
        ) : (
          <>
            No {TYPE_FILTER_LABEL[type].toLowerCase()} orders are in{" "}
            {VIEW_LABEL[view].toLowerCase()}. Other order types may have some —
            switch to All types.
          </>
        )
      }
    />
  );
}

export { ListTableSkeleton as OrderTableSkeleton };
