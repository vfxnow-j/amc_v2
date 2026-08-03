"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { formatCount } from "@/lib/nav/counts";

/** Where the bell goes. Not in `lib/nav/clusters.ts` — see the feed screen. */
export const NOTIFICATIONS_HREF = "/dashboard/notifications";

/**
 * The bell in the user pod, and the feed's only entry point.
 *
 * A link, not a popover. A dropdown preview would be a second rendering of the
 * feed that has to agree with it, in a component that sits on every route in
 * the app — and the feed is one click away either way. This stays a link with a
 * number on it.
 *
 * Takes a plain `number | null`; nothing here reaches `lib/prisma`. The count is
 * fetched by `NotificationBellSlot`, a server component, and passed in. `null`
 * means "not counted yet" — the Suspense fallback the shell renders while that
 * query is in flight — and is drawn as a bell with no badge rather than a zero,
 * because a zero claims an empty feed we haven't looked at.
 */
export function NotificationBell({ count }: { count: number | null }) {
  const pathname = usePathname();
  const active = pathname === NOTIFICATIONS_HREF;
  const unread = count ?? 0;

  return (
    <Link
      href={NOTIFICATIONS_HREF}
      aria-current={active ? "page" : undefined}
      // The full figure lives here rather than in the badge, which caps at 99+.
      aria-label={
        count === null
          ? "Notifications"
          : count === 0
            ? "Notifications — nothing unread"
            : `Notifications — ${formatCount(count)} unread`
      }
      className={`relative flex-none rounded-tile p-1 transition-colors duration-200 hover:bg-row-hover hover:text-ink ${
        active ? "bg-row-hover text-ink" : "text-ink-faint"
      }`}
    >
      <Bell className="size-4" aria-hidden />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute -right-[3px] -top-[3px] min-w-[15px] rounded-pill bg-accent-solid px-[3px] text-center text-[9px] font-bold leading-[15px] text-accent-on-solid"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
