"use server";

import { refresh } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import { APP_URL, EMAIL_FROM, isEmailConfigured } from "@/lib/email/client";
import { sendEmail } from "@/lib/email/send";
import { layoutSpecimenEmail } from "@/lib/email/templates";

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
