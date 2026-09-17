"use server";

import { refresh } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import { APP_URL, EMAIL_FROM, isEmailConfigured } from "@/lib/email/client";
import { sendEmail } from "@/lib/email/send";
import { layoutSpecimenEmail } from "@/lib/email/templates";
import { logAudit } from "@/lib/actions/audit";
import { RECIPIENTS_KEY, saveRecipients, type RecipientInput } from "@/lib/notifications/recipients";
import { RECIPIENT_CATEGORIES } from "@/lib/notifications/recipients-schema";
import { REPORTS, isReportKey } from "@/lib/notifications/reports/registry";
import { runReportNow, saveSchedule, type ReportSchedule } from "@/lib/notifications/reports/run";
import { describeSchedule } from "@/lib/notifications/reports/schedule";

/**
 * What Settings → Notifications writes on the company's behalf: the test send,
 * the recipient list, report schedules and "Send now".
 *
 * Kept apart from `notification-feed.ts` (a user's own feed and preferences)
 * and from `notifications.ts` (v1's senders). Every export here is a public
 * POST endpoint whatever the screen does, so every one re-checks for an admin
 * session itself — the screen hiding a card from STAFF is presentation, not
 * the guard.
 *
 * Only async functions are exported: a `"use server"` module that exports a
 * const passes tsc and dev, then fails `next build`.
 */

export type ActionOutcome = { ok: boolean; message: string } | null;

function describeRedirect(): string | null {
  return process.env.EMAIL_TEST_REDIRECT?.trim() || null;
}

/**
 * Send the layout specimen.
 *
 * To the address typed, or to the signed-in admin when blank. Either way it
 * goes through `sendEmail`, so the test redirect applies — on this instance the
 * message lands with the redirect address and names the typed one in its
 * banner. The outcome says which, so nobody watches the wrong inbox.
 */
export async function sendTestEmailAction(
  _previous: ActionOutcome,
  form: FormData,
): Promise<ActionOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, message: auth.error };

  const me = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { name: true, email: true },
  });
  const typed = String(form.get("to") ?? "").trim();
  const to = typed || me?.email || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, message: "That doesn't look like an email address." };
  }
  if (!isEmailConfigured()) {
    return {
      ok: false,
      message: "Nothing sent: RESEND_API_KEY is not set on this instance.",
    };
  }

  const redirect = describeRedirect();
  const message = layoutSpecimenEmail({
    sentBy: me?.name ?? "an administrator",
    sentAt: new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "medium",
      timeStyle: "short",
    }),
    appUrl: APP_URL,
    from: EMAIL_FROM,
    redirect,
  });

  const result = await sendEmail({ to, ...message });
  refresh();

  if (!result.success) {
    return { ok: false, message: `Resend refused it: ${result.error ?? "unknown error"}` };
  }
  return {
    ok: true,
    message: redirect
      ? `Sent. It was redirected to ${redirect} (the test redirect is on), with a banner naming ${to}.`
      : `Sent to ${to}.`,
  };
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * Save the recipient list from the editor.
 *
 * Takes the whole list as JSON rather than FormData because it is a grid —
 * rows added and removed client-side — and validates every row server-side in
 * `saveRecipients`, which also keeps keys this version doesn't know.
 */
export async function saveRecipientsAction(rows: RecipientInput[]): Promise<{ ok: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, message: auth.error };
  if (!Array.isArray(rows)) return { ok: false, message: "Nothing to save." };

  const clean: RecipientInput[] = rows.map((row) => ({
    email: String(row?.email ?? ""),
    name: typeof row?.name === "string" ? row.name : undefined,
    categories: Object.fromEntries(
      RECIPIENT_CATEGORIES.map((category) => [category, row?.categories?.[category] === true]),
    ),
  }));

  const result = await saveRecipients(clean);
  if (!result.ok) return { ok: false, message: result.error };

  await logAudit({
    action: "UPDATE",
    entityType: "Settings",
    entityId: RECIPIENTS_KEY,
    newValues: { recipients: clean.map((row) => row.email) },
    userId: auth.userId,
  });
  refresh();
  return { ok: true, message: `Saved ${result.saved} ${result.saved === 1 ? "address" : "addresses"}.` };
}

// ---------------------------------------------------------------------------
// Report schedules and Send now
// ---------------------------------------------------------------------------

export async function saveReportScheduleAction(
  _previous: ActionOutcome,
  form: FormData,
): Promise<ActionOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, message: auth.error };

  const key = form.get("report");
  if (!isReportKey(key)) return { ok: false, message: "Unknown report." };

  const schedule: ReportSchedule = {
    enabled: form.get("enabled") !== null,
    frequency: String(form.get("frequency")) as ReportSchedule["frequency"],
    dayOfWeek: Number(form.get("dayOfWeek")),
    dayOfMonth: Number(form.get("dayOfMonth")),
    hour: Number(form.get("hour")),
  };
  if (key === "inventory") {
    const title = String(form.get("title") ?? "").trim();
    Object.assign(schedule, {
      horizonDays: Math.min(90, Math.max(1, Number(form.get("horizonDays")) || 14)),
      maxEmailRows: Math.min(300, Math.max(5, Number(form.get("maxEmailRows")) || 40)),
      attachPdf: form.get("attachPdf") !== null,
      title: title.slice(0, 80) || REPORTS.inventory.defaults.title,
    });
  }

  const saved = await saveSchedule(key, schedule);
  refresh();
  return { ok: true, message: `Saved. ${describeSchedule(saved)}` };
}

export async function sendReportNowAction(
  _previous: ActionOutcome,
  form: FormData,
): Promise<ActionOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, message: auth.error };

  const key = form.get("report");
  if (!isReportKey(key)) return { ok: false, message: "Unknown report." };

  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
  const result = await runReportNow(key, me?.name ?? auth.userId);
  refresh();

  if (result.skipped === "no-recipients") {
    return { ok: false, message: `Nobody is ticked for ${REPORTS[key].label.toLowerCase()} — add a recipient first.` };
  }
  if (result.skipped === "nothing-to-report") {
    return { ok: true, message: "Nothing to report right now, so nothing was sent." };
  }
  if (result.sent === 0) {
    return { ok: false, message: `Not sent: ${result.error ?? "unknown error"}` };
  }
  const redirect = describeRedirect();
  const partial = result.sent < result.recipients ? ` (${result.recipients - result.sent} failed: ${result.error})` : "";
  return {
    ok: true,
    message: `Sent to ${result.sent} of ${result.recipients}${partial}.${redirect ? ` All redirected to ${redirect}.` : ""}`,
  };
}
