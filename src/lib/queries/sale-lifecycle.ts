import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { unitCost } from "@/lib/utils/depreciation";
import { buildLifecycle } from "@/lib/reports/sale-lifecycle";
import type { SaleChannelValue } from "@/lib/sales/sale-channel";

export type SaleChannelFilter = SaleChannelValue | "UNSET" | "ALL";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every sold unit's life from acquisition to sale, for one sale channel.
 *
 * `totalRevenue` on the unit is the rental revenue it earned over its life, so
 * it is read as is rather than re-summed from invoices (which this database
 * does not mark paid). A unit with an open checkout at the sale is clipped to
 * the sale date in `buildLifecycle`.
 */
export async function getSaleLifecycleReport(filters: {
  channel: SaleChannelFilter;
  startDate?: Date;
  endDate?: Date;
}) {
  const soldAt: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.startDate) soldAt.gte = filters.startDate;
  if (filters.endDate) soldAt.lte = filters.endDate;

  const channelWhere: Prisma.AssetUnitWhereInput =
    filters.channel === "ALL"
      ? {}
      : filters.channel === "UNSET"
        ? { saleChannel: null }
        : { saleChannel: filters.channel };

  const [units, channelCounts] = await Promise.all([
    prisma.assetUnit.findMany({
      where: { soldAt, ...channelWhere },
      orderBy: { soldAt: "desc" },
      select: {
        id: true,
        barcode: true,
        status: true,
        purchasePrice: true,
        landedCostAdjustment: true,
        purchaseDate: true,
        receivedDate: true,
        soldAt: true,
        soldPrice: true,
        saleFees: true,
        saleChannel: true,
        retiredTo: true,
        soldNotes: true,
        totalRevenue: true,
        asset: {
          select: {
            id: true,
            name: true,
            depreciationMethod: true,
            usefulLifeMonths: true,
            salvageValue: true,
          },
        },
        checkouts: {
          where: { status: { in: ["ACTIVE", "OVERDUE", "RETURNED"] } },
          select: {
            checkoutDate: true,
            actualReturn: true,
            reservation: { select: { id: true, reservationNumber: true } },
            client: { select: { name: true } },
          },
        },
      },
    }),
    prisma.assetUnit.groupBy({
      by: ["saleChannel"],
      where: { soldAt },
      _count: { _all: true },
    }),
  ]);

  const rows = units.map((u) => {
    const price = u.purchasePrice === null ? 0 : Number(u.purchasePrice);
    const cost = price > 0 ? unitCost(price, Number(u.landedCostAdjustment)) : null;
    const life = buildLifecycle({
      cost,
      purchaseDate: u.purchaseDate,
      receivedDate: u.receivedDate,
      soldAt: u.soldAt!,
      soldPrice: u.soldPrice === null ? null : Number(u.soldPrice),
      saleFees: u.saleFees === null ? null : Number(u.saleFees),
      rentalRevenue: Number(u.totalRevenue),
      depreciationMethod: u.asset.depreciationMethod,
      usefulLifeMonths: u.asset.usefulLifeMonths,
      salvageValue: u.asset.salvageValue === null ? 0 : Number(u.asset.salvageValue),
      checkouts: u.checkouts.map((c) => ({
        checkoutDate: c.checkoutDate,
        actualReturn: c.actualReturn,
        reservationId: c.reservation?.id ?? null,
        reservationNumber: c.reservation?.reservationNumber ?? null,
        clientName: c.client?.name ?? null,
      })),
    });
    return {
      unitId: u.id,
      barcode: u.barcode,
      assetName: u.asset.name,
      saleChannel: u.saleChannel,
      soldTo: u.retiredTo,
      soldNotes: u.soldNotes,
      soldAt: u.soldAt!,
      cost,
      soldPrice: u.soldPrice === null ? null : Number(u.soldPrice),
      saleFees: u.saleFees === null ? null : Number(u.saleFees),
      ...life,
    };
  });

  const sum = (xs: (number | null)[]) =>
    round2(xs.reduce<number>((a, x) => a + (x ?? 0), 0));
  const priced = rows.filter((r) => r.soldPrice !== null);
  const complete = rows.filter((r) => r.totalReturn !== null);

  const counts: Record<SaleChannelFilter, number> = {
    EBAY: 0,
    CUSTOMER: 0,
    OTHER: 0,
    UNSET: 0,
    ALL: 0,
  };
  for (const group of channelCounts) {
    counts[group.saleChannel ?? "UNSET"] += group._count._all;
    counts.ALL += group._count._all;
  }

  return {
    channelCounts: counts,
    rows,
    summary: {
      units: rows.length,
      pricedUnits: priced.length,
      grossSales: sum(priced.map((r) => r.soldPrice)),
      fees: sum(rows.map((r) => r.saleFees)),
      feesMissing: priced.filter((r) => r.saleFees === null).length,
      netSales: sum(priced.map((r) => r.net)),
      rentalRevenue: sum(rows.map((r) => r.rentalRevenue)),
      unitsWithRentals: rows.filter((r) => r.rentals > 0).length,
      // Only units with both a cost and a price carry a return, so the return
      // and the cost it is measured against cover the same units.
      completeUnits: complete.length,
      totalReturn: sum(complete.map((r) => r.totalReturn)),
      completeCost: sum(complete.map((r) => r.cost)),
    },
  };
}
