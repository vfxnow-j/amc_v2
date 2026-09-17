import { prisma } from "@/lib/prisma";
import { IN_FLEET } from "@/lib/inventory/availability";
import { bookValue, hasSchedule } from "@/lib/inventory/depreciation";
import { pacificParts, type Frequency } from "@/lib/notifications/reports/schedule";

/**
 * The depreciation report: what the fleet cost, what has been written off, what
 * it is worth on the books, this period's expense, and what is — or is about to
 * be — fully depreciated.
 *
 * **No second schedule.** Every figure comes from `bookValue` in
 * `lib/inventory/depreciation`, the guard over `calculateDepreciatedValue` in
 * `lib/utils/depreciation` — the same pair the model and unit records use. Its
 * rules are therefore this report's rules, stated once here so accounting can
 * read them: straight-line (or declining balance) from the received date, or
 * the purchase date when nothing was received; a "month" is 30 days, counted in
 * whole months; salvage is the floor; methods without a schedule
 * (SUM_OF_YEARS, UNITS_OF_PRODUCTION) and units without a purchase price are
 * excluded and listed, never valued at cost or at zero.
 *
 * **Period expense** is book value at the period's start less book value at its
 * end, per unit, over the fleet as it stands now. A unit that entered service
 * during the period starts at cost. A unit sold or retired during the period is
 * not in today's fleet and so not in the figure — the report says so.
 *
 * Plain server module, no auth; the report runner and its preview call it.
 */

const DAY_MS = 86_400_000;
/** The schedule's own month. */
const SCHEDULE_MONTH_MS = 30 * DAY_MS;
export const HORIZON_DAYS = 90;

/** The instant a Pacific calendar date begins. Found by correction, so DST can't skew it. */
function pacificMidnight(year: number, month: number, day: number): Date {
  let guess = Date.UTC(year, month - 1, day, 8);
  for (let i = 0; i < 3; i += 1) {
    const p = pacificParts(new Date(guess));
    const drift = Date.UTC(p.year, p.month - 1, p.day, p.hour) - Date.UTC(year, month - 1, day, 0);
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

export type Period = { start: Date; end: Date; label: string };

const LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

/**
 * The period a report covers, ending at the start of today (Pacific): the last
 * full calendar month for a monthly report — what accounting closes — and the
 * last 1, 7 or 14 whole days otherwise.
 */
export function periodFor(frequency: Frequency, now: Date): Period {
  const p = pacificParts(now);
  const end = pacificMidnight(p.year, p.month, p.day);
  if (frequency === "MONTHLY") {
    const monthStart = pacificMidnight(p.year, p.month, 1);
    const prev = p.month === 1 ? { y: p.year - 1, m: 12 } : { y: p.year, m: p.month - 1 };
    const start = pacificMidnight(prev.y, prev.m, 1);
    const name = new Date(Date.UTC(prev.y, prev.m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return { start, end: monthStart, label: name };
  }
  const days = frequency === "DAILY" ? 1 : frequency === "WEEKLY" ? 7 : 14;
  const start = new Date(end.getTime() - days * DAY_MS);
  const last = new Date(end.getTime() - DAY_MS);
  return { start, end, label: days === 1 ? LABEL.format(start) : `${LABEL.format(start)} – ${LABEL.format(last)}` };
}

export type DepreciationUnit = {
  barcode: string;
  serialNumber: string | null;
  model: string;
  family: string | null;
  category: string;
  status: string;
  ownership: string;
  purchaseDate: Date;
  inServiceDate: Date;
  /** True when the schedule runs from the purchase date because nothing was received. */
  fromPurchaseDate: boolean;
  cost: number;
  salvage: number;
  usefulLifeMonths: number;
  method: string;
  monthsInService: number;
  accumulated: number;
  book: number;
  periodExpense: number;
  fullyDepreciated: boolean;
  fullyDepreciatedOn: Date;
};

export type ExcludedUnit = { barcode: string; model: string; reason: string };

export type GroupRow = {
  /** The family, or the model when it has none. */
  name: string;
  grouped: boolean;
  units: number;
  cost: number;
  accumulated: number;
  book: number;
  periodExpense: number;
  fullyDepreciated: number;
};

export type DepreciationReport = {
  asOf: Date;
  period: Period;
  totals: {
    fleetUnits: number;
    valuedUnits: number;
    cost: number;
    accumulated: number;
    book: number;
    periodExpense: number;
    fullyDepreciated: number;
    fullyDepreciatingSoon: number;
  };
  groups: GroupRow[];
  fullyDepreciated: DepreciationUnit[];
  fullyDepreciatingSoon: DepreciationUnit[];
  units: DepreciationUnit[];
  excluded: ExcludedUnit[];
  /** What the figures rest on, measured on this run. */
  notes: {
    fromPurchaseDate: number;
    defaultLife: number;
    withSalvage: number;
    purchaseDateIsRecordDate: number;
  };
};

const round = (value: number) => Math.round(value * 100) / 100;

export async function buildDepreciationReport(frequency: Frequency, now: Date = new Date()): Promise<DepreciationReport> {
  const period = periodFor(frequency, now);
  const soon = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);

  const rows = await prisma.assetUnit.findMany({
    where: { status: { in: IN_FLEET } },
    orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
    select: {
      barcode: true,
      serialNumber: true,
      status: true,
      ownershipType: true,
      purchaseDate: true,
      receivedDate: true,
      purchasePrice: true,
      createdAt: true,
      asset: {
        select: {
          name: true,
          depreciationMethod: true,
          usefulLifeMonths: true,
          salvageValue: true,
          family: { select: { name: true } },
          category: { select: { name: true } },
        },
      },
    },
  });

  const units: DepreciationUnit[] = [];
  const excluded: ExcludedUnit[] = [];
  const notes = { fromPurchaseDate: 0, defaultLife: 0, withSalvage: 0, purchaseDateIsRecordDate: 0 };

  for (const row of rows) {
    const price = row.purchasePrice === null ? null : Number(row.purchasePrice);
    const schedule = {
      method: row.asset.depreciationMethod,
      usefulLifeMonths: row.asset.usefulLifeMonths,
      salvageValue: row.asset.salvageValue === null ? null : Number(row.asset.salvageValue),
    };
    const unit = { purchasePrice: price, purchaseDate: row.purchaseDate, receivedDate: row.receivedDate };
    const nowValue = bookValue(unit, schedule, now);

    if (!nowValue) {
      excluded.push({
        barcode: row.barcode,
        model: row.asset.name,
        reason:
          price === null || price <= 0
            ? "No purchase price"
            : !hasSchedule(schedule.method)
              ? `No schedule for ${String(schedule.method).toLowerCase().replace(/_/g, " ")}`
              : "No useful life",
      });
      continue;
    }

    const inService = row.receivedDate ?? row.purchaseDate;
    const bookAt = (at: Date) => (at <= inService ? nowValue.cost : (bookValue(unit, schedule, at)?.book ?? nowValue.cost));
    const periodExpense = Math.max(0, bookAt(period.start) - bookAt(period.end));

    if (!row.receivedDate) notes.fromPurchaseDate += 1;
    if (schedule.usefulLifeMonths === 60) notes.defaultLife += 1;
    if ((schedule.salvageValue ?? 0) > 0) notes.withSalvage += 1;
    if (row.purchaseDate.toISOString().slice(0, 10) === row.createdAt.toISOString().slice(0, 10)) notes.purchaseDateIsRecordDate += 1;

    units.push({
      barcode: row.barcode,
      serialNumber: row.serialNumber,
      model: row.asset.name,
      family: row.asset.family?.name ?? null,
      category: row.asset.category.name,
      status: row.status,
      ownership: row.ownershipType,
      purchaseDate: row.purchaseDate,
      inServiceDate: inService,
      fromPurchaseDate: !row.receivedDate,
      cost: nowValue.cost,
      salvage: schedule.salvageValue ?? 0,
      usefulLifeMonths: nowValue.usefulLifeMonths,
      method: schedule.method,
      monthsInService: nowValue.monthsOwned,
      accumulated: round(nowValue.accumulated),
      book: round(nowValue.book),
      periodExpense: round(periodExpense),
      fullyDepreciated: nowValue.fullyDepreciated,
      fullyDepreciatedOn: new Date(inService.getTime() + nowValue.usefulLifeMonths * SCHEDULE_MONTH_MS),
    });
  }

  const groupMap = new Map<string, GroupRow>();
  for (const unit of units) {
    const name = unit.family ?? unit.model;
    const key = `${unit.family ? "f" : "m"}:${name}`;
    const group = groupMap.get(key) ?? { name, grouped: !!unit.family, units: 0, cost: 0, accumulated: 0, book: 0, periodExpense: 0, fullyDepreciated: 0 };
    group.units += 1;
    group.cost += unit.cost;
    group.accumulated += unit.accumulated;
    group.book += unit.book;
    group.periodExpense += unit.periodExpense;
    if (unit.fullyDepreciated) group.fullyDepreciated += 1;
    groupMap.set(key, group);
  }
  const groups = [...groupMap.values()]
    .map((group) => ({ ...group, cost: round(group.cost), accumulated: round(group.accumulated), book: round(group.book), periodExpense: round(group.periodExpense) }))
    .sort((a, b) => b.cost - a.cost);

  const fullyDepreciated = units.filter((unit) => unit.fullyDepreciated).sort((a, b) => a.fullyDepreciatedOn.getTime() - b.fullyDepreciatedOn.getTime());
  const fullyDepreciatingSoon = units
    .filter((unit) => !unit.fullyDepreciated && unit.fullyDepreciatedOn <= soon)
    .sort((a, b) => a.fullyDepreciatedOn.getTime() - b.fullyDepreciatedOn.getTime());

  const sum = (pick: (unit: DepreciationUnit) => number) => round(units.reduce((total, unit) => total + pick(unit), 0));

  return {
    asOf: now,
    period,
    totals: {
      fleetUnits: rows.length,
      valuedUnits: units.length,
      cost: sum((unit) => unit.cost),
      accumulated: sum((unit) => unit.accumulated),
      book: sum((unit) => unit.book),
      periodExpense: sum((unit) => unit.periodExpense),
      fullyDepreciated: fullyDepreciated.length,
      fullyDepreciatingSoon: fullyDepreciatingSoon.length,
    },
    groups,
    fullyDepreciated,
    fullyDepreciatingSoon,
    units,
    excluded,
    notes,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Every date column as a Pacific calendar day. Purchase and received dates are
 * stored as Pacific midnights (07:00 or 08:00 UTC for 2,152 of 2,635 units), so
 * reading them in UTC would be right by accident and wrong for the rest.
 */
const ISO_DAY = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = typeof value === "number" ? value.toFixed(2) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per valued unit, plain columns, ISO dates, two-decimal amounts, no
 * currency symbols — what an accounting import expects. Excluded units are not
 * rows here (they have no figures to import); the email and PDF list them.
 */
export function depreciationCsv(report: DepreciationReport): string {
  const header = [
    "as_of",
    "period_start",
    "period_end",
    "barcode",
    "serial_number",
    "model",
    "family",
    "category",
    "status",
    "ownership",
    "purchase_date",
    "in_service_date",
    "in_service_from",
    "cost",
    "salvage_value",
    "useful_life_months",
    "method",
    "months_in_service",
    "accumulated_depreciation",
    "net_book_value",
    "period_expense",
    "fully_depreciated",
    "fully_depreciated_on",
  ];
  const lines = report.units.map((unit) =>
    [
      ISO_DAY(report.asOf),
      ISO_DAY(report.period.start),
      ISO_DAY(new Date(report.period.end.getTime() - 1)),
      unit.barcode,
      unit.serialNumber,
      unit.model,
      unit.family,
      unit.category,
      unit.status,
      unit.ownership,
      ISO_DAY(unit.purchaseDate),
      ISO_DAY(unit.inServiceDate),
      unit.fromPurchaseDate ? "purchase_date" : "received_date",
      unit.cost,
      unit.salvage,
      String(unit.usefulLifeMonths),
      unit.method,
      String(unit.monthsInService),
      unit.accumulated,
      unit.book,
      unit.periodExpense,
      unit.fullyDepreciated ? "Y" : "N",
      ISO_DAY(unit.fullyDepreciatedOn),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
