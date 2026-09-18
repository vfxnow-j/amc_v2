import type { QcResult, WorkOrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";
import { ENROLLMENT_STATUS_LABEL, enrollmentCovers } from "@/lib/coverage/labels";

/** Read side of the service center. */

export const WORK_ORDER_LABEL: Record<WorkOrderStatus, string> = {
  OPEN: "Open",
  IN_TEST: "In test",
  AWAITING_PARTS: "Awaiting parts",
  RMA: "RMA",
  CLOSED_PASS: "Released to inventory",
  CLOSED_SCRAP: "Retired",
  CLOSED_PARTED: "Parted out",
};

export const QC_LABEL: Record<QcResult, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  PASS: "Pass",
  FAIL: "Fail",
};

/** The queue, newest fault first, open work before closed. */
export async function getWorkOrders(includeClosed = false) {
  const rows = await prisma.workOrder.findMany({
    where: includeClosed
      ? {}
      : { status: { in: OPEN_WORK_ORDER_STATUSES } },
    orderBy: [{ closedAt: "asc" }, { openedAt: "desc" }],
    take: 60,
    select: {
      id: true,
      number: true,
      status: true,
      fault: true,
      billable: true,
      openedAt: true,
      assetUnit: {
        select: { barcode: true, asset: { select: { name: true } } },
      },
      assignedTech: { select: { name: true } },
      _count: { select: { testRuns: true } },
      testRuns: {
        where: { result: "FAIL" },
        take: 1,
        select: { id: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    fault: row.fault,
    billable: row.billable,
    openedAt: row.openedAt,
    barcode: row.assetUnit.barcode,
    assetName: row.assetUnit.asset.name,
    tech: row.assignedTech?.name ?? null,
    runs: row._count.testRuns,
    hasFailure: row.testRuns.length > 0,
  }));
}

export async function getWorkOrder(id: string) {
  return prisma.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      fault: true,
      billable: true,
      notes: true,
      openedAt: true,
      closedAt: true,
      rmaProvider: true,
      rmaNumber: true,
      rmaSentAt: true,
      rmaReturnedAt: true,
      assetUnit: {
        select: {
          id: true,
          barcode: true,
          serialNumber: true,
          status: true,
          asset: { select: { id: true, name: true } },
        },
      },
      openedBy: { select: { name: true } },
      assignedTech: { select: { name: true } },
      openedFromReservation: {
        select: { id: true, reservationNumber: true },
      },
      testRuns: {
        orderBy: [{ ranAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          testName: true,
          result: true,
          ranAt: true,
          durationSec: true,
          output: true,
        },
      },
    },
  });
}

/** Cross-order run list for the QC screen. */
export async function getTestRuns(result?: QcResult) {
  return prisma.qcTestRun.findMany({
    where: result ? { result } : {},
    orderBy: [{ ranAt: "desc" }, { createdAt: "desc" }],
    take: 80,
    select: {
      id: true,
      testName: true,
      result: true,
      ranAt: true,
      durationSec: true,
      workOrder: {
        select: {
          id: true,
          number: true,
          assetUnit: { select: { barcode: true } },
        },
      },
    },
  });
}

/**
 * The Overview's service card, which shipped showing the reference's invented
 * four rows. This is what the queue can actually prove.
 */
export async function getServiceSummary() {
  const [open, byStatus, recent] = await Promise.all([
    prisma.workOrder.count({
      where: { status: { in: OPEN_WORK_ORDER_STATUSES } },
    }),
    prisma.workOrder.groupBy({
      by: ["status"],
      where: { status: { in: OPEN_WORK_ORDER_STATUSES } },
      _count: { _all: true },
    }),
    prisma.workOrder.findMany({
      where: { status: { in: OPEN_WORK_ORDER_STATUSES } },
      orderBy: { openedAt: "desc" },
      take: 4,
      select: {
        id: true,
        number: true,
        fault: true,
        status: true,
        assetUnit: { select: { barcode: true } },
        testRuns: {
          orderBy: [{ ranAt: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { result: true },
        },
      },
    }),
  ]);

  return {
    open,
    byStatus: Object.fromEntries(
      byStatus.map((row) => [row.status, row._count._all]),
    ) as Partial<Record<WorkOrderStatus, number>>,
    recent: recent.map((row) => ({
      id: row.id,
      number: row.number,
      fault: row.fault,
      status: row.status,
      barcode: row.assetUnit.barcode,
      lastResult: row.testRuns[0]?.result ?? null,
    })),
  };
}

/** Coverage & RMA: warranty windows closing, and units out at an RMA. */
export async function getCoverage(now = new Date()) {
  const soon = new Date(now.getTime() + 90 * 86_400_000);
  const [expiring, rma] = await Promise.all([
    prisma.serviceCoverage.findMany({
      where: { endDate: { lte: soon } },
      orderBy: { endDate: "asc" },
      take: 40,
      select: {
        id: true,
        name: true,
        type: true,
        provider: true,
        endDate: true,
        unit: {
          select: { id: true, barcode: true, asset: { select: { name: true } } },
        },
      },
    }),
    prisma.workOrder.findMany({
      where: { status: "RMA" },
      orderBy: { openedAt: "asc" },
      select: {
        id: true,
        number: true,
        fault: true,
        openedAt: true,
        assetUnit: {
          select: { barcode: true, asset: { select: { name: true } } },
        },
      },
    }),
  ]);
  return { expiring, rma, now };
}

export type UnitCoverage = {
  name: string;
  provider: string | null;
  /**
   * Where it's defined: every unit of the model, a dated contract on this unit,
   * its warranty date, or a plan this unit is enrolled in (CoverageEnrollment),
   * whose end date may not be known yet.
   */
  source: "model" | "unit" | "warranty" | "plan";
  endDate: Date | null;
  active: boolean;
  /** For a plan: where its enrollment stands, e.g. "Bought, unconfirmed". */
  status?: string;
};

/**
 * What covers one unit: the model's coverage (running its term from the unit's
 * purchase date), coverage recorded on the unit itself, and the unit's
 * warranty date. Active when its end date hasn't passed; a model coverage on a
 * unit with no purchase date can't be dated and shows undated. A plan the unit
 * is enrolled in counts while bought or enrolled and not past a known end
 * date — an AppleCare+ plan with no end on file is still the first call.
 */
export async function getUnitCoverage(unitId: string): Promise<UnitCoverage[]> {
  const unit = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    select: {
      purchaseDate: true,
      warrantyExpiry: true,
      serviceCoverages: { select: { name: true, provider: true, endDate: true } },
      coverageEnrollments: { orderBy: { createdAt: "asc" }, select: { name: true, provider: true, status: true, endDate: true } },
      asset: { select: { coverages: { orderBy: { sortOrder: "asc" }, select: { name: true, provider: true, termMonths: true } } } },
    },
  });
  if (!unit) return [];
  const now = new Date();
  const rows: UnitCoverage[] = [];
  for (const coverage of unit.asset.coverages) {
    let endDate: Date | null = null;
    if (unit.purchaseDate) {
      endDate = new Date(unit.purchaseDate);
      endDate.setUTCMonth(endDate.getUTCMonth() + coverage.termMonths);
    }
    rows.push({ name: coverage.name, provider: coverage.provider, source: "model", endDate, active: endDate ? endDate > now : true });
  }
  for (const coverage of unit.serviceCoverages) {
    rows.push({ name: coverage.name, provider: coverage.provider, source: "unit", endDate: coverage.endDate, active: coverage.endDate > now });
  }
  for (const plan of unit.coverageEnrollments) {
    rows.push({
      name: plan.name,
      provider: plan.provider,
      source: "plan",
      endDate: plan.endDate,
      active: enrollmentCovers(plan, now),
      status: ENROLLMENT_STATUS_LABEL[plan.status],
    });
  }
  if (unit.warrantyExpiry) {
    rows.push({ name: "Warranty", provider: null, source: "warranty", endDate: unit.warrantyExpiry, active: unit.warrantyExpiry > now });
  }
  return rows;
}
