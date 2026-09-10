import Link from "next/link";

/**
 * The dense list every rail screen renders.
 *
 * Extracted from `components/reservations/reservation-table.tsx`, which was
 * written first and is still the reference for what a good one looks like. The
 * shape it fixes — column heads in `text-colhead`, 30px rows on a 2px gutter,
 * alternating `bg-row-alt`, a qualified count in the footer — is the handoff's
 * density rule, and every screen that re-typed it was a chance to get it subtly
 * wrong.
 *
 * Deliberately a server component: rows carry rendered `ReactNode` cells and the
 * pagination takes an href builder, both of which stop working the moment this
 * crosses to the client. Nothing here needs to.
 *
 * A row with an `href` is still clickable edge to edge, but the anchor is on the
 * identity cell and reaches the rest of the row through `before:absolute`. That
 * is what lets a cell further along carry its own link — the Units list sends
 * the row to the unit and the Location cell to the location — without nesting
 * anchors, which is invalid HTML the parser unpicks on its own. Cell links go
 * through `CellLink` so they land above the overlay.
 */

export type Column = {
  key: string;
  label: string;
  /** A CSS grid track — `"136px"`, `"1fr"`, `"minmax(0,1fr)"`. */
  width: string;
  align?: "right";
};

export type Row = {
  id: string;
  /** Row is the click target when set, per the handoff. */
  href?: string;
  cells: Record<string, React.ReactNode>;
  /**
   * Needs hands — tinted the way an overdue order is on the Reservations hub.
   * Reserve it for "someone must act", not merely "unusual".
   */
  flagged?: boolean;
};

export type Pagination = {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
};

function trackList(columns: Column[]) {
  return columns.map((column) => column.width).join(" ");
}

export function ListTable({
  columns,
  rows,
  total,
  pageSize,
  page = 1,
  empty,
  pagination,
  /** Appended after the count, e.g. "· 3 overdue". Must be provable. */
  footerNote,
  /** Set only when a screen stacks more than one table and they need naming. */
  title,
  action,
  /** Stacked tables size to content; a lone table fills the column. */
  grow = true,
}: {
  columns: Column[];
  rows: Row[];
  total: number;
  pageSize?: number;
  page?: number;
  empty: React.ReactNode;
  pagination?: Pagination;
  footerNote?: React.ReactNode;
  title?: React.ReactNode;
  action?: React.ReactNode;
  grow?: boolean;
}) {
  const frame = grow ? "flex min-h-0 flex-1 flex-col" : "flex flex-col";

  const heading = title ? (
    <div className="flex items-center gap-3 px-4 pb-2">
      <h2 className="text-card-title">{title}</h2>
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <section
        className={`${grow ? "flex flex-1" : "flex"} flex-col rounded-card bg-panel p-[14px] shadow-sm`}
      >
        {heading}
        <p
          className={`${grow ? "flex flex-1 items-center justify-center" : "px-4 py-6"} text-center text-body text-balance text-ink-muted`}
        >
          <span className="max-w-sm">{empty}</span>
        </p>
      </section>
    );
  }

  const tracks = trackList(columns);
  const size = pageSize ?? rows.length;
  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <section
      className={`${frame} overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm`}
    >
      {heading}
      <div
        className="grid gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted"
        style={{ gridTemplateColumns: tracks }}
      >
        {columns.map((column) => (
          <span
            key={column.key}
            className={column.align === "right" ? "text-right" : undefined}
          >
            {column.label}
          </span>
        ))}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {rows.map((row, index) => {
          const cells = columns.map((column, position) => {
            const content = row.cells[column.key];
            return (
              <span
                key={column.key}
                className={`truncate ${column.align === "right" ? "text-right tabular-nums" : ""}`}
              >
                {/* The row's own link lives on the identity cell and stretches
                    over the whole row from there, so a cell further along can
                    carry its own link without nesting one anchor inside
                    another — which the HTML parser silently unpicks. */}
                {row.href && position === 0 ? (
                  <Link
                    href={row.href}
                    className="before:absolute before:inset-0 before:rounded-row before:content-['']"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </span>
            );
          });

          const tone = row.flagged
            ? "bg-accent-tint"
            : index % 2 === 1
              ? "bg-row-alt"
              : "";

          return (
            <li key={row.id} className={row.href ? "group relative" : undefined}>
              <div
                className={`grid items-center gap-2 rounded-row p-2 ${tone} ${
                  row.href
                    ? "transition-colors duration-[160ms] group-hover:bg-row-hover"
                    : ""
                }`}
                style={{ gridTemplateColumns: tracks }}
              >
                {cells}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center gap-3 px-4 py-3 text-detail text-ink-muted">
        <span>
          {/* Never a bare number — the handoff's counting rule. */}
          {total <= rows.length
            ? `All ${total} shown`
            : `${first}–${last} of ${total} shown`}
          {footerNote ? <> · {footerNote}</> : null}
        </span>
        {pagination && pagination.pages > 1 ? (
          <span className="ml-auto flex items-center gap-2">
            <PageLink
              href={pagination.hrefFor(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              ← Previous
            </PageLink>
            <span>
              Page {pagination.page} of {pagination.pages}
            </span>
            <PageLink
              href={pagination.hrefFor(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
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
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <span className="opacity-40">{children}</span>;
  return (
    <Link href={href} className="text-accent-text hover:underline">
      {children}
    </Link>
  );
}

/**
 * A link inside a cell, for the rest of the row.
 *
 * The identity cell already carries the row's link, stretched over the whole
 * row by a pseudo-element. A second anchor in a later cell has to sit above that
 * overlay to be clickable at all, which is what `relative` buys — every cell
 * link goes through here so no screen has to remember that.
 *
 * Deliberately quiet: it inherits the cell's own color and underlines on hover
 * rather than taking accent. In these lists accent already means *notice this* —
 * a location with nothing free, a unit in service — and spending it on "this is
 * a link" in three columns of every row would drown the one signal that is
 * supposed to stop a reader.
 */
export function CellLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="relative hover:underline">
      {children}
    </Link>
  );
}

/** Rows at their real height, so the table never reflows when data lands. */
export function ListTableSkeleton({ rows = 14 }: { rows?: number }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="flex flex-col gap-[2px] px-2 pt-5">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}
