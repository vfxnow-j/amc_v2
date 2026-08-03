import Link from "next/link";
import { Check } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notification-feed";
import { NOTIFICATION_TAG } from "@/lib/notifications/types";
import type { FeedRow } from "@/lib/queries/notifications";

/**
 * The feed's table.
 *
 * Written here rather than on `components/list/list-table.tsx`, and the reason
 * is one line of markup: a `ListTable` row is a single `<Link>` wrapping every
 * cell, which is exactly right for the twenty screens that use it and wrong for
 * this one. A notification row has two things to do — go to the thing, and
 * clear the thing — and a button inside an anchor is invalid HTML and unusable
 * with a keyboard. So the row is a grid holding a link and a form as siblings.
 *
 * Everything else follows the kit's rule verbatim: `text-colhead` heads, 30px
 * rows on a 2px gutter, alternating `bg-row-alt`, a qualified count in the
 * footer. Unread rows carry `bg-accent-tint`, the same tint an overdue order
 * gets on the Reservations hub — unread is precisely "someone must act".
 *
 * The clear control is a plain `<form>` posting a Server Action, so it works
 * with JavaScript off and is a real focusable button in the tab order.
 */

const TRACKS = "88px minmax(0,1fr) 64px 30px";

/** "4h", "3d", "6w" — a feed is read by recency, not by date. */
function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

export function FeedList({
  rows,
  total,
  page,
  pageSize,
  pages,
  hrefFor,
  mutedUnread,
  empty,
}: {
  rows: FeedRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  hrefFor: (page: number) => string;
  mutedUnread: number;
  empty: React.ReactNode;
}) {
  const now = new Date();
  const unread = rows.filter((row) => !row.read).length;

  if (rows.length === 0) {
    return (
      <section className="flex flex-1 flex-col rounded-card bg-panel p-[14px] shadow-sm">
        <p className="flex flex-1 items-center justify-center text-center text-body text-balance text-ink-muted">
          <span className="max-w-md">{empty}</span>
        </p>
      </section>
    );
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <div
        className="grid gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted"
        style={{ gridTemplateColumns: TRACKS }}
      >
        <span>Type</span>
        <span>Notification</span>
        <span>Age</span>
        <span className="sr-only">Clear</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {rows.map((row, index) => {
          const tone = !row.read
            ? "bg-accent-tint"
            : index % 2 === 1
              ? "bg-row-alt"
              : "";

          return (
            <li
              key={row.id}
              className={`grid items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${tone} hover:bg-row-hover`}
              style={{ gridTemplateColumns: TRACKS }}
            >
              <span className="truncate text-ink-muted">
                {NOTIFICATION_TAG[row.type]}
              </span>

              {/* The whole text column is the target, whether or not there's
                  somewhere to go — a row that is only sometimes clickable is
                  worse than one that never is. */}
              {row.link ? (
                <Link href={row.link} className="min-w-0 truncate">
                  <span className="font-bold">{row.title}</span>
                  <span className="text-ink-muted"> · {row.message}</span>
                </Link>
              ) : (
                <span className="min-w-0 truncate">
                  <span className="font-bold">{row.title}</span>
                  <span className="text-ink-muted"> · {row.message}</span>
                </span>
              )}

              <span className="truncate tabular-nums text-ink-muted">
                {ago(row.createdAt, now)}
              </span>

              {row.read ? (
                <span className="text-center text-ink-faint" title="Read">
                  ·
                </span>
              ) : (
                <form
                  action={async () => {
                    "use server";
                    await markNotificationRead(row.id);
                  }}
                >
                  <button
                    type="submit"
                    aria-label={`Mark "${row.title}" read`}
                    className="flex size-[22px] items-center justify-center rounded-tile text-ink-faint transition-colors duration-200 hover:bg-row-hover hover:text-ink"
                  >
                    <Check className="size-[13px]" aria-hidden />
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center gap-3 px-4 py-3 text-detail text-ink-muted">
        <span>
          {total <= rows.length
            ? `All ${total} shown`
            : `${first}–${last} of ${total} shown`}
          {unread > 0 ? <> · {unread} unread on this page</> : null}
          {/* A count that quietly excludes rows is a count people stop
              trusting, so the mute is stated rather than implied. */}
          {mutedUnread > 0 ? (
            <>
              {" "}
              ·{" "}
              <Link
                href="/dashboard/settings/notifications"
                className="text-accent-text hover:underline"
              >
                {mutedUnread} more held back by muted types
              </Link>
            </>
          ) : null}
        </span>

        <span className="ml-auto flex items-center gap-3">
          {pages > 1 ? (
            <>
              <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
                ← Previous
              </PageLink>
              <span>
                Page {page} of {pages}
              </span>
              <PageLink href={hrefFor(page + 1)} disabled={page >= pages}>
                Next →
              </PageLink>
            </>
          ) : null}
        </span>
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
  if (disabled) return <span className="text-ink-faint">{children}</span>;
  return (
    <Link href={href} className="hover:text-ink">
      {children}
    </Link>
  );
}

/**
 * "Mark all read", in the header. Says how many it would clear rather than
 * being a bare verb — a destructive-feeling button should state its blast
 * radius, and this one ignores mutes on purpose (see the action).
 */
export function MarkAllRead({ unread }: { unread: number }) {
  if (unread === 0) return null;

  return (
    <form
      action={async () => {
        "use server";
        await markAllNotificationsRead();
      }}
    >
      <button
        type="submit"
        className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
      >
        Mark {unread} read
      </button>
    </form>
  );
}
