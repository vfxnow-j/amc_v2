import { prisma } from "@/lib/prisma";
import type { AssetStatus, OwnershipType, Prisma } from "@/generated/prisma/client";
import { IN_FLEET, OUT_OF_FLEET } from "@/lib/inventory/availability";
import { bookValue, hasSchedule } from "@/lib/inventory/depreciation";
import { unitCost } from "@/lib/utils/depreciation";

/**
 * Accounting → Fixed assets: the fixed asset register, one row per unit
 * (owner, 2026-09-17).
 *
 * Every figure here already exists on some record — cost and ownership on the
 * unit, the schedule and market price on its model, revenue on the unit, orders
 * on its checkouts. Accounting shouldn't have to open 863 records to see them
 * side by side, so this lays them out as one register with totals and exports.
 *
 * **One schedule.** Book value and accumulated depreciation come from
 * `bookValue` (lib/inventory/depreciation) — the same guard the unit record and
 * the depreciation report use. A unit it can't value (no purchase price, no
 * useful life, a method with no schedule) is shown without a book value and
 * counted as "not valued", never valued at cost or at zero.
 *
 * "Valued" is the model's market price, when one has been researched — a
 * resale estimate, not a book figure, and labelled that way.
 */

export const FIXED_ASSET_VIEWS = ["in-service", "disposed", "all"] as const;
export type FixedAssetView = (typeof FIXED_ASSET_VIEWS)[number];

export const OWNERSHIP_LABEL: Record<OwnershipType, string> = {
  CASH: "Cash",
  CREDIT: "Credit card",
  LOAN: "Loan / lease",
  REVOLVER: "Revolver",
  DONATED: "Donated",
  EXCHANGE: "Exchange",
  VENDOR_CREDIT: "Vendor credit",
};

export const METHOD_LABEL: Record<string, string> = {
  STRAIGHT_LINE: "Straight line",
  DECLINING_BALANCE: "Declining balance",
  SUM_OF_YEARS: "Sum of years",
  UNITS_OF_PRODUCTION: "Units of production",
};

export type FixedAssetFilters = {
  view?: FixedAssetView;
  ownership?: OwnershipType;
  categoryId?: string;
  query?: string;
};

export type FixedAssetRow = {
  unitId: string;
  assetId: string;
  barcode: string;
  serialNumber: string | null;
  model: string;
  manufacturer: string | null;
  category: string;
  status: AssetStatus;
  location: string | null;
  ownership: OwnershipType;
  /** The lease or loan financing it, when there is one. */
  financing: { leaseId: string | null; name: string | null; lender: string | null } | null;
  vendor: string | null;
  purchaseDate: Date;
  inServiceDate: Date;
  cost: number | null;
  /** The model's researched market price. */
  marketValue: number | null;
  orders: number;
  revenue: number;
  maintenance: number;
  depreciation: {
    method: string;
    lifeMonths: number;
    salvage: number;
    monthsElapsed: number;
    accumulated: number;
    book: number;
    fullyDepreciated: boolean;
  } | null;
  /** Why there is no book value, when there isn't one. */
  notValuedReason: string | null;
  disposal: { on: Date | null; how: string; proceeds: number | null } | null;
};

export type FixedAssetTotals = {
  units: number;
  valued: number;
  notValued: number;
  cost: number;
  accumulated: number;
  book: number;
  marketValue: number;
  revenue: number;
  orders: number;
  proceeds: number;
};

function whereFor(filters: FixedAssetFilters): Prisma.AssetUnitWhereInput {
  const view = filters.view ?? "in-service";
  const needle = filters.query?.trim();
  return {
    ...(view === "in-service"
      ? { status: { in: IN_FLEET } }
      : view === "disposed"
        ? { status: { in: OUT_OF_FLEET } }
        : {}),
    ...(filters.ownership ? { ownershipType: filters.ownership } : {}),
    ...(filters.categoryId ? { asset: { categoryId: filters.categoryId } } : {}),
    ...(needle
      ? {
          OR: [
            { barcode: { contains: needle, mode: "insensitive" } },
            { serialNumber: { contains: needle, mode: "insensitive" } },
            { asset: { name: { contains: needle, mode: "insensitive" } } },
            { asset: { manufacturer: { contains: needle, mode: "insensitive" } } },
            { loanName: { contains: needle, mode: "insensitive" } },
            { lease: { leaseName: { contains: needle, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export async function getFixedAssets(filters: FixedAssetFilters = {}, now: Date = new Date()) {
  const units = await prisma.assetUnit.findMany({
    where: whereFor(filters),
    orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      status: true,
      ownershipType: true,
      purchaseDate: true,
      receivedDate: true,
      purchasePrice: true,
      landedCostAdjustment: true,
      totalRevenue: true,
      maintenanceCost: true,
      loanName: true,
      fundingBusiness: true,
      soldAt: true,
      soldPrice: true,
      retiredAt: true,
      retirementReason: true,
      retiredTo: true,
      location: { select: { name: true } },
      vendor: { select: { name: true } },
      lease: { select: { id: true, leaseName: true, leaseNumber: true, lender: true } },
      asset: {
        select: {
          id: true,
          name: true,
          manufacturer: true,
          marketPrice: true,
          depreciationMethod: true,
          usefulLifeMonths: true,
          salvageValue: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  // Distinct orders each unit has been on, in one query.
  const ids = units.map((unit) => unit.id);
  const orderCounts = new Map<string, number>();
  if (ids.length) {
    const counts = await prisma.$queryRaw<{ unitId: string; orders: bigint }[]>`
      select riu."assetUnitId" as "unitId", count(distinct ri."reservationId") as orders
        from reservation_item_units riu
        join reservation_items ri on ri.id = riu."reservationItemId"
       where riu."assetUnitId" = any(${ids})
       group by riu."assetUnitId"`;
    for (const row of counts) orderCounts.set(row.unitId, Number(row.orders));
  }

  const rows: FixedAssetRow[] = units.map((unit) => {
    const invoicePrice = unit.purchasePrice === null ? null : Number(unit.purchasePrice);
    // Landed cost: the invoice price plus the unit's share of its PO's extras.
    const cost = invoicePrice === null ? null : unitCost(invoicePrice, unit.landedCostAdjustment);
    const schedule = {
      method: unit.asset.depreciationMethod,
      usefulLifeMonths: unit.asset.usefulLifeMonths,
      salvageValue: unit.asset.salvageValue === null ? null : Number(unit.asset.salvageValue),
    };
    const value = bookValue(
      {
        purchasePrice: invoicePrice,
        landedCostAdjustment: Number(unit.landedCostAdjustment),
        purchaseDate: unit.purchaseDate,
        receivedDate: unit.receivedDate,
      },
      schedule,
      now,
    );
    const disposed = unit.status === "SOLD" || unit.status === "RETIRED";
    return {
      unitId: unit.id,
      assetId: unit.asset.id,
      barcode: unit.barcode,
      serialNumber: unit.serialNumber,
      model: unit.asset.name,
      manufacturer: unit.asset.manufacturer,
      category: unit.asset.category.name,
      status: unit.status,
      location: unit.location?.name ?? null,
      ownership: unit.ownershipType,
      financing:
        unit.lease || unit.loanName
          ? {
              leaseId: unit.lease?.id ?? null,
              name: unit.lease ? `${unit.lease.leaseName} (${unit.lease.leaseNumber})` : unit.loanName,
              lender: unit.lease?.lender ?? unit.fundingBusiness ?? null,
            }
          : null,
      vendor: unit.vendor?.name ?? null,
      purchaseDate: unit.purchaseDate,
      inServiceDate: unit.receivedDate ?? unit.purchaseDate,
      cost,
      marketValue: unit.asset.marketPrice === null ? null : Number(unit.asset.marketPrice),
      orders: orderCounts.get(unit.id) ?? 0,
      revenue: Number(unit.totalRevenue),
      maintenance: Number(unit.maintenanceCost),
      depreciation: value
        ? {
            method: schedule.method,
            lifeMonths: value.usefulLifeMonths,
            salvage: schedule.salvageValue ?? 0,
            monthsElapsed: value.monthsOwned,
            accumulated: value.accumulated,
            book: value.book,
            fullyDepreciated: value.fullyDepreciated,
          }
        : null,
      notValuedReason: value
        ? null
        : cost === null || cost <= 0
          ? "No purchase price"
          : !hasSchedule(schedule.method)
            ? `No schedule for ${METHOD_LABEL[schedule.method] ?? schedule.method}`
            : "No useful life",
      disposal: disposed
        ? {
            on: unit.status === "SOLD" ? unit.soldAt : unit.retiredAt,
            how:
              unit.status === "SOLD"
                ? "Sold"
                : [unit.retirementReason ? unit.retirementReason.toLowerCase().replace(/_/g, " ") : "retired", unit.retiredTo]
                    .filter(Boolean)
                    .join(" — "),
            proceeds: unit.soldPrice === null ? null : Number(unit.soldPrice),
          }
        : null,
    };
  });

  const totals: FixedAssetTotals = rows.reduce(
    (sum, row) => ({
      units: sum.units + 1,
      valued: sum.valued + (row.depreciation ? 1 : 0),
      notValued: sum.notValued + (row.depreciation ? 0 : 1),
      cost: sum.cost + (row.cost ?? 0),
      accumulated: sum.accumulated + (row.depreciation?.accumulated ?? 0),
      book: sum.book + (row.depreciation?.book ?? 0),
      marketValue: sum.marketValue + (row.marketValue ?? 0),
      revenue: sum.revenue + row.revenue,
      orders: sum.orders + row.orders,
      proceeds: sum.proceeds + (row.disposal?.proceeds ?? 0),
    }),
    { units: 0, valued: 0, notValued: 0, cost: 0, accumulated: 0, book: 0, marketValue: 0, revenue: 0, orders: 0, proceeds: 0 },
  );

  return { rows, totals, generatedAt: now };
}

export async function fixedAssetCategories() {
  return prisma.assetCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");
const cents = (value: number | null) => (value === null ? "" : value.toFixed(2));

/** The register as CSV — every column, for the accountants' own workbooks. */
export function fixedAssetsCsv(rows: FixedAssetRow[]): string {
  const header = [
    "Barcode", "Serial", "Model", "Manufacturer", "Category", "Status", "Location",
    "Ownership", "Financing", "Lender", "Vendor", "Purchase date", "In service",
    "Cost", "Market value", "Orders", "Revenue earned", "Maintenance",
    "Method", "Life (months)", "Salvage", "Months elapsed", "Accumulated depreciation", "Book value",
    "Fully depreciated", "Not valued because", "Disposed on", "Disposal", "Proceeds",
  ];
  const lines = rows.map((row) =>
    [
      row.barcode, row.serialNumber, row.model, row.manufacturer, row.category, row.status, row.location,
      OWNERSHIP_LABEL[row.ownership], row.financing?.name, row.financing?.lender, row.vendor,
      iso(row.purchaseDate), iso(row.inServiceDate), cents(row.cost), cents(row.marketValue), row.orders,
      cents(row.revenue), cents(row.maintenance),
      row.depreciation ? METHOD_LABEL[row.depreciation.method] ?? row.depreciation.method : "",
      row.depreciation?.lifeMonths, cents(row.depreciation?.salvage ?? null), row.depreciation?.monthsElapsed,
      cents(row.depreciation?.accumulated ?? null), cents(row.depreciation?.book ?? null),
      row.depreciation ? (row.depreciation.fullyDepreciated ? "yes" : "no") : "", row.notValuedReason,
      iso(row.disposal?.on ?? null), row.disposal?.how, cents(row.disposal?.proceeds ?? null),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
