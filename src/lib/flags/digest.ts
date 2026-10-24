import { isEmailConfigured } from "@/lib/email/client";
import { appUrl, bullets, email, paragraph } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { recipientsFor } from "@/lib/notifications/recipients";
import { prisma } from "@/lib/prisma";
import { digestLines, digestSubject } from "./digest-rules";
import { syncOpenOrders } from "./sync";

const STATE_KEY = "order_flag_digest_state";

/**
 * Run the nightly pass, then tell the reservations recipients what it found.
 *
 * The digest is every automatic flag raised since the last one went out and
 * still open, whoever raised it: an order page opened during the day raises its
 * own flags, and those belong in the morning's mail as much as the ones this
 * pass raised. "Since the last one" is a timestamp in one `settings` row,
 * advanced only after a send, so a failed or switched-off send is retried by
 * the next run instead of lost. Goes through `sendEmail`, so the test redirect
 * and subject tag apply.
 */
export async function runFlagSweep(now: Date = new Date()): Promise<{
  checked: number;
  raised: number;
  cleared: number;
  digest: { flags: number; sent: boolean; skipped?: string };
}> {
  const pass = await syncOpenOrders(now);

  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY }, select: { value: true } });
  const saved = (row?.value as { lastSentAt?: string } | null)?.lastSentAt;
  const since = saved ? new Date(saved) : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const flags = await prisma.orderFlag.findMany({
    where: { source: "SYSTEM", resolvedAt: null, raisedAt: { gt: since } },
    select: {
      reason: true,
      severity: true,
      reservation: { select: { reservationNumber: true, client: { select: { name: true } } } },
    },
  });

  const advance = () =>
    prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: { lastSentAt: now.toISOString() } },
      update: { value: { lastSentAt: now.toISOString() } },
    });

  if (flags.length === 0) {
    await advance();
    return { ...pass, digest: { flags: 0, sent: false } };
  }
  if (!isEmailConfigured()) return { ...pass, digest: { flags: flags.length, sent: false, skipped: "email-off" } };
  const to = await recipientsFor("reservations");
  if (to.length === 0) return { ...pass, digest: { flags: flags.length, sent: false, skipped: "no-recipients" } };

  const rows = flags.map((f) => ({
    orderNumber: f.reservation.reservationNumber,
    clientName: f.reservation.client.name,
    reason: f.reason,
    severity: f.severity,
  }));
  const message = email(digestSubject(rows), {
    preheader: digestLines(rows)[0],
    eyebrow: "Order flags",
    title: "Orders that need a person",
    body:
      paragraph("These orders were flagged automatically since the last digest:") +
      bullets(digestLines(rows)) +
      paragraph("Open each order to work its checklist and close the case with an outcome.", { muted: true }),
    cta: { label: "Open flagged orders", url: appUrl("/dashboard/orders?flag=flagged") },
    audience: "staff",
  });
  const result = await sendEmail({ to, ...message });
  if (!result.success) return { ...pass, digest: { flags: flags.length, sent: false, skipped: "send-failed" } };
  await advance();
  return { ...pass, digest: { flags: flags.length, sent: true } };
}
