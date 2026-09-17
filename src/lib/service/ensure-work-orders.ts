import { prisma } from "@/lib/prisma";
import { nextNumber } from "@/lib/numbering/next";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/**
 * Every unit in service has a work order (owner, 2026-09-17).
 *
 * A unit reaches MAINTENANCE by more roads than a work order: the v1 sync
 * (v1 is still where units are sent to service), the maintenance log, and a
 * status edited on the unit. Each of those calls this afterwards, and it raises
 * a work order for any unit in service that has no current one — so the bench
 * sees everything that is actually on it, and the tech takes it from there:
 * evaluate, test, then release it, part it out or retire it.
 *
 * "Current" matters until the cutover. When a tech closes a work order here, v2
 * moves the unit out of MAINTENANCE, but v1 still says MAINTENANCE and the next
 * sync puts it back. A work order opened on or after the unit last went into
 * service therefore counts, open or closed — otherwise every sync would raise a
 * fresh one for a unit that has already been dealt with.
 *
 * The fault and the date come from the unit's open maintenance record when it
 * has one (43 of the 46 at the backfill), so the work order says why it is there
 * and since when. Not an action: no session, safe to call from a script.
 */
export async function ensureWorkOrders(): Promise<{ created: { number: string; barcode: string }[] }> {
  const units = await prisma.assetUnit.findMany({
    where: { status: "MAINTENANCE" },
    select: {
      id: true,
      barcode: true,
      updatedAt: true,
      maintenanceRecords: {
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { description: true, notes: true, startDate: true, createdAt: true, status: true, damageDescription: true },
      },
      workOrders: {
        orderBy: { openedAt: "desc" },
        take: 1,
        select: { status: true, openedAt: true },
      },
    },
  });

  const created: { number: string; barcode: string }[] = [];
  for (const unit of units) {
    const record = unit.maintenanceRecords[0];
    const inServiceSince = record?.startDate ?? record?.createdAt ?? unit.updatedAt;
    const latest = unit.workOrders[0];
    if (latest && (OPEN_WORK_ORDER_STATUSES.includes(latest.status) || latest.openedAt >= inServiceSince)) {
      continue;
    }

    const fault =
      record?.damageDescription?.trim() ||
      record?.description?.trim() ||
      "In service — evaluate, test and qualify before release";
    const number = await nextNumber("workOrder");
    await prisma.workOrder.create({
      data: {
        number,
        assetUnitId: unit.id,
        fault,
        notes: record?.notes?.trim() || null,
        openedAt: inServiceSince,
      },
    });
    created.push({ number, barcode: unit.barcode });
  }
  return { created };
}
