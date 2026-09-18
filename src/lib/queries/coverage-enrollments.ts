import type { CoverageEnrollmentStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { enrollmentCovers } from "@/lib/coverage/labels";

/**
 * Reads for CoverageEnrollment — a plan one unit is enrolled in, tracked by
 * status, with dates only once somebody has seen them (see the model in
 * schema.prisma for why it sits beside ServiceCoverage).
 */

const ROW = {
  id: true,
  type: true,
  name: true,
  provider: true,
  status: true,
  startDate: true,
  endDate: true,
  agreementNumber: true,
  cost: true,
  source: true,
  notes: true,
  checkedAt: true,
  purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { name: true } } } },
} as const;

/** Every plan on one unit, for its record. */
export async function getUnitEnrollments(unitId: string, now = new Date()) {
  const rows = await prisma.coverageEnrollment.findMany({
    where: { unitId },
    orderBy: [{ createdAt: "asc" }],
    select: { ...ROW, unit: { select: { serialNumber: true } } },
  });
  return rows.map(({ unit, ...row }) => ({
    ...row,
    serialNumber: unit.serialNumber,
    cost: row.cost === null ? null : Number(row.cost),
    covers: enrollmentCovers(row, now),
  }));
}

export type UnitEnrollment = Awaited<ReturnType<typeof getUnitEnrollments>>[number];

/**
 * Coverage & RMA's per-unit view: every unit with a plan, grouped by the model
 * it is, with the count at each status — so "20 Mac minis on AppleCare+, none
 * confirmed yet" reads off one line.
 */
export async function getEnrollmentBoard(now = new Date()) {
  const rows = await prisma.coverageEnrollment.findMany({
    orderBy: [{ unit: { barcode: "asc" } }],
    select: {
      ...ROW,
      unit: {
        select: {
          id: true,
          barcode: true,
          serialNumber: true,
          status: true,
          asset: { select: { id: true, name: true } },
        },
      },
    },
  });

  const counts: Record<CoverageEnrollmentStatus, number> = {
    PURCHASED: 0,
    ENROLLED: 0,
    NOT_ENROLLED: 0,
    CANCELLED: 0,
  };
  const byModel = new Map<
    string,
    { assetId: string; assetName: string; rows: (Omit<(typeof rows)[number], "cost"> & { cost: number | null; covers: boolean })[] }
  >();
  for (const row of rows) {
    counts[row.status]++;
    const key = row.unit.asset.id;
    const group = byModel.get(key) ?? { assetId: key, assetName: row.unit.asset.name, rows: [] };
    group.rows.push({ ...row, cost: row.cost === null ? null : Number(row.cost), covers: enrollmentCovers(row, now) });
    byModel.set(key, group);
  }

  return {
    total: rows.length,
    counts,
    /** Units whose plan end date is known and falls in the next 90 days, or has passed. */
    closing: rows
      .filter((row) => row.endDate && row.endDate.getTime() <= now.getTime() + 90 * 86_400_000 && row.status !== "CANCELLED")
      .map((row) => ({ id: row.id, name: row.name, provider: row.provider, endDate: row.endDate!, unit: row.unit })),
    models: [...byModel.values()].sort((a, b) => a.assetName.localeCompare(b.assetName)),
  };
}
