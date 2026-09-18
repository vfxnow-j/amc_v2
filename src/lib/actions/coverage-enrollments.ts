"use server";

import { revalidatePath } from "next/cache";
import type { CoverageEnrollmentStatus, CoverageType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { ENROLLMENT_STATUSES } from "@/lib/coverage/labels";

/**
 * Write path for CoverageEnrollment: a plan one unit is enrolled in.
 *
 * The status is the thing being tracked. Moving it to Enrolled or Not enrolled
 * means somebody looked at the provider's record, so it stamps `checkedAt`;
 * dates are only ever what a person typed, never derived from a term.
 */

type Plain = { status: "ok"; message: string } | { status: "error"; message: string };

const CHECKED: CoverageEnrollmentStatus[] = ["ENROLLED", "NOT_ENROLLED"];
const TYPES: CoverageType[] = ["LICENSE", "SUPPORT_CONTRACT", "EXTENDED_WARRANTY", "SERVICE_PLAN", "SUBSCRIPTION"];

/** "2026-02-10" → that calendar day at noon UTC, v2's convention for a day. "" → null. */
function calendarDay(value: string | undefined): Date | null | "invalid" {
  if (!value?.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return "invalid";
  const date = new Date(`${value.trim()}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function revalidate(unitId: string) {
  revalidatePath(`/dashboard/units/${unitId}`);
  revalidatePath("/dashboard/service/coverage");
}

export type EnrollmentInput = {
  status: CoverageEnrollmentStatus;
  startDate?: string;
  endDate?: string;
  agreementNumber?: string;
  notes?: string;
};

export async function updateCoverageEnrollment(id: string, input: EnrollmentInput): Promise<Plain> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!ENROLLMENT_STATUSES.includes(input.status)) return { status: "error", message: "That isn't a status." };
  const startDate = calendarDay(input.startDate);
  const endDate = calendarDay(input.endDate);
  if (startDate === "invalid" || endDate === "invalid") return { status: "error", message: "Dates are year-month-day." };
  if (startDate && endDate && endDate < startDate) return { status: "error", message: "The end date is before the start." };

  const row = await prisma.coverageEnrollment.findUnique({ where: { id }, select: { unitId: true, status: true } });
  if (!row) return { status: "error", message: "That coverage no longer exists." };

  await prisma.coverageEnrollment.update({
    where: { id },
    data: {
      status: input.status,
      startDate,
      endDate,
      agreementNumber: input.agreementNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      ...(CHECKED.includes(input.status) && input.status !== row.status ? { checkedAt: new Date() } : {}),
    },
  });
  revalidate(row.unitId);
  return { status: "ok", message: "Coverage saved." };
}

/** One status for several units at once — a whole PO's plans confirmed in one pass. */
export async function setEnrollmentStatus(ids: string[], status: CoverageEnrollmentStatus): Promise<Plain> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!ENROLLMENT_STATUSES.includes(status)) return { status: "error", message: "That isn't a status." };
  if (ids.length === 0) return { status: "error", message: "Nothing selected." };

  const rows = await prisma.coverageEnrollment.findMany({ where: { id: { in: ids } }, select: { unitId: true } });
  await prisma.coverageEnrollment.updateMany({
    where: { id: { in: ids }, status: { not: status } },
    data: { status, ...(CHECKED.includes(status) ? { checkedAt: new Date() } : {}) },
  });
  revalidatePath("/dashboard/service/coverage");
  for (const unitId of new Set(rows.map((row) => row.unitId))) revalidatePath(`/dashboard/units/${unitId}`);
  return { status: "ok", message: `${rows.length} ${rows.length === 1 ? "unit" : "units"} updated.` };
}

/** Coverage bought for this unit alone — a plan added after the fact, say. */
export async function addCoverageEnrollment(
  unitId: string,
  input: EnrollmentInput & { name: string; provider?: string; type?: CoverageType },
): Promise<Plain> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!input.name.trim()) return { status: "error", message: "Name the plan, e.g. AppleCare+." };
  if (!ENROLLMENT_STATUSES.includes(input.status)) return { status: "error", message: "That isn't a status." };
  if (input.type && !TYPES.includes(input.type)) return { status: "error", message: "That isn't a coverage type." };
  const startDate = calendarDay(input.startDate);
  const endDate = calendarDay(input.endDate);
  if (startDate === "invalid" || endDate === "invalid") return { status: "error", message: "Dates are year-month-day." };
  if (startDate && endDate && endDate < startDate) return { status: "error", message: "The end date is before the start." };
  const unit = await prisma.assetUnit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) return { status: "error", message: "That unit doesn't exist." };

  await prisma.coverageEnrollment.create({
    data: {
      unitId,
      name: input.name.trim(),
      provider: input.provider?.trim() || null,
      type: input.type ?? "EXTENDED_WARRANTY",
      status: input.status,
      startDate,
      endDate,
      agreementNumber: input.agreementNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      source: "Added by hand on the unit record.",
      checkedAt: CHECKED.includes(input.status) ? new Date() : null,
    },
  });
  revalidate(unitId);
  return { status: "ok", message: "Coverage added." };
}

export async function removeCoverageEnrollment(id: string): Promise<Plain> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  const row = await prisma.coverageEnrollment.findUnique({ where: { id }, select: { unitId: true } });
  if (!row) return { status: "error", message: "That coverage no longer exists." };
  await prisma.coverageEnrollment.delete({ where: { id } });
  revalidate(row.unitId);
  return { status: "ok", message: "Coverage removed." };
}
