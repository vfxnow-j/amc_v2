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
          const cells = columns.map((column) => (
            <span
              key={column.key}
              className={`truncate ${column.align === "right" ? "text-right tabular-nums" : ""}`}
            >
              {row.cells[column.key]}
            </span>
          ));

          const tone = row.flagged
            ? "bg-accent-tint"
            : index % 2 === 1
              ? "bg-row-alt"
              : "";

          return (
            <li key={row.id}>
              {row.href ? (
                <Link
                  href={row.href}
                  className={`grid items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${tone} hover:bg-row-hover`}
                  style={{ gridTemplateColumns: tracks }}
                >
                  {cells}
                </Link>
              ) : (
                <div
                  className={`grid items-center gap-2 rounded-row p-2 ${tone}`}
                  style={{ gridTemplateColumns: tracks }}
                >
                  {cells}
                </div>
              )}
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
