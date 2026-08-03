import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { APP_URL, isEmailConfigured } from "@/lib/email/client";
import { getAllNotificationPreferences } from "@/lib/notifications/preferences";
import {
  NOTIFICATION_LABEL,
  NOTIFICATION_TYPES,
  mergePreferences,
  typesOn,
} from "@/lib/notifications/types";

/**
 * The notification digest: one email a day telling a person what is still
 * unread in their feed.
 *
 * Distinct from `notifyDailyDigest` in `lib/actions/notifications.ts`, which is
 * v1's day-at-a-glance and goes to a configured list of addresses. That one is
 * about the business — today's orders, shipping, returns, the snapshot. This
 * one is about *you*, and its contents differ per recipient, which is exactly
 * why it can't be a section bolted onto the other: a batch send of one HTML
 * body cannot be personal. Both run from `/api/cron/daily-digest`, in that
 * order, so there is still one job at one time of day.
 *
 * The HTML is built here rather than in `lib/email/templates.ts` on purpose:
 * that module is shared with every other cluster's mail, and a per-user layout
 * has no business in it while notifications are still landing.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Same frame as `lib/email/templates.ts`'s `baseLayout`, retyped because that
 * one isn't exported. Worth saying plainly: if a third module needs it, export
 * it from there rather than growing a second copy.
 */
function layout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; padding: 40px 0; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #18181b; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">VFXNow AMC</h1>
    </div>
    <div style="padding: 32px 24px;">
      ${content}
    </div>
    <div style="padding: 16px 24px; background: #f4f4f5; text-align: center; font-size: 12px; color: #71717a;">
      You are receiving this because the daily digest is switched on for your
      account. <a href="${APP_URL}/dashboard/settings/notifications" style="color: #71717a;">Change what you get</a>.
    </div>
  </div>
</body>
</html>`;
}

export type DigestItem = {
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  createdAt: Date;
};

export type NotificationDigest = { subject: string; html: string };

/**
 * Build one person's digest.
 *
 * Exported so it can be rendered and read without sending anything, which in
 * this instance is the only way to check it at all — `RESEND_API_KEY` is blank
 * and no mail leaves.
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
      (group) => `
      <h3 style="margin: 24px 0 8px; color: #18181b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em;">
        ${escapeHtml(NOTIFICATION_LABEL[group.type])} · ${group.rows.length}
      </h3>
      <table style="width: 100%; border-collapse: collapse;">
        ${group.rows
          .map((row) => {
            const label = escapeHtml(row.title);
            const body = escapeHtml(row.message);
            const cell = row.link
              ? `<a href="${APP_URL}${escapeHtml(row.link)}" style="color: #18181b; text-decoration: none; font-weight: 600;">${label}</a>`
              : `<span style="color: #18181b; font-weight: 600;">${label}</span>`;
            return `<tr><td style="padding: 8px 0; border-bottom: 1px solid #e4e4e7;">
              ${cell}
              <div style="color: #52525b; font-size: 13px; line-height: 1.5;">${body}</div>
            </td></tr>`;
          })
          .join("")}
      </table>`,
    )
    .join("");

  // The count is qualified in the sentence rather than left as a bare figure,
  // and the total is the truth: it is what the feed will show when they open it.
  const subject =
    items.length === 1
      ? "1 notification waiting in AMC"
      : `${items.length} notifications waiting in AMC`;

  return {
    subject,
    html: layout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Waiting for you</h2>
      <p style="color: #3f3f46; line-height: 1.6;">
        Hi ${escapeHtml(name.split(" ")[0])}, ${
          items.length === 1
            ? "one thing is"
            : `${items.length} things are`
        } still unread in your feed.
      </p>
      ${sections}
      <div style="text-align: center; margin: 28px 0 0;">
        <a href="${APP_URL}/dashboard/notifications" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          Open the feed
        </a>
      </div>
    `),
  };
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

  const stored = await getAllNotificationPreferences();
  const subscriberIds = [...stored.entries()]
    .filter(([, preferences]) => preferences.digest)
    .map(([userId]) => userId);

  run.subscribers = subscriberIds.length;
  if (subscriberIds.length === 0) return run;

  const users = await prisma.user.findMany({
    where: { id: { in: subscriberIds } },
    select: { id: true, name: true, email: true },
  });

  for (const user of users) {
    const preferences = mergePreferences(stored.get(user.id));
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
