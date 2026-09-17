"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { completeReservation } from "@/lib/actions/reservations";
import { scanUnitIn, type CheckinCondition } from "@/lib/actions/desk";
// Types only from the query module. Re-exporting a type from a "use server"
// file breaks the actions module at runtime ("OutUnit is not defined").
import { unitsOutOn, type OutUnit } from "@/lib/queries/checkin";

/**
 * Check-in as a session: scan what came back, review it, then commit once.
 *
 * The per-scan panel it replaces checked each unit in the moment it was
 * scanned, with the condition picked beforehand. That is fast for one unit and
 * wrong for a return: a person unpacking a case wants to scan everything, then
 * look at the list — set the one that came back scratched, notice the two that
 * didn't come back at all — and only then say "done". So scanning here writes
 * nothing. It checks the unit is really out on this order, and the commit does
 * the check-ins, each through `scanUnitIn` so a damaged unit still raises its
 * work order, then either completes the order or records a partial return.
 */

export type LookupOutcome =
  | { status: "ok"; unit: OutUnit }
  | { status: "wrong-order"; message: string; order: { id: string; reservationNumber: string } }
  | { status: "error"; message: string };

/** Is this barcode out on this order? Reads only — nothing is checked in. */
export async function lookupReturn(
  reservationId: string,
  barcode: string,
): Promise<LookupOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const code = barcode.trim();
  if (!code) return { status: "error", message: "Scan a barcode or type one in." };

  const unit = (await unitsOutOn(reservationId)).find(
    (candidate) => candidate.barcode.toLowerCase() === code.toLowerCase(),
  );
  if (unit) return { status: "ok", unit };

  const elsewhere = await prisma.reservationItemUnit.findFirst({
    where: {
      assetUnit: { barcode: { equals: code, mode: "insensitive" } },
      checkedOutAt: { not: null },
      checkedInAt: null,
    },
    select: {
      reservationItem: {
        select: { reservation: { select: { id: true, reservationNumber: true } } },
      },
    },
  });
  if (elsewhere) {
    const order = elsewhere.reservationItem.reservation;
    return {
      status: "wrong-order",
      message: `${code} is out on ${order.reservationNumber}, not this order.`,
      order,
    };
  }

  const known = await prisma.assetUnit.findFirst({
    where: { barcode: { equals: code, mode: "insensitive" } },
    select: { id: true },
  });
  return {
    status: "error",
    message: known ? `${code} isn't out on any order.` : `No unit has the barcode ${code}.`,
  };
}

export type CheckinEntry = {
  barcode: string;
  condition: CheckinCondition;
  damageNotes?: string;
};

export type CommitOutcome =
  | {
      status: "ok";
      kind: "completed" | "partial" | "all-back";
      message: string;
      /** Units that failed to check in, with why. The rest went through. */
      failed: { barcode: string; message: string }[];
      workOrders: { id: string; number: string }[];
    }
  | { status: "error"; message: string };

export async function commitCheckin(
  reservationId: string,
  entries: CheckinEntry[],
): Promise<CommitOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (entries.length === 0) return { status: "error", message: "Scan at least one unit first." };

  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true, reservationNumber: true, actionRequiredNote: true },
  });
  if (!order) return { status: "error", message: "Order not found." };

  const outBefore = await unitsOutOn(reservationId);
  const failed: { barcode: string; message: string }[] = [];
  const workOrders: { id: string; number: string }[] = [];
  let checkedIn = 0;

  for (const entry of entries) {
    const result = await scanUnitIn(reservationId, entry.barcode, entry.condition, entry.damageNotes);
    if (result.status === "ok") {
      checkedIn++;
      if (result.workOrder) workOrders.push(result.workOrder);
    } else {
      failed.push({ barcode: entry.barcode, message: result.message });
    }
  }

  const stillOut = await unitsOutOn(reservationId);
  revalidatePath(`/dashboard/orders/${reservationId}`);
  revalidatePath("/dashboard/orders");

  const damaged = workOrders.length
    ? ` ${workOrders.length} damaged — ${workOrders.map((w) => w.number).join(", ")} raised.`
    : "";

  if (stillOut.length === 0) {
    if (order.status !== "ACTIVE") {
      return {
        status: "ok",
        kind: "all-back",
        message: `All ${outBefore.length} units back.${damaged} The order is ${order.status.toLowerCase().replace(/_/g, " ")}, so it was not completed.`,
        failed,
        workOrders,
      };
    }
    try {
      await completeReservation(reservationId);
      return {
        status: "ok",
        kind: "completed",
        message: `All ${outBefore.length} units back and ${order.reservationNumber} is complete.${damaged}`,
        failed,
        workOrders,
      };
    } catch (error) {
      return {
        status: "ok",
        kind: "all-back",
        message: `All ${outBefore.length} units back, but the order could not be completed: ${
          error instanceof Error ? error.message : "unknown reason"
        }.${damaged}`,
        failed,
        workOrders,
      };
    }
  }

  // A partial return is the thing to follow up, so it is recorded twice: in
  // the order's activity, naming what is still out, and as the order's
  // action-required flag, which is what the dashboards surface.
  const byAsset = new Map<string, string[]>();
  for (const unit of stillOut) {
    byAsset.set(unit.assetName, [...(byAsset.get(unit.assetName) ?? []), unit.barcode]);
  }
  const outList = [...byAsset.entries()]
    .map(([name, codes]) => `${codes.length}× ${name} (${codes.join(", ")})`)
    .join("; ");
  const note = `Partial return: ${checkedIn} of ${outBefore.length} units back. Still out: ${outList}.`;

  await prisma.statusHistory.create({
    data: {
      entityType: "RESERVATION",
      entityId: reservationId,
      fromStatus: order.status,
      toStatus: "PARTIAL_RETURN",
      changedById: auth.userId,
      notes: note,
    },
  });
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { actionRequired: true, actionRequiredNote: note },
  });

  return {
    status: "ok",
    kind: "partial",
    message: `Partial return recorded: ${checkedIn} back, ${stillOut.length} still out.${damaged}`,
    failed,
    workOrders,
  };
}
