"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/actions/audit";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { checkUnit, normalizeSerial, type Gap } from "@/lib/scan/completeness";

type Result = { ok: true } | { ok: false; message: string };

/** Save a serial on a unit, clearing its data flag. Refuses a serial already in the fleet. */
export async function fixUnitSerial(unitId: string, serial: string): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, message: auth.error ?? "Unauthorized" };

  const value = normalizeSerial(serial);
  if (!value) return { ok: false, message: "Enter or scan the serial." };

  const clash = await prisma.assetUnit.findFirst({
    where: { serialNumber: { equals: value, mode: "insensitive" }, id: { not: unitId } },
    select: { barcode: true },
  });
  if (clash) return { ok: false, message: `That serial is already on ${clash.barcode}.` };

  const before = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    select: { serialNumber: true, dataFlag: true },
  });
  if (!before) return { ok: false, message: "Unit not found." };

  await prisma.assetUnit.update({
    where: { id: unitId },
    data: { serialNumber: value, dataFlag: null, dataFlaggedAt: null, dataFlaggedById: null },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: unitId,
    oldValues: { serialNumber: before.serialNumber, dataFlag: before.dataFlag },
    newValues: { serialNumber: value, dataFlag: null },
    userId: auth.userId,
  });
  revalidatePath("/dashboard/inventory/missing-data");
  return { ok: true };
}

/** The person chose to carry on without the serial. Flag it, and log who skipped. */
export async function skipUnitSerial(unitId: string, gap: Gap | "MISMATCH"): Promise<Result> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, message: auth.error ?? "Unauthorized" };

  await prisma.assetUnit.update({
    where: { id: unitId },
    data: { dataFlag: gap, dataFlaggedAt: new Date(), dataFlaggedById: auth.userId },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: unitId,
    newValues: { dataFlag: gap, skipped: true },
    userId: auth.userId,
  });
  revalidatePath("/dashboard/inventory/missing-data");
  return { ok: true };
}

export type IncompleteUnit = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  assetName: string;
  gap: Gap;
  flagged: boolean;
  location: string | null;
};

/** Every unit that fails `checkUnit`, flagged or not, excluding retired and sold stock. */
export async function listIncompleteUnits(): Promise<IncompleteUnit[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];

  const units = await prisma.assetUnit.findMany({
    where: {
      status: { notIn: ["RETIRED", "SOLD"] },
      asset: { requiresSerial: true },
      OR: [{ serialNumber: null }, { serialNumber: "" }],
    },
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      dataFlag: true,
      asset: { select: { name: true, requiresSerial: true } },
      location: { select: { name: true } },
    },
    orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
  });

  return units.flatMap((u) => {
    const r = checkUnit({
      barcode: u.barcode,
      serialNumber: u.serialNumber,
      requiresSerial: u.asset.requiresSerial,
    });
    if (r.complete) return [];
    return [{
      id: u.id,
      barcode: u.barcode,
      serialNumber: u.serialNumber,
      assetName: u.asset.name,
      gap: r.gap,
      flagged: u.dataFlag !== null,
      location: u.location?.name ?? null,
    }];
  });
}
