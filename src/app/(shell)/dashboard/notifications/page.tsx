import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListTableSkeleton } from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { getSessionUser } from "@/lib/roles";
import {
  FEED_VIEWS,
  FEED_VIEW_LABEL,
  isFeedView,
  type FeedView,
} from "@/lib/notifications/types";
import {
  getFeedViewCounts,
  getNotificationFeed,
} from "@/lib/queries/notifications";
import { FeedList, MarkAllRead } from "./feed-list";

export const metadata = { title: "Notifications" };

/**
 * The notification feed.
 *
 * **Why it is not in the rail.** `lib/nav/clusters.ts` is the six-cluster
 * information architecture the whole design is built on, and every entry in it
 * is a view of the business: orders, units, invoices, accounts. This is a view
 * of *one person's* outstanding items — the same screen shows different rows to
 * two people sitting next to each other. Adding it as a seventh rail
 * destination would put a personal inbox in a structure that describes a
 * company. So it lives at a plain `/dashboard/notifications` and the bell in
 * the user pod is its entry point, which is also where every user has been
 * trained to look for it. The catch-all placeholder still serves every rail
 * path; a static route simply wins over it.
 *
 * Preferences are one further click, at `settings/notifications`, rather than a
 * panel on this screen: what you want to be told is account configuration, and
 * it sits with the other fourteen settings children rather than in the middle
 * of the thing you came here to clear.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const user = await getSessionUser();
  // The shell layout has already redirected an anonymous request; this is the
  // narrowing that lets the queries below take a real user id.
  if (!user) redirect("/login");

  const params = await searchParams;
  const view: FeedView = isFeedView(params.view) ? params.view : "unread";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Your feed"
        title="Notifications"
        blurb={
          <Suspense fallback="Counting…">
            <HeaderBlurb userId={user.id} />
          </Suspense>
        }
        actions={
          <>
            <Suspense fallback={null}>
              <HeaderActions userId={user.id} />
            </Suspense>
            <Link
              href="/dashboard/settings/notifications"
              className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
            >
              Preferences
            </Link>
          </>
        }
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={200} />}>
          <Tabs userId={user.id} view={view} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${page}`} fallback={<ListTableSkeleton />}>
        <Feed userId={user.id} view={view} page={page} />
      </Suspense>
    </>
  );
}

async function HeaderBlurb({ userId }: { userId: string }) {
  const { unread, all, mutedUnread } = await getFeedViewCounts(userId);

  // Muted rows are stated, never quietly excluded — a feed that says "nothing
  // has been raised" while holding items back is a feed that has lied to you.
  const muted =
    mutedUnread > 0 ? <> · {mutedUnread} more held back by muted types</> : null;

  if (all === 0) {
    return (
      <>
        {mutedUnread > 0
          ? "Nothing reaches this feed on your current settings"
          : "Nothing has been raised for you yet"}
        {muted}
      </>
    );
  }

  return (
    <>
      {unread === 0 ? (
        <>All {all} cleared</>
      ) : (
        <>
          <span className="text-accent-text">{unread} unread</span> of {all}
        </>
      )}
      {muted} · raised daily by the 9am sweep
    </>
  );
}

async function HeaderActions({ userId }: { userId: string }) {
  const { unread } = await getFeedViewCounts(userId);
  return <MarkAllRead unread={unread} />;
}

async function Tabs({ userId, view }: { userId: string; view: FeedView }) {
  const counts = await getFeedViewCounts(userId);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="unread"
      label="Feed views"
      options={FEED_VIEWS.map((option) => ({
        value: option,
        label: FEED_VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function Feed({
  userId,
  view,
  page,
}: {
  userId: string;
  view: FeedView;
  page: number;
}) {
  const { rows, total, pageSize, mutedUnread } = await getNotificationFeed({
    userId,
    view,
    page,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const query = new URLSearchParams();
    if (view !== "unread") query.set("view", view);
    if (next > 1) query.set("page", String(next));
    const search = query.toString();
    return search
      ? `/dashboard/notifications?${search}`
      : "/dashboard/notifications";
  }

  return (
    <FeedList
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      pages={pages}
      hrefFor={hrefFor}
      mutedUnread={mutedUnread}
      empty={
        // Never "No data". Each of these names what would put something here,
        // because an empty feed is indistinguishable from a broken one
        // otherwise — and this table has been empty since v1 shipped it.
        mutedUnread > 0 && total === 0 ? (
          <>
            {mutedUnread} unread {mutedUnread === 1 ? "item is" : "items are"}{" "}
            waiting, all of a type you have muted, so none of them reach this
            feed.{" "}
            <Link
              href="/dashboard/settings/notifications"
              className="text-accent-text hover:underline"
            >
              Turn a type back on
            </Link>{" "}
            and its history comes back with it.
          </>
        ) : view === "unread" ? (
          <>
            Nothing waiting. An order holding units past their return date, an
            invoice gone past due, or a checkout needing your sign-off will turn
            up here — the sweep looks once a day.
          </>
        ) : (
          <>
            Nothing has been raised for you. This feed fills from five checks run
            daily: overdue returns, invoices past due, approvals waiting on you,
            and service coverage or warranty about to lapse.
          </>
        )
      }
    />
  );
}
