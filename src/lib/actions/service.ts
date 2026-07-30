"use server";

import { revalidatePath } from "next/cache";
import type { QcResult, WorkOrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/**
 * Service centre write path.
 *
 * This module owns the one rule that makes the feature worth having: a unit
 * with an open work order is not bookable. Opening one moves the unit to
 * MAINTENANCE, and closing decides where it goes — CLOSED_PASS returns it to
 * AVAILABLE, CLOSED_SCRAP retires it. Nothing else in the app should be moving
 * a unit's status for service reasons.
 *
 * Deliberately refuses to open against a unit that is currently out with a
 * client: the fault is real, but the unit is not in the building, and marking
 * it MAINTENANCE would tell the order it came back when it hasn't.
 */

export type ServiceResult =
  | { status: "ok"; workOrderId: string; number: string }
  | { status: "error"; message: string };

async function nextNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await prisma.workOrder.findFirst({
    where: { number: { startsWith: `WO-${year}-` } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const sequence = last ? Number(last.number.split("-")[2]) + 1 : 1;
  return `WO-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function openWorkOrder(input: {
  assetUnitId: string;
  fault: string;
  billable?: boolean;
  notes?: string;
  openedFromReservationId?: string;
}): Promise<ServiceResult> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }
  if (!input.fault.trim()) {
    return {
      status: "error",
      message: "Say what's wrong with it — a work order with no fault can't be triaged.",
    };
  }

  const unit = await prisma.assetUnit.findUnique({
    where: { id: input.assetUnitId },
    select: { id: true, barcode: true, status: true },
  });
  if (!unit) return { status: "error", message: "That unit doesn't exist." };

  const alreadyOpen = await prisma.workOrder.findFirst({
    where: {
      assetUnitId: unit.id,
      status: { in: OPEN_WORK_ORDER_STATUSES },
    },
    select: { number: true },
  });
  if (alreadyOpen) {
    return {
      status: "error",
      message: `${unit.barcode} already has ${alreadyOpen.number} open. Add a test run to that one instead of raising a second.`,
    };
  }

  // Still with a client: the fault is real but the unit isn't here, and moving
  // it to MAINTENANCE would tell its order it came back.
  if (unit.status === "CHECKED_OUT") {
    return {
      status: "error",
      message: `${unit.barcode} is still checked out. Check it in first — the check-in screen can raise this for you.`,
    };
  }

  const number = await nextNumber();

  const workOrder = await prisma.$transaction(async (tx) => {
    const created = await tx.workOrder.create({
      data: {
        number,
        assetUnitId: unit.id,
        fault: input.fault.trim(),
        billable: input.billable ?? false,
        notes: input.notes,
        openedFromReservationId: input.openedFromReservationId,
        openedById: auth.userId,
      },
      select: { id: true, number: true },
    });

    // Out of bookable stock for as long as this is open.
    await tx.assetUnit.update({
      where: { id: unit.id },
      data: { status: "MAINTENANCE" },
    });

    return created;
  });

  revalidatePath("/dashboard/service/work-orders");
  revalidatePath("/dashboard/units");
  return { status: "ok", workOrderId: workOrder.id, number: workOrder.number };
}

export async function setWorkOrderStatus(
  workOrderId: string,
  status: WorkOrderStatus,
  closingNote?: string,
): Promise<ServiceResult> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const existing = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      number: true,
      status: true,
      fault: true,
      assetUnitId: true,
      openedAt: true,
    },
  });
  if (!existing) {
    return { status: "error", message: "That work order doesn't exist." };
  }
  if (!OPEN_WORK_ORDER_STATUSES.includes(existing.status)) {
    return {
      status: "error",
      message: `${existing.number} is already closed. Raise a new one if the fault came back.`,
    };
  }

  const closing = status === "CLOSED_PASS" || status === "CLOSED_SCRAP";

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        status,
        closedAt: closing ? new Date() : null,
        notes: closingNote ?? undefined,
      },
    });

    if (!closing) return;

    // A closed work order writes its history to the unit, per the handoff —
    // MaintenanceRecord is the log this cluster shows.
    const record = await tx.maintenanceRecord.create({
      data: {
        assetUnitId: existing.assetUnitId,
        type: "CORRECTIVE",
        status: "COMPLETED",
        description: `${existing.number}: ${existing.fault}`,
        startDate: existing.openedAt,
        completionDate: new Date(),
        notes: closingNote,
      },
      select: { id: true },
    });
    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { maintenanceRecordId: record.id },
    });

    await tx.assetUnit.update({
      where: { id: existing.assetUnitId },
      data:
        status === "CLOSED_PASS"
          ? { status: "AVAILABLE" }
          : { status: "RETIRED", retiredAt: new Date(), retirementReason: "DAMAGED" },
    });
  });

  revalidatePath("/dashboard/service/work-orders");
  revalidatePath(`/dashboard/service/work-orders/${workOrderId}`);
  revalidatePath("/dashboard/units");
  return { status: "ok", workOrderId, number: existing.number };
}

export async function recordTestRun(input: {
  workOrderId: string;
  testName: string;
  result: QcResult;
  durationSec?: number;
  output?: string;
  logUrl?: string;
}): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }
  if (!input.testName.trim()) {
    return { status: "error", message: "Name the test." };
  }

  await prisma.qcTestRun.create({
    data: {
      workOrderId: input.workOrderId,
      testName: input.testName.trim(),
      result: input.result,
      // QUEUED hasn't happened yet, so it carries no timestamp.
      ranAt: input.result === "QUEUED" ? null : new Date(),
      durationSec: input.durationSec,
      output: input.output,
      logUrl: input.logUrl,
    },
  });

  revalidatePath(`/dashboard/service/work-orders/${input.workOrderId}`);
  revalidatePath("/dashboard/service/qc-runs");
  return { status: "ok" };
}
