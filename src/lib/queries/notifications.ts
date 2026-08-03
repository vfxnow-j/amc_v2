import { cache } from "react";
import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { typesOn, type FeedView } from "@/lib/notifications/types";

/** Reads behind the bell and the notification feed. */

export const PAGE_SIZE = 40;

/**
 * The number on the bell.
 *
 * The shell renders on every authenticated route, so this is the one query in
 * the app that runs on literally every page view. It is two indexed reads — a
 * `Setting` lookup by unique key and a count over `(userId, read)` — and no
 * joins, deliberately: the bell says how many, and the feed says what.
 *
 * Muted types are excluded here rather than at write time, so turning a type
 * back on brings its history back with it. `notIn: []` is a no-op in Prisma, so
 * the common case where nothing is muted costs nothing extra.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const preferences = await getNotificationPreferences(userId);
  const wanted = typesOn(preferences, "inApp");

  // Everything muted. Skip the count entirely rather than sending Prisma an
  // `in: []`, which is a query guaranteed to return zero.
  if (wanted.length === 0) return 0;

  return prisma.notification.count({
    where: { userId, read: false, type: { in: wanted } },
  });
}

export type FeedRow = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

export type Feed = {
  rows: FeedRow[];
  total: number;
  pageSize: number;
  /**
   * Types this user has muted that nonetheless have unread notifications
   * waiting. The feed says so in its footer: a count that silently excludes
   * rows is the kind of number people stop trusting.
   */
  mutedUnread: number;
};

export async function getNotificationFeed({
  userId,
  view,
  page,
}: {
  userId: string;
  view: FeedView;
  page: number;
}): Promise<Feed> {
  const preferences = await getNotificationPreferences(userId);
  const wanted = typesOn(preferences, "inApp");

  // Every type muted. The feed is empty by the user's own instruction, and it
  // says so — so the only figure still worth reading is how much is behind the
  // mute.
  if (wanted.length === 0) {
    return {
      rows: [],
      total: 0,
      pageSize: PAGE_SIZE,
      mutedUnread: await prisma.notification.count({
        where: { userId, read: false },
      }),
    };
  }

  const where = {
    userId,
    type: { in: wanted },
    ...(view === "unread" ? { read: false } : {}),
  };

  const [rows, total, mutedUnread] = await Promise.all([
    prisma.notification.findMany({
      where,
      // Newest first, and unread ahead of read on the All view — a fortnight-old
      // thing nobody has dealt with still outranks this morning's dismissal.
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        link: true,
        read: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { userId, read: false, type: { notIn: wanted } },
    }),
  ]);

  return { rows, total, pageSize: PAGE_SIZE, mutedUnread };
}

export type FeedCounts = Record<FeedView, number> & {
  /** Unread, but of a type this user has muted in-app. Never silently dropped. */
  mutedUnread: number;
};

/**
 * Counts for the feed's Unread / All strip, plus what the mute is hiding.
 *
 * Wrapped in React's `cache` because the feed screen asks for these three times
 * in one render — the header blurb, the "mark all read" button and the tab
 * strip all need the unread figure, and they are three separate Suspense
 * boundaries so none of them can be handed the others' result. Deduped per
 * request, not cached across requests: these numbers must never be stale.
 */
export const getFeedViewCounts = cache(
  async (userId: string): Promise<FeedCounts> => {
    const preferences = await getNotificationPreferences(userId);
    const wanted = typesOn(preferences, "inApp");

    if (wanted.length === 0) {
      return {
        unread: 0,
        all: 0,
        mutedUnread: await prisma.notification.count({
          where: { userId, read: false },
        }),
      };
    }

    const [unread, all, mutedUnread] = await Promise.all([
      prisma.notification.count({
        where: { userId, read: false, type: { in: wanted } },
      }),
      prisma.notification.count({ where: { userId, type: { in: wanted } } }),
      prisma.notification.count({
        where: { userId, read: false, type: { notIn: wanted } },
      }),
    ]);

    return { unread, all, mutedUnread };
  },
);
