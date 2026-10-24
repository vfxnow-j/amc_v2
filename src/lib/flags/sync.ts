import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import { loadOrderAutoFacts } from "@/lib/queries/order-flag-facts";
import { reasonByCode } from "@/lib/flags/catalog";
import { autoRaiseDecisions } from "@/lib/flags/rules";

/**
 * Raise or clear the system flags on one order. Server-only, and deliberately
 * not a server action: the order page calls it while rendering (where
 * revalidatePath is not allowed) and the nightly script calls it with no session.
 *
 * A SYSTEM flag is never closed by a person, so clearing needs no outcome. The
 * database cannot enforce one open flag per rule (a nullable column in a unique
 * index does not constrain in Postgres), so duplicates are avoided here by
 * looking before creating.
 */
export async function syncAutoFlagsCore(
  reservationId: string,
  now: Date = new Date(),
): Promise<{ raised: string[]; cleared: string[] }> {
  const facts = await loadOrderAutoFacts(reservationId);
  if (!facts) return { raised: [], cleared: [] };

  const open = await prisma.orderFlag.findMany({
    where: { reservationId, source: "SYSTEM", resolvedAt: null, ruleKey: { not: null } },
    select: { id: true, ruleKey: true },
  });
  const { raise, clear } = autoRaiseDecisions(
    facts,
    open.map((f) => ({ ruleKey: f.ruleKey as string })),
    now,
  );

  for (const key of raise) {
    const reason = reasonByCode(key);
    if (!reason) continue;
    await prisma.orderFlag.create({
      data: {
        reservationId,
        category: reason.category,
        reason: reason.code,
        severity: reason.severity,
        source: "SYSTEM",
        ruleKey: key,
        steps: { create: reason.playbook.map((label, position) => ({ position, label })) },
      },
    });
  }
  for (const key of clear) {
    await prisma.orderFlag.updateMany({
      where: { reservationId, source: "SYSTEM", ruleKey: key, resolvedAt: null },
      data: { resolvedAt: now, resolutionNote: "Cleared automatically: no longer true." },
    });
  }
  return { raised: raise, cleared: clear };
}

/**
 * The nightly pass: every open rental and Flow order, plus any order still
 * holding an open automatic flag (so it can clear). Shared by the cron endpoint
 * and `scripts/sync-auto-flags.ts`.
 */
export async function syncOpenOrders(now: Date = new Date()): Promise<{
  checked: number;
  raised: number;
  cleared: number;
}> {
  const orders = await prisma.reservation.findMany({
    where: {
      OR: [
        { status: { in: OPEN_STATUSES }, reservationType: { in: ["RENTAL", "FLOW"] } },
        { flags: { some: { source: "SYSTEM", resolvedAt: null } } },
      ],
    },
    select: { id: true },
  });
  let raised = 0;
  let cleared = 0;
  for (const order of orders) {
    const r = await syncAutoFlagsCore(order.id, now);
    raised += r.raised.length;
    cleared += r.cleared.length;
  }
  return { checked: orders.length, raised, cleared };
}
