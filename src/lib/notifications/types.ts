import type { NotificationType } from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";

/**
 * The notification vocabulary: what each `NotificationType` means, what raises
 * it, and what a user has said they want done about it.
 *
 * A plain module on purpose. Everything here is a const map, and a `"use server"`
 * file may only export async functions — exporting these from
 * `lib/actions/notifications.ts` typechecks, lints and runs in dev, then fails
 * the production build with "A 'use server' file can only export async
 * functions, found object." Same reasoning as `lib/service/statuses.ts`.
 *
 * It is also Prisma-value-free (the `NotificationType` import is a type-only
 * import), so the preferences form and the bell — both client components — can
 * read the labels without dragging the pg driver into the browser bundle.
 */

/**
 * Display order, which is roughly urgency order: the two that mean something is
 * physically or financially late come first, the two expiry warnings next, and
 * the housekeeping ones last.
 */
export const NOTIFICATION_TYPES: NotificationType[] = [
  "OVERDUE_RETURN",
  "INVOICE_REMINDER",
  "APPROVAL_REQUEST",
  "COVERAGE_EXPIRING",
  "WARRANTY_EXPIRING",
  "SYSTEM",
];

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  OVERDUE_RETURN: "Overdue returns",
  INVOICE_REMINDER: "Unpaid invoices",
  APPROVAL_REQUEST: "Approvals waiting on you",
  COVERAGE_EXPIRING: "Coverage expiring",
  WARRANTY_EXPIRING: "Warranty expiring",
  SYSTEM: "System",
};

/** The one-word form, for the feed's leading column. Must fit 110px at 12px. */
export const NOTIFICATION_TAG: Record<NotificationType, string> = {
  OVERDUE_RETURN: "Overdue",
  INVOICE_REMINDER: "Invoice",
  APPROVAL_REQUEST: "Approval",
  COVERAGE_EXPIRING: "Coverage",
  WARRANTY_EXPIRING: "Warranty",
  SYSTEM: "System",
};

/**
 * What actually raises each one, in the words of the rule in `raise.ts`.
 *
 * Shown on the preferences screen and in the feed's empty state, because a
 * toggle whose trigger you can't see is a toggle nobody dares turn off.
 */
export const NOTIFICATION_TRIGGER: Record<NotificationType, string> = {
  OVERDUE_RETURN:
    "An order is holding units past their return date. Goes to whoever checked them out.",
  INVOICE_REMINDER:
    "An invoice is unsettled and past its due date. Goes to admins.",
  APPROVAL_REQUEST:
    "A checkout is waiting on your approval. Goes to the named approver only.",
  COVERAGE_EXPIRING:
    "A service coverage ends within 30 days. Goes to admins.",
  WARRANTY_EXPIRING:
    "A unit's warranty ends within 30 days. Goes to admins.",
  SYSTEM: "Anything the platform itself needs to tell you. Rare, never routine.",
};

/** Per-type switches. Two channels, because there are two places mail lands. */
export type TypePreference = {
  /** Shows in the bell count and the feed. */
  inApp: boolean;
  /** Included in the daily digest email, if the user takes the digest at all. */
  email: boolean;
};

export type NotificationPreferences = {
  /**
   * Whether this user is sent the daily digest. Opt-in, and separate from the
   * per-type email switches: those shape what is *in* their digest, this is
   * whether one is addressed to them at all. Defaulting it on would sign nine
   * restored accounts up for mail nobody asked for.
   */
  digest: boolean;
  types: Record<NotificationType, TypePreference>;
};

/**
 * What a user gets before they've chosen anything: everything in the feed,
 * nothing in their inbox.
 *
 * In-app is on by default because a notification nobody sees is worse than one
 * they mute; email is governed by `digest`, which is off, so the per-type email
 * switches start on and simply have no effect until the digest is taken.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  digest: false,
  types: {
    OVERDUE_RETURN: { inApp: true, email: true },
    INVOICE_REMINDER: { inApp: true, email: true },
    APPROVAL_REQUEST: { inApp: true, email: true },
    COVERAGE_EXPIRING: { inApp: true, email: true },
    WARRANTY_EXPIRING: { inApp: true, email: true },
    SYSTEM: { inApp: true, email: false },
  },
};

export const isNotificationType = oneOf(NOTIFICATION_TYPES);

/**
 * Read a stored preference blob back into a complete object.
 *
 * Merged against the defaults rather than trusted wholesale: the value comes
 * out of a `Json` column that a previous version of this app wrote, so a type
 * added to the enum later must arrive with a default rather than as
 * `undefined` — which would read as "muted" at every call site that asks
 * `prefs.types[type].inApp`.
 */
export function mergePreferences(raw: unknown): NotificationPreferences {
  const stored = (raw ?? {}) as Partial<NotificationPreferences>;
  const storedTypes = (stored.types ?? {}) as Partial<
    Record<NotificationType, Partial<TypePreference>>
  >;

  const types = {} as Record<NotificationType, TypePreference>;
  for (const type of NOTIFICATION_TYPES) {
    const fallback = DEFAULT_PREFERENCES.types[type];
    const saved = storedTypes[type];
    types[type] = {
      inApp: typeof saved?.inApp === "boolean" ? saved.inApp : fallback.inApp,
      email: typeof saved?.email === "boolean" ? saved.email : fallback.email,
    };
  }

  return {
    digest:
      typeof stored.digest === "boolean"
        ? stored.digest
        : DEFAULT_PREFERENCES.digest,
    types,
  };
}

/** The types this user wants on a given channel. Empty means "mute the lot". */
export function typesOn(
  preferences: NotificationPreferences,
  channel: keyof TypePreference,
): NotificationType[] {
  return NOTIFICATION_TYPES.filter((type) => preferences.types[type][channel]);
}

/**
 * Feed sub-views. Unread leads because the feed's job is "what haven't I dealt
 * with"; All exists so a notification that was read can still be found again.
 */
export const FEED_VIEWS = ["unread", "all"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export const FEED_VIEW_LABEL: Record<FeedView, string> = {
  unread: "Unread",
  all: "All",
};

export const isFeedView = oneOf(FEED_VIEWS);
