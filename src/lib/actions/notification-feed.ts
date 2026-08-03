"use server";

import { refresh } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-utils";
import { saveNotificationPreferences } from "@/lib/notifications/preferences";
import {
  NOTIFICATION_TYPES,
  mergePreferences,
  type NotificationPreferences,
  type TypePreference,
} from "@/lib/notifications/types";

/**
 * What the notification feed and the preferences screen write.
 *
 * Kept apart from `lib/actions/notifications.ts`, which is v1's outbound-email
 * module and is about telling *clients* things. This file is about the in-app
 * feed. They share a noun and nothing else.
 *
 * Every action re-derives the user from the session and scopes the write to
 * them. Per next/docs "Server Actions", an action is a public POST endpoint
 * whatever the UI does — taking a notification id from the client is fine, but
 * taking whose notification it is would let anyone mark anyone's feed read.
 *
 * `refresh()` rather than `revalidatePath()`: none of these reads are cached, so
 * there is nothing to invalidate. What is needed is a re-render of the current
 * route, which per next/docs re-renders the layout too — and the bell lives in
 * the layout, so marking something read has to move the badge in the same
 * roundtrip or the two disagree on screen.
 */

export async function markNotificationRead(id: string): Promise<void> {
  const auth = await requireAuth();
  if (!auth.authorized || !auth.userId) throw new Error(auth.error);

  // `updateMany` with the owner in the filter, not `update` by id: an id that
  // belongs to somebody else updates nothing rather than throwing, which is the
  // correct answer to a request that should never have been made.
  await prisma.notification.updateMany({
    where: { id, userId: auth.userId, read: false },
    data: { read: true },
  });

  refresh();
}

export async function markNotificationUnread(id: string): Promise<void> {
  const auth = await requireAuth();
  if (!auth.authorized || !auth.userId) throw new Error(auth.error);

  await prisma.notification.updateMany({
    where: { id, userId: auth.userId, read: true },
    data: { read: false },
  });

  refresh();
}

/**
 * Clear the whole feed.
 *
 * Scoped to the user and nothing else — in particular it does not respect the
 * per-type mutes, because "mark all read" said all. Leaving muted-but-unread
 * rows behind would mean the bell still showed a number the moment they were
 * unmuted, for things the user had already declared done with.
 */
export async function markAllNotificationsRead(): Promise<number> {
  const auth = await requireAuth();
  if (!auth.authorized || !auth.userId) throw new Error(auth.error);

  const { count } = await prisma.notification.updateMany({
    where: { userId: auth.userId, read: false },
    data: { read: true },
  });

  refresh();
  return count;
}

/**
 * Save the preferences form.
 *
 * A `FormData` payload, so the screen works as a plain form: an unchecked box
 * is simply absent, which is why every switch is read as "is the key present"
 * rather than parsed from a value.
 *
 * Shaped for `useActionState` — previous state first, a message back — so the
 * screen can say it saved. Without that the only evidence of a save is that
 * nothing moved, and a settings screen that gives no acknowledgement gets
 * clicked twice by everyone.
 */
export async function saveNotificationPreferencesAction(
  _previous: string | null,
  form: FormData,
): Promise<string> {
  const auth = await requireAuth();
  if (!auth.authorized || !auth.userId) throw new Error(auth.error);

  const types = {} as Record<string, TypePreference>;
  for (const type of NOTIFICATION_TYPES) {
    types[type] = {
      inApp: form.get(`inApp:${type}`) !== null,
      email: form.get(`email:${type}`) !== null,
    };
  }

  const preferences: NotificationPreferences = mergePreferences({
    digest: form.get("digest") !== null,
    types,
  });

  await saveNotificationPreferences(auth.userId, preferences);

  refresh();
  return "Saved.";
}
