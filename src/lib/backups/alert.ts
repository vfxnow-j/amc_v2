import "server-only";
import { isEmailConfigured } from "@/lib/email/client";
import { appUrl, bullets, email, escapeHtml, paragraph } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { prisma } from "@/lib/prisma";
import { readBackupFiles } from "./read";
import { assessBackup, assessVerify, dueAlerts, problemsFrom } from "./status";

const STATE_KEY = "backup_alert_state";

/**
 * Tell the super admins when backups are not healthy, once per distinct problem
 * per 24 hours. Called from the hourly reports cron. Goes through sendEmail, so
 * the test redirect and subject tag apply like every other message; the
 * "already told them" record is one row in the existing `settings` table.
 */
export async function alertOnBackupProblems(now: Date = new Date()): Promise<{ problems: number; sent: number; skipped?: string }> {
  const { status, verify } = await readBackupFiles();
  const problems = problemsFrom(assessBackup(status, now), assessVerify(verify, now));

  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY }, select: { value: true } });
  const sent = ((row?.value as { sent?: Record<string, string> } | null)?.sent ?? {}) as Record<string, string>;
  const { send, next } = dueAlerts(problems, sent, now);

  if (send.length > 0) {
    if (!isEmailConfigured()) return { problems: problems.length, sent: 0, skipped: "email-off" };
    const admins = await prisma.user.findMany({ where: { role: "SUPER_ADMIN" }, select: { email: true } });
    const to = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (to.length === 0) return { problems: problems.length, sent: 0, skipped: "no-recipients" };

    const message = email("Backup problem on VFXnow", {
      preheader: send[0].text,
      eyebrow: "Backups",
      title: "Backups need attention",
      body:
        paragraph("The scheduled backup check found:") +
        bullets(send.map((p) => escapeHtml(p.text))) +
        paragraph("Entity ledger rows cannot be edited, so a backup is the only way back. Run the backup and the restore test on the server, or check the cron schedule.", { muted: true }),
      cta: { label: "Open Settings → Entities", url: appUrl("/dashboard/settings/entities") },
      audience: "staff",
    });
    const results = await Promise.all(to.map((address) => sendEmail({ to: address, ...message })));
    if (!results.some((r) => r.success)) return { problems: problems.length, sent: 0, skipped: "send-failed" };
  }

  const changed = JSON.stringify(next) !== JSON.stringify(sent);
  if (changed) {
    await prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: { sent: next } },
      update: { value: { sent: next } },
    });
  }
  return { problems: problems.length, sent: send.length };
}
