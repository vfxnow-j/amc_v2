"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { checkRateLimit, resetRateLimit } from "@/lib/utils/rate-limit";
import { handoverShortfall } from "@/lib/orders/handover";
import {
  cleanReason,
  grantScanOverride,
  historyNote,
  overrideLabel,
  revokeScanOverride,
  shortfallLines,
  shortfallText,
  verifySuperAdmin,
  type OverrideMove,
} from "@/lib/orders/scan-override";
import { activateOrder, shipOrder, type StageOutcome } from "@/lib/actions/order-stage";
import { logAudit } from "@/lib/actions/audit";

/**
 * Ship or activate an order whose scan is incomplete, on a super admin's say-so.
 *
 * The scan gate (lib/orders/handover) is the owner's stop gap; this is the one
 * way past it, and it asks every time. The credentials are typed into the
 * dialog, so the signed-in person may be the super admin or may be carrying
 * the order while another super admin authorises on their own screen. Either
 * way nothing is remembered: no session is created, and the password is
 * compared and dropped, never logged or stored.
 *
 * Only the scan-completeness check is lifted. The move itself is the ordinary
 * `shipOrder` / `activateOrder`, so the status check, the history row, the
 * auto-invoice and every other guard run as they always do. Units that were
 * never scanned are left exactly as the normal path leaves them: this writes
 * no unit state at all.
 */

const FAILED = "Those credentials could not be verified, or the move is not allowed. Check them and try again.";

export async function moveWithoutScanning(
  id: string,
  move: OverrideMove,
  input: { email: string; password: string; reason: string },
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized || !auth.userId) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (move !== "ship" && move !== "activate") return { status: "error", message: FAILED };

  const actorId = auth.userId;
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  const reason = cleanReason(input.reason);
  if (!reason) return { status: "error", message: "Say why the scan is being skipped, in a sentence." };

  const fail = async (why: string) => {
    // Failed attempts are logged; the password never is.
    await logAudit({
      action: "REJECT",
      entityType: "Reservation",
      entityId: id,
      userId: actorId,
      newValues: {
        event: "SCAN_OVERRIDE_FAILED",
        summary: `Scan override refused (${why}) on ${overrideLabel(move).toLowerCase()} attempt`,
        move,
        attemptedEmail: email.slice(0, 200),
        reason,
      },
    }).catch(() => {});
    return { status: "error", message: FAILED } as StageOutcome;
  };

  // Per signed-in person and per account being tried, so neither a held-open
  // session nor a spray across accounts gets unlimited guesses.
  const byActor = checkRateLimit("scan-override", `actor:${actorId}`, 5, 15 * 60 * 1000);
  const byTarget = checkRateLimit("scan-override", `target:${email}`, 5, 15 * 60 * 1000);
  if (!byActor.allowed || !byTarget.allowed) return fail("rate limited");

  const outcome = await verifySuperAdmin(
    {
      findUserByEmail: (address) =>
        prisma.user.findUnique({
          where: { email: address },
          select: { id: true, name: true, email: true, role: true, passwordHash: true, disabledAt: true },
        }),
      compare: (plain, hash) => bcrypt.compare(plain, hash),
    },
    email,
    password,
  );
  if (!outcome.ok) return fail("credentials");

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
  const actorName = actor?.name ?? "Unknown";

  // The shortfall as it stands now, before the move changes anything.
  const lines = shortfallLines((await handoverShortfall(id)).missing);

  grantScanOverride(id, move);
  let result: StageOutcome;
  try {
    result = move === "ship" ? await shipOrder(id, {}) : await activateOrder(id);
  } finally {
    revokeScanOverride(id, move);
  }

  if (result.status !== "ok") {
    // Another guard held (wrong status, say). Nothing moved; say so in the log.
    await logAudit({
      action: "REJECT",
      entityType: "Reservation",
      entityId: id,
      userId: actorId,
      newValues: {
        event: "SCAN_OVERRIDE_NOT_APPLIED",
        summary: `Scan override authorised by ${outcome.admin.name} but the move did not happen: ${result.message}`,
        move,
        authorisedBy: outcome.admin,
        reason,
      },
    }).catch(() => {});
    return result;
  }

  resetRateLimit("scan-override", `actor:${actorId}`);
  resetRateLimit("scan-override", `target:${email}`);

  await logAudit({
    action: "OVERRIDE",
    entityType: "Reservation",
    entityId: id,
    userId: actorId,
    oldValues: { scanComplete: false },
    newValues: {
      event: "SCAN_OVERRIDE",
      summary: `${overrideLabel(move)}: authorised by super admin ${outcome.admin.name}, entered by ${actorName}. Reason: ${reason}. Not scanned: ${shortfallText(lines)}.`,
      move,
      actor: { id: actorId, name: actorName },
      authorisedBy: outcome.admin,
      reason,
      notScanned: lines,
    },
  }).catch(() => {});

  // Label it on the order's own history. The ported action wrote the row for
  // the move; the note goes on that row so the record reads as one event.
  const note = historyNote({ move, actor: actorName, admin: outcome.admin.name, reason, lines });
  try {
    const latest = await prisma.statusHistory.findFirst({
      where: {
        entityType: "RESERVATION",
        entityId: id,
        toStatus: move === "ship" ? "SHIPPED" : "ACTIVE",
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, notes: true },
    });
    if (latest) {
      await prisma.statusHistory.update({
        where: { id: latest.id },
        data: { notes: latest.notes ? `${note} ${latest.notes}` : note },
      });
    }
  } catch {
    /* the audit log above is the record of truth; the note is the convenience */
  }

  return { ...result, message: `${result.message} Scan skipped on ${outcome.admin.name}'s authority; it is in the history.` };
}
