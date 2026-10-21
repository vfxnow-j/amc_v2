"use server";

import { requireAdmin } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured } from "@/lib/email/client";
import { sendBtrReportTo } from "@/lib/notifications/reports/btr";

export type BtrSendOutcome = { ok: boolean; message: string };

/**
 * Mail the BT Report to one address — the signed-in admin's own unless another
 * is typed. Not tied to the BTR recipient tick: this is "send me a copy".
 * The test redirect still applies inside `sendEmail`.
 */
export async function sendBtrToAddress(typed: string): Promise<BtrSendOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { ok: false, message: auth.error };

  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
  const to = typed.trim() || me?.email || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, message: "That doesn't look like an email address." };
  if (!isEmailConfigured()) return { ok: false, message: "Nothing sent: RESEND_API_KEY is not set on this instance." };

  try {
    const result = await sendBtrReportTo(to);
    if (result.sent === 0) return { ok: false, message: result.error ?? "Nothing was sent." };
    return { ok: true, message: `Sent to ${to}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "That did not send." };
  }
}
