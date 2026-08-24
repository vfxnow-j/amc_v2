import { prisma } from "@/lib/prisma";
import {
  mergePreferences,
  type NotificationPreferences,
} from "@/lib/notifications/types";

/**
 * Where a user's notification preferences are kept.
 *
 * In the `Setting` key/value table, one row per user, rather than in a new
 * model. Two reasons, and the second is the stronger one:
 *
 * 1. `Setting` is already how this app stores notification configuration —
 *    `notification_recipients` (the digest's address list, ported from v1) is a
 *    row in the same table. A second, differently-shaped store for the same
 *    concept is the "parallel system" the plan warns against.
 * 2. v2 has no migrations directory; the schema is pushed. Adding a model means
 *    a push against the restored database and a dev-server restart — every
 *    query 500s with "Cannot read properties of undefined" until the running
 *    server picks up the regenerated client. With other agents building against
 *    the same server, that cost is not worth a table holding one small object
 *    per user.
 *
 * The trade-off, stated plainly: this is unindexed and unjoinable. Reading the
 * preferences of every user, as the digest does, is a `startsWith` scan of the
 * settings table. There are nine users. If that ever stops being true, this
 * becomes a `NotificationPreference` model and the read shape does not change.
 */

const PREFIX = "notification_prefs:";

function keyFor(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** One user's preferences, defaults filled in. Never throws, never returns null. */
export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const setting = await prisma.setting.findUnique({
    where: { key: keyFor(userId) },
    select: { value: true },
  });

  return mergePreferences(setting?.value);
}

/**
 * Every user's preferences in one read, keyed by user id.
 *
 * Users who have never opened the settings screen have no row and so are absent
 * from the map — callers merge the defaults themselves rather than this
 * inventing entries for people it hasn't been told about.
 */
export async function getAllNotificationPreferences(): Promise<
  Map<string, NotificationPreferences>
> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });

  return new Map(
    rows.map((row) => [
      row.key.slice(PREFIX.length),
      mergePreferences(row.value),
    ]),
  );
}

export async function saveNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences,
): Promise<void> {
  // Normalized on the way in as well as the way out, so a hand-edited row can
  // never leave a type missing.
  const value = mergePreferences(preferences);

  await prisma.setting.upsert({
    where: { key: keyFor(userId) },
    update: { value },
    create: { key: keyFor(userId), value },
  });
}
