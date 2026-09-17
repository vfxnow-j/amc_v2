import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { APP_URL, isEmailConfigured } from "@/lib/email/client";
import { cell, email, escapeHtml, paragraph, section, table } from "@/lib/email/layout";
import { getAllNotificationPreferences } from "@/lib/notifications/preferences";
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_LABEL,
  NOTIFICATION_TYPES,
  typesOn,
} from "@/lib/notifications/types";

/**
 * The notification digest: one email a day telling a person what is still
 * unread in their feed.
 *
 * Distinct from `notifyDailyDigest`, which is v1's day-at-a-glance and goes to
 * a configured list of addresses. That one is about the business — today's
 * orders, shipping, returns, the snapshot. This one is about *you*, and its
 * contents differ per recipient, which is exactly why it can't be a section
 * bolted onto the other: a batch send of one HTML body cannot be personal.
 *
 * Drawn in the shared layout (`lib/email/layout`). It used to retype that
 * layout's predecessor because it wasn't exported; the only real difference
 * was the footer, which is now an option.
 */

export type DigestItem = {
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  createdAt: Date;
};

export type NotificationDigest = { subject: string; html: string; text: string };

/**
 * Build one person's digest.
 *
 * Exported so it can be rendered and read without sending anything.
 */
export function notificationDigestEmail(
  name: string,
  items: DigestItem[],
): NotificationDigest {
  const grouped = NOTIFICATION_TYPES.map((type) => ({
    type,
    rows: items.filter((item) => item.type === type),
  })).filter((group) => group.rows.length > 0);

  const sections = grouped
    .map(
      (group) =>
        section(NOTIFICATION_LABEL[group.type], String(group.rows.length)) +
        table(
          [{ label: "What" }],
          group.rows.map((row) => [
            cell(row.title, row.link ? { href: row.link, sub: row.message } : { bold: true, sub: row.message }),
          ]),
        ),
    )
    .join("");

  // The count is qualified in the sentence rather than left as a bare figure,
  // and the total is the truth: it is what the feed will show when they open it.
  const subject =
    items.length === 1
      ? "1 notification waiting in AMC"
      : `${items.length} notifications waiting in AMC`;

  return email(subject, {
    audience: "staff",
    preheader: grouped
      .map((group) => `${group.rows.length} ${NOTIFICATION_LABEL[group.type].toLowerCase()}`)
      .join(" · "),
    eyebrow: "Your digest",
    title: "Waiting for you",
    body:
      paragraph(
        `Hi ${escapeHtml(name.split(" ")[0])}, ${
          items.length === 1 ? "one thing is" : `${items.length} things are`
        } still unread in your feed.`,
      ) + sections,
    cta: { label: "Open the feed", url: "/dashboard/notifications" },
    footer: `You get this because the daily digest is switched on for your account. <a href="${escapeHtml(
      `${APP_URL}/dashboard/settings/notifications`,
    )}" style="color:#55606a;text-decoration:underline;">Change what you get</a>.`,
  });
}

export type DigestRun = {
  /** Users whose digest was handed to the mailer. */
  sent: number;
  /** Opted in, but with an empty feed — no mail, because there is nothing to say. */
  nothingToSay: number;
  /** Handed over but rejected, almost always because no key is configured. */
  failed: number;
  /** Users with the digest switched on at all. */
  subscribers: number;
};

/**
 * Send every subscriber their digest.
 *
 * Three deliberate properties:
 *
 * - **Opt-in.** Only users whose stored preferences say `digest: true`. Nine
 *   restored accounts do not get signed up by a deployment.
 * - **Nothing to say means nothing sent.** A daily email that regularly says
 *   "you have 0 notifications" trains people to filter it, and then they miss
 *   the one that mattered.
 * - **Per-recipient bodies**, so `email`-muted types are absent from that
 *   person's digest while still sitting in their feed. Which means one send per
 *   user rather than a batch — with a handful of subscribers that is the right
 *   trade, and `sendEmail` already degrades gracefully when there is no key.
 */
export async function sendNotificationDigests(): Promise<DigestRun> {
  const run: DigestRun = {
    sent: 0,
    nothingToSay: 0,
    failed: 0,
    subscribers: 0,
  };

  // Already merged against the defaults by `getAllNotificationPreferences`, so
  // these are complete objects — kept keyed rather than reduced to ids, because
  // the loop below needs the preferences again and re-merging them there was
  // doing the same work twice.
  const subscribers = new Map(
    [...(await getAllNotificationPreferences())].filter(
      ([, preferences]) => preferences.digest,
    ),
  );

  run.subscribers = subscribers.size;
  if (subscribers.size === 0) return run;

  const users = await prisma.user.findMany({
    where: { id: { in: [...subscribers.keys()] } },
    select: { id: true, name: true, email: true },
  });

  for (const user of users) {
    // Every user here came out of the map, so the fallback is unreachable —
    // it is there to keep the type honest without an assertion.
    const preferences = subscribers.get(user.id) ?? DEFAULT_PREFERENCES;
    const wanted = typesOn(preferences, "email");
    if (wanted.length === 0) {
      run.nothingToSay += 1;
      continue;
    }

    const items = await prisma.notification.findMany({
      where: { userId: user.id, read: false, type: { in: wanted } },
      orderBy: { createdAt: "desc" },
      select: {
        type: true,
        title: true,
        message: true,
        link: true,
        createdAt: true,
      },
    });

    if (items.length === 0) {
      run.nothingToSay += 1;
      continue;
    }

    const template = notificationDigestEmail(user.name, items);
    const { success } = await sendEmail({
      to: user.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (success) run.sent += 1;
    else run.failed += 1;
  }

  return run;
}

/** Surfaced in the cron response so a zero send is never mistaken for a fault. */
export function emailConfigured(): boolean {
  return isEmailConfigured();
}
