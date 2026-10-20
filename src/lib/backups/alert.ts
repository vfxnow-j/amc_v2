import "server-only";
import { isEmailConfigured } from "@/lib/email/client";
import { appUrl, bullets, email, escapeHtml, paragraph } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { prisma } from "@/lib/prisma";
import { readBackupFiles } from "./read";
import { claimAlerts, type AlertStore } from "./claim";
import { assessBackup, assessVerify, problemsFrom } from "./status";

const STATE_KEY = "backup_alert_state";

/** The record lives in one `settings` row; `updatedAt` is its version for the compare-and-swap. */
const prismaStore: AlertStore = {
  async read() {
    const row = await prisma.setting.findUnique({ where: { key: STATE_KEY }, select: { value: true, updatedAt: true } });
    const sent = ((row?.value as { sent?: Record<string, string> } | null)?.sent ?? {}) as Record<string, string>;
    return { sent, version: row ? row.updatedAt.toISOString() : null };
  },
  async swap(version, next) {
    if (version === null) {
      try {
        await prisma.setting.create({ data: { key: STATE_KEY, value: { sent: next } } });
        return true;
      } catch {
        return false; // unique violation: another caller created it first
      }
    }
    const r = await prisma.setting.updateMany({
      where: { key: STATE_KEY, updatedAt: new Date(version) },
      data: { value: { sent: next } },
    });
    return r.count === 1;
  },
};

/**
 * Tell the super admins when backups are not healthy, once per distinct problem
 * per 24 hours. Called from the hourly reports cron. The "already told them"
 * record is claimed BEFORE sending, so overlapping cron calls or a failed write
 * cannot mail twice; the cost is that a failed send is not retried for 24 hours.
 * Goes through sendEmail, so the test redirect and subject tag apply.
 */
export async function alertOnBackupProblems(now: Date = new Date()): Promise<{ problems: number; sent: number; skipped?: string }> {
  const { status, verify } = await readBackupFiles();
  const backup = assessBackup(status, now);
  let problems = problemsFrom(backup, assessVerify(verify, now));
  // Nothing has ever run: one line says it; a second "no restore test" adds nothing.
  if (backup.state === "never") problems = problems.filter((p) => !p.key.startsWith("restore-test:"));

  if (problems.length > 0 && !isEmailConfigured()) return { problems: problems.length, sent: 0, skipped: "email-off" };
  const send = await claimAlerts(prismaStore, problems, now);
  if (send.length === 0) return { problems: problems.length, sent: 0 };

  const admins = await prisma.user.findMany({ where: { role: "SUPER_ADMIN", disabledAt: null }, select: { email: true } });
  const to = [...new Set(admins.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
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
  const result = await sendEmail({ to, ...message });
  return { problems: problems.length, sent: result.success ? send.length : 0, ...(result.success ? {} : { skipped: "send-failed" }) };
}
