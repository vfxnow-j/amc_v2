"use server";

import { revalidatePath } from "next/cache";
import type { AssetStatus, FlagOutcome, FlagSeverity, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { openWorkOrder } from "@/lib/actions/service";
import { parseDateInput } from "@/lib/billing/calendar";
import { outcomeDef, reasonByCode } from "@/lib/flags/catalog";
import { canClose, exposureFor } from "@/lib/flags/rules";
import { syncAutoFlagsCore } from "@/lib/flags/sync";

/**
 * Order flag cases: raise one, work its playbook, close it with an outcome.
 *
 * A flag that tracks units (lost in transit) takes those units out of stock
 * while it is open (status MISSING) and decides their final status when it
 * closes. The case timeline is not a table: every event is an audit row on the
 * Reservation with `{ flagId, event }`, read back with getEntityAuditLog.
 */

type Fail = { ok: false; message: string };
type Result<T = object> = ({ ok: true } & T) | Fail;

const fail = (message: string): Fail => ({ ok: false, message });

function touch(reservationId: string) {
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${reservationId}`);
}

function money(v: { toString(): string } | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function raiseFlag(input: {
  reservationId: string;
  reason: string;
  note?: string;
  severity?: FlagSeverity;
  ownerId?: string;
  nextActionDate?: string;
  carrier?: string;
  trackingNumber?: string;
  unitIds?: string[];
}): Promise<Result<{ flagId: string }>> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");

  const reason = reasonByCode(input.reason);
  if (!reason) return fail("Choose a reason for the flag.");

  const order = await prisma.reservation.findUnique({
    where: { id: input.reservationId },
    select: { id: true },
  });
  if (!order) return fail("That order does not exist.");

  let nextActionDate: Date | null = null;
  if (input.nextActionDate) {
    nextActionDate = parseDateInput(input.nextActionDate);
    if (!nextActionDate) return fail("Enter the next action date as a valid date.");
  }

  const unitIds = reason.tracksUnits ? [...new Set(input.unitIds ?? [])] : [];
  const units = unitIds.length
    ? await prisma.assetUnit.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, status: true, purchasePrice: true, landedCostAdjustment: true },
      })
    : [];
  if (units.length !== unitIds.length) return fail("One of the chosen units no longer exists.");

  const exposure = exposureFor(
    units.map((u) => ({ purchasePrice: money(u.purchasePrice), landedCostAdjustment: money(u.landedCostAdjustment) })),
  );

  const flag = await prisma.$transaction(async (tx) => {
    const created = await tx.orderFlag.create({
      data: {
        reservationId: input.reservationId,
        category: reason.category,
        reason: reason.code,
        note: input.note?.trim() || null,
        severity: input.severity ?? reason.severity,
        source: "MANUAL",
        ownerId: input.ownerId || null,
        raisedById: auth.userId,
        exposureAmount: exposure,
        nextActionDate,
        carrier: reason.asksCarrier ? input.carrier?.trim() || null : null,
        trackingNumber: reason.asksCarrier ? input.trackingNumber?.trim() || null : null,
        steps: { create: reason.playbook.map((label, position) => ({ position, label })) },
        units: { create: units.map((u) => ({ assetUnitId: u.id, priorStatus: u.status })) },
      },
      select: { id: true },
    });
    if (units.length) {
      await tx.assetUnit.updateMany({ where: { id: { in: units.map((u) => u.id) } }, data: { status: "MISSING" } });
    }
    return created;
  });

  await logAudit({
    action: "CREATE",
    entityType: "Reservation",
    entityId: input.reservationId,
    newValues: { flagId: flag.id, flag: reason.code, event: `Flag raised: ${reason.label}` },
    userId: auth.userId,
  });
  touch(input.reservationId);
  return { ok: true, flagId: flag.id };
}

export async function toggleFlagStep(stepId: string, done: boolean, note?: string): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");

  const step = await prisma.orderFlagStep.findUnique({
    where: { id: stepId },
    select: { flag: { select: { reservationId: true } } },
  });
  if (!step) return fail("That step no longer exists.");

  await prisma.orderFlagStep.update({
    where: { id: stepId },
    data: done
      ? { doneAt: new Date(), doneById: auth.userId, note: note?.trim() || null }
      : { doneAt: null, doneById: null, note: null },
  });
  touch(step.flag.reservationId);
  return { ok: true };
}

export async function updateFlagTracking(
  flagId: string,
  patch: {
    carrier?: string;
    trackingNumber?: string;
    claimNumber?: string;
    nextActionDate?: string | null;
    ownerId?: string | null;
  },
): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");

  const flag = await prisma.orderFlag.findUnique({ where: { id: flagId }, select: { reservationId: true } });
  if (!flag) return fail("That case no longer exists.");

  const data: Prisma.OrderFlagUncheckedUpdateInput = {};
  if (patch.carrier !== undefined) data.carrier = patch.carrier.trim() || null;
  if (patch.trackingNumber !== undefined) data.trackingNumber = patch.trackingNumber.trim() || null;
  if (patch.claimNumber !== undefined) data.claimNumber = patch.claimNumber.trim() || null;
  if (patch.ownerId !== undefined) data.ownerId = patch.ownerId || null;
  if (patch.nextActionDate !== undefined) {
    if (!patch.nextActionDate) data.nextActionDate = null;
    else {
      const d = parseDateInput(patch.nextActionDate);
      if (!d) return fail("Enter the next action date as a valid date.");
      data.nextActionDate = d;
    }
  }
  await prisma.orderFlag.update({ where: { id: flagId }, data });
  touch(flag.reservationId);
  return { ok: true };
}

type FlagForClose = Prisma.OrderFlagGetPayload<{ include: { units: true; steps: true } }>;

/** What each unit becomes when the case closes, per the outcome's `unitsEnd`. */
async function endUnits(
  tx: Prisma.TransactionClient,
  flag: FlagForClose,
  unitIds: string[],
  unitsEnd: "restore" | "damage" | "retire" | "keep",
  now: Date,
) {
  for (const fu of flag.units.filter((u) => unitIds.includes(u.assetUnitId))) {
    if (unitsEnd === "restore") {
      await tx.assetUnit.update({ where: { id: fu.assetUnitId }, data: { status: fu.priorStatus } });
    } else if (unitsEnd === "damage") {
      await tx.assetUnit.update({ where: { id: fu.assetUnitId }, data: { status: "MAINTENANCE" } });
    } else if (unitsEnd === "retire") {
      await tx.assetUnit.update({
        where: { id: fu.assetUnitId },
        data: { status: "RETIRED", retirementReason: "LOST", retiredAt: now, retiredTo: null },
      });
    }
    if (unitsEnd !== "keep" && unitsEnd !== "retire") {
      await tx.orderFlagUnit.update({ where: { id: fu.id }, data: { foundAt: now } });
    }
  }
}

export async function closeFlag(input: {
  flagId: string;
  /** Left out when the reason has no outcomes: the case closes with `note`. */
  outcome?: FlagOutcome | null;
  amount?: number;
  note?: string;
  unitIds?: string[];
}): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");

  const flag = await prisma.orderFlag.findUnique({
    where: { id: input.flagId },
    include: { units: true, steps: true },
  });
  if (!flag) return fail("That case no longer exists.");
  if (flag.resolvedAt) return fail("This case is already closed.");

  // A reason with no outcomes closes with a note; whatever outcome was sent is ignored.
  const allowed = reasonByCode(flag.reason)?.outcomes;
  const noteOnly = !!allowed && allowed.length === 0;
  const outcome = noteOnly ? null : (input.outcome ?? null);
  const def = outcome ? outcomeDef(outcome) : null;
  // Units this closing resolves: those named, or every still-open unit when none are.
  const open = flag.units.filter((u) => !u.foundAt);
  const resolving = (input.unitIds ?? open.map((u) => u.assetUnitId)).filter((id) => open.some((u) => u.assetUnitId === id));
  const unitsStillMissing = open.filter((u) => !resolving.includes(u.assetUnitId)).length;

  const verdict = canClose({
    outcome,
    amount: input.amount ?? null,
    stepsOpen: flag.steps.filter((s) => !s.doneAt).length,
    unitsStillMissing,
    outcomesAllowed: allowed,
    note: input.note,
  });
  if (!verdict.ok) return fail(verdict.message);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await endUnits(tx, flag, resolving, def?.unitsEnd ?? "keep", now);
    await tx.orderFlag.update({
      where: { id: flag.id },
      data: {
        resolvedAt: now,
        resolvedById: auth.userId,
        outcome,
        outcomeAmount: def?.needsAmount ? input.amount : null,
        resolutionNote: input.note?.trim() || null,
      },
    });
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Reservation",
    entityId: flag.reservationId,
    newValues: {
      flagId: flag.id,
      outcome,
      amount: input.amount ?? null,
      event: def ? `Case closed: ${def.label}` : "Case closed: resolved",
    },
    userId: auth.userId,
  });
  if (outcome === "WRITTEN_OFF" || outcome === "CLAIM_PAID") {
    for (const id of resolving) {
      await logAudit({
        action: "UPDATE",
        entityType: "Asset",
        entityId: id,
        newValues: { status: "RETIRED", retirementReason: "LOST", flagId: flag.id, outcome },
        userId: auth.userId,
      });
    }
  }
  touch(flag.reservationId);
  return { ok: true };
}

/**
 * Reverse a write-off: the unit turned up after its case closed.
 * Needs a reason; logged as an OVERRIDE. If a carrier claim was already paid the
 * result carries `refundWarning` so the screen can say a refund may be due.
 */
export async function reinstateUnit(
  unitId: string,
  reason: string,
): Promise<Result<{ refundWarning?: { claimNumber: string | null; amount: number } }>> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");
  if (reason.trim().length < 5) return fail("Give a reason of at least a few words.");

  const unit = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    select: { status: true, retirementReason: true },
  });
  if (!unit || unit.status !== "RETIRED" || unit.retirementReason !== "LOST") {
    return fail("That unit is not written off as lost.");
  }
  const link = await prisma.orderFlagUnit.findFirst({
    where: { assetUnitId: unitId, flag: { resolvedAt: { not: null } } },
    orderBy: { flag: { resolvedAt: "desc" } },
    include: { flag: true },
  });
  if (!link) return fail("No closed case holds this unit.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.assetUnit.update({
      where: { id: unitId },
      data: { status: link.priorStatus, retirementReason: null, retiredAt: null, retiredTo: null },
    });
    await tx.orderFlagUnit.update({ where: { id: link.id }, data: { foundAt: now } });
    await tx.orderFlag.update({
      where: { id: link.flagId },
      data: {
        resolutionNote: [link.flag.resolutionNote, `Reinstated ${stamp()}: ${reason.trim()}`].filter(Boolean).join("\n"),
      },
    });
  });

  await logAudit({
    action: "OVERRIDE",
    entityType: "Asset",
    entityId: unitId,
    oldValues: { status: "RETIRED", retirementReason: "LOST" },
    newValues: { status: link.priorStatus, flagId: link.flagId, reason: reason.trim() },
    userId: auth.userId,
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Reservation",
    entityId: link.flag.reservationId,
    newValues: { flagId: link.flagId, event: `Unit reinstated: ${reason.trim()}` },
    userId: auth.userId,
  });
  touch(link.flag.reservationId);
  return link.flag.outcome === "CLAIM_PAID"
    ? { ok: true, refundWarning: { claimNumber: link.flag.claimNumber, amount: money(link.flag.outcomeAmount) } }
    : { ok: true };
}

/** A scanned unit turned out to be on a case. The person's answer to the prompt. */
export async function foundUnitOnCase(input: {
  unitId: string;
  flagId: string;
  choice: "returned" | "damaged" | "not-this-case" | "leave-open";
  note?: string;
}): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");
  if (input.choice === "not-this-case") return { ok: true };

  const flag = await prisma.orderFlag.findUnique({
    where: { id: input.flagId },
    include: { units: true, steps: true },
  });
  if (!flag) return fail("That case no longer exists.");
  const link = flag.units.find((u) => u.assetUnitId === input.unitId);
  if (!link) return fail("That unit is not on this case.");
  const unit = await prisma.assetUnit.findUnique({ where: { id: input.unitId }, select: { barcode: true } });
  const barcode = unit?.barcode ?? input.unitId;
  const who = (await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } }))?.name ?? "staff";
  const now = new Date();

  const timeline = async (event: string) =>
    logAudit({
      action: "UPDATE",
      entityType: "Reservation",
      entityId: flag.reservationId,
      newValues: { flagId: flag.id, unitId: input.unitId, event: `${stamp()}: unit ${barcode} scanned by ${who}. ${event}` },
      userId: auth.userId,
    });

  if (input.choice === "leave-open") {
    const line = `${stamp()}: unit ${barcode} scanned. ${input.note?.trim() || "Left open."}`;
    await prisma.orderFlag.update({
      where: { id: flag.id },
      data: { note: [flag.note, line].filter(Boolean).join("\n") },
    });
    await timeline("Case left open.");
    touch(flag.reservationId);
    return { ok: true };
  }

  if (input.choice === "damaged") {
    // Unit goes to the damage flow, then the case closes as found-damaged once no
    // other unit is still missing; otherwise it stays open for those.
    const wo = await openWorkOrder({
      assetUnitId: input.unitId,
      fault: input.note?.trim() || `Found damaged after being reported missing (${flag.reason})`,
      openedFromReservationId: flag.reservationId,
    });
    if (wo.status === "error") return fail(wo.message);
  }

  const stillMissing = flag.units.filter((u) => !u.foundAt && u.assetUnitId !== input.unitId).length;
  await prisma.$transaction(async (tx) => {
    if (input.choice === "returned") {
      await tx.assetUnit.update({ where: { id: input.unitId }, data: { status: link.priorStatus as AssetStatus } });
    }
    await tx.orderFlagUnit.update({
      where: { id: link.id },
      data: { foundAt: now, foundNote: input.note?.trim() || null },
    });
    if (stillMissing === 0) {
      await tx.orderFlag.update({
        where: { id: flag.id },
        data: {
          resolvedAt: now,
          resolvedById: auth.userId,
          outcome: input.choice === "returned" ? "FOUND_RETURNED" : "FOUND_DAMAGED",
          resolutionNote: input.note?.trim() || null,
        },
      });
    }
  });
  await timeline(
    `${input.choice === "returned" ? "Found and returned to stock" : "Found damaged"}.${stillMissing === 0 ? " Case closed." : ` Case stays open for ${stillMissing} more.`}`,
  );
  touch(flag.reservationId);
  return { ok: true };
}

/** Raise or clear the system flags for one order (the rules live in lib/flags). */
export async function syncAutoFlags(reservationId: string): Promise<Result<{ raised: string[]; cleared: string[] }>> {
  const auth = await requireEditor();
  if (!auth.authorized) return fail(auth.error ?? "Unauthorized");
  const done = await syncAutoFlagsCore(reservationId);
  touch(reservationId);
  return { ok: true, ...done };
}
