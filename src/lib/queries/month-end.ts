import { prisma } from "@/lib/prisma";
import { unitCost, type DepreciationMethod } from "@/lib/utils/depreciation";
import { unitDisposal } from "@/lib/utils/disposal";
import { monthBounds, rollMonth, yearToMonth, type MEUnit } from "@/lib/month-end/roll";

/**
 * Accounting → Month-end: every unit as the roll-forward sees it.
 *
 * Ported from v1's month-end report (Oct 2026). The arithmetic is
 * lib/month-end/roll.ts; this only loads the units and maps them onto it. The
 * screen and the workbook both come through `loadMonthEnd`, so the two cannot
 * disagree.
 *
 * v2 has no `reacquiredAt` column (v1's "sold then bought back"), so every unit
 * maps with it null: a bought-back unit that v1 kept in the register shows here
 * as sold, until that column is ported.
 */

export function loadUnits() {
  return prisma.assetUnit.findMany({
    include: {
      asset: { include: { category: true } },
      location: true,
      vendor: true,
      purchaseOrder: { select: { poNumber: true, receivedDate: true, vendor: { select: { name: true } } } },
      checkouts: {
        where: { status: { in: ["ACTIVE", "OVERDUE", "RETURNED"] } },
        include: {
          reservation: { select: { reservationNumber: true } },
          client: { select: { name: true, companyName: true } },
        },
        orderBy: { checkoutDate: "asc" },
      },
      maintenanceRecords: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ asset: { category: { name: "asc" } } }, { asset: { name: "asc" } }, { barcode: "asc" }],
  });
}
export type LoadedUnit = Awaited<ReturnType<typeof loadUnits>>[number];

export type MonthEndUnit = MEUnit & { src: LoadedUnit; disp: ReturnType<typeof unitDisposal> };

export function toMonthEndUnit(u: LoadedUnit): MonthEndUnit {
  const disp = unitDisposal(u);
  return {
    id: u.id,
    barcode: u.barcode,
    cost: unitCost(u.purchasePrice, u.landedCostAdjustment),
    purchaseDate: u.purchaseDate,
    // In service = received in: the unit's own receipt, else its PO's receipt. The
    // purchase date (when we paid) is only the last resort, flagged as such.
    receivedDate: u.receivedDate ?? u.purchaseOrder?.receivedDate ?? null,
    method: u.asset.depreciationMethod as DepreciationMethod,
    lifeMonths: u.asset.usefulLifeMonths || 60,
    salvage: u.asset.salvageValue ? Number(u.asset.salvageValue) : 0,
    disposed: disp.disposed,
    disposedAt: disp.disposedAt,
    reacquiredAt: null,
    salePrice: disp.disposition === "SOLD" ? disp.salePrice : null,
    saleFees: u.saleFees != null ? Number(u.saleFees) : null,
    src: u,
    disp,
  };
}

/** The roll-forward for each month of `month`'s year, January through `month`. */
export async function loadMonthEnd(month: string) {
  monthBounds(month); // throws on a bad month
  const units = (await loadUnits()).map(toMonthEndUnit);
  const months = yearToMonth(month);
  const byMonth = months.map((m) => rollMonth(units, m));
  return { units, months, byMonth, roll: byMonth[byMonth.length - 1] };
}
