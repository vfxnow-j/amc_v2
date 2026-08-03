import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getFullInventoryReport } from "@/lib/actions/reports";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { IN_FLEET as FLEET_STATUSES } from "@/lib/inventory/availability";
import { UNSETTLED } from "@/lib/queries/revenue";

/**
 * Queries behind the Reports cluster.
 *
 * Most of the reports read `lib/actions/reports.ts`, which came across from v1
 * intact and is already right. What lives here is the two places where it
 * isn't:
 *
 * - **Revenue.** Every figure in the ported module is a sum over invoices at
 *   `status: PAID`. This database holds no paid invoice at all — 32 drafts, 2
 *   sent, 1 void — so every one of those reports reads exactly $0, which is
 *   not what the business earned, it is what has been marked collected. The
 *   Overview settled this months ago by accruing revenue in
 *   `lib/analytics/earned-revenue`, and the reports use the same basis so two
 *   screens never disagree about the same month.
 * - **Pricing.** `market-prices/analyzer` runs two queries per asset and then
 *   re-reads the same settings row each time — 224 assets is about 450
 *   round trips for one table. Same arithmetic, one pass.
 */

/* ── The index ──────────────────────────────────────────────────────────── */

/**
 * A unit that can still earn, as a `where` fragment.
 *
 * The statuses come from `lib/inventory/availability`, which is the one place
 * that says what fleet means — retired and sold hardware is out of it by
 * definition, and a report that counted either would disagree with the Assets
 * list about the same shelf.
 */
const IN_FLEET: Prisma.AssetUnitWhereInput = { status: { in: FLEET_STATUSES } };

/**
 * Wrapped in `cache` because the index reads it twice — once for the header
 * blurb, once for the revenue panel, each behind its own Suspense boundary.
 * Without it the earned-revenue accrual runs twice per request for one figure.
 */
export const getReportsHeader = cache(async function getReportsHeader(
  now = new Date(),
) {
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [fleet, out, assets, earned, invoiced, owed] = await Promise.all([
    prisma.assetUnit.count({ where: IN_FLEET }),
    prisma.assetUnit.count({ where: { status: "CHECKED_OUT" } }),
    prisma.asset.count(),
    getEarnedRevenue(yearStart, now),
    prisma.invoice.aggregate({
      where: {
        status: { notIn: ["CANCELLED", "VOID", "DRAFT"] },
        issueDate: { gte: yearStart },
      },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { AND: [UNSETTLED, { issueDate: { gte: yearStart } }] },
      _sum: { total: true, amountPaid: true },
    }),
  ]);

  return {
    fleet,
    out,
    assets,
    earned,
    since: yearStart,
    invoiced: {
      total: Number(invoiced._sum.total ?? 0),
      paid: Number(invoiced._sum.amountPaid ?? 0),
      count: invoiced._count,
      owed:
        Number(owed._sum.total ?? 0) - Number(owed._sum.amountPaid ?? 0),
    },
  };
});

/* ── Stock count ────────────────────────────────────────────────────────── */

/**
 * How many of each item are where, for the sheet somebody walks the warehouse
 * with.
 *
 * Written here rather than read from `actions/reports.getStockCountReport`,
 * which excludes only RETIRED units. That leaves SOLD hardware in the Total
 * column and in none of the four state columns, so lines don't add up — one
 * asset in this database reads "1 free, 1 out, total 8". Six of those eight
 * units have been sold, and a stock sheet whose total disagrees with the room
 * is worse than no sheet.
 *
 * Fleet is the same definition as everywhere else: available, out, reserved,
 * in service. Those four columns are the total, by construction.
 */
export async function getStockCount() {
  const assets = await prisma.asset.findMany({
    where: { units: { some: IN_FLEET } },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      units: { where: IN_FLEET, select: { status: true } },
    },
  });

  const items = assets.map((asset) => {
    const count = (status: string) =>
      asset.units.filter((unit) => unit.status === status).length;
    return {
      id: asset.id,
      name: asset.name,
      category: asset.category.name,
      free: count("AVAILABLE"),
      out: count("CHECKED_OUT"),
      reserved: count("RESERVED"),
      service: count("MAINTENANCE"),
      total: asset.units.length,
    };
  });

  const sum = (key: "free" | "out" | "reserved" | "service" | "total") =>
    items.reduce((total, item) => total + item[key], 0);

  return {
    items,
    summary: {
      assets: items.length,
      free: sum("free"),
      out: sum("out"),
      reserved: sum("reserved"),
      service: sum("service"),
      total: sum("total"),
    },
  };
}

/* ── Forecast ───────────────────────────────────────────────────────────── */

/**
 * Whether the forecast's recurring column can be believed.
 *
 * `getForecastReport` counts a recurring order into a month by looking for its
 * `nextBillingDate` inside that month. That column is advanced by the nightly
 * recurring-billing job, and in v2 nothing runs it — so most live recurring
 * orders sit on a date that has already passed, fall into no future month, and
 * the recurring line reads far lower than the business is actually contracted
 * for.
 *
 * It is not fixable from a report, and it must not be silently smoothed over
 * either: a forecast that quietly omits contracted income is worse than one
 * that says it is missing some. So the screen states how many are stranded and
 * what they are worth per cycle, which is provable, instead of inventing a
 * schedule for them.
 */
export async function getRecurringBillingHealth(now = new Date()) {
  const live: Prisma.ReservationWhereInput = {
    isRecurring: true,
    status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] },
  };

  const [total, stranded] = await Promise.all([
    prisma.reservation.count({ where: live }),
    prisma.reservation.aggregate({
      where: {
        AND: [
          live,
          { OR: [{ nextBillingDate: null }, { nextBillingDate: { lt: now } }] },
        ],
      },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  return {
    live: total,
    stranded: stranded._count,
    perCycle: Number(stranded._sum.total ?? 0),
  };
}

/* ── Inventory ──────────────────────────────────────────────────────────── */

/**
 * The ported full-inventory report, read once per request.
 *
 * The screen wants it three times — summary, tabs, table — and it computes a
 * depreciated book value for every unit in the fleet, so running it three
 * times is three passes over two thousand rows to render one page. The action
 * itself is left alone; `cache` is the whole fix.
 */
export const getInventoryReport = cache(() => getFullInventoryReport());

/* ── Pricing ────────────────────────────────────────────────────────────── */

/**
 * How long a rate is meant to take to pay an asset back. Stored in settings by
 * the market-price tooling; seven months is what `market-prices/analyzer`
 * falls back to and the two must agree or the same asset gets two verdicts.
 */
const DEFAULT_TARGET_MONTHS = 7;
const STALE_AFTER_DAYS = 30;

export type PricingVerdict = "underpriced" | "fair" | "overpriced" | "unrated";

export type PricingRow = {
  id: string;
  name: string;
  category: string;
  units: number;
  avgCost: number | null;
  marketPrice: number | null;
  marketStale: boolean;
  monthlyRate: number | null;
  paybackMonths: number | null;
  revenue: number;
  roi: number | null;
  suggestedMonthly: number | null;
  verdict: PricingVerdict;
};

/** `cache`d: the screen reads it three times — blurb, tabs and table. */
export const getPricing = cache(async function getPricing(now = new Date()) {
  const [setting, assets] = await Promise.all([
    prisma.setting.findUnique({
      where: { key: "market_price_roi_target_months" },
    }),
    prisma.asset.findMany({
      where: { totalQuantity: { gt: 0 }, units: { some: IN_FLEET } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        monthlyRate: true,
        marketPrice: true,
        marketPriceUpdatedAt: true,
        category: { select: { name: true } },
        units: {
          where: IN_FLEET,
          select: { purchasePrice: true, totalRevenue: true },
        },
      },
    }),
  ]);

  const parsed = Number(setting?.value);
  const targetMonths =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TARGET_MONTHS;
  const staleBefore = now.getTime() - STALE_AFTER_DAYS * 86_400_000;

  const rows: PricingRow[] = assets.map((asset) => {
    const cost = asset.units.reduce(
      (sum, unit) => sum + Number(unit.purchasePrice ?? 0),
      0,
    );
    const revenue = asset.units.reduce(
      (sum, unit) => sum + Number(unit.totalRevenue ?? 0),
      0,
    );
    const avgCost = cost > 0 ? cost / asset.units.length : null;
    const monthlyRate = asset.monthlyRate ? Number(asset.monthlyRate) : null;
    const marketPrice = asset.marketPrice ? Number(asset.marketPrice) : null;

    // Payback is read against what the units actually cost, not against the
    // market reference — the question is when this hardware pays for itself,
    // and the money that left the account is the only figure that can answer
    // it.
    const paybackMonths =
      avgCost !== null && monthlyRate !== null && monthlyRate > 0
        ? Math.round((avgCost / monthlyRate) * 10) / 10
        : null;

    const base = marketPrice ?? avgCost;

    return {
      id: asset.id,
      name: asset.name,
      category: asset.category.name,
      units: asset.units.length,
      avgCost,
      marketPrice,
      marketStale:
        marketPrice !== null &&
        (asset.marketPriceUpdatedAt === null ||
          asset.marketPriceUpdatedAt.getTime() < staleBefore),
      monthlyRate,
      paybackMonths,
      revenue,
      roi: cost > 0 ? Math.round((revenue / cost) * 100) / 100 : null,
      suggestedMonthly:
        base !== null && base > 0
          ? Math.round((base / targetMonths) * 100) / 100
          : null,
      // v1's thresholds, unchanged: over ten months to pay back is underpriced,
      // under three is overpriced. "Unrated" is its `unknown` renamed, because
      // there is nothing unknown about it — the asset has no monthly rate, or
      // no unit on it carries a purchase price, and the verdict says which.
      verdict:
        paybackMonths === null
          ? "unrated"
          : paybackMonths > 10
            ? "underpriced"
            : paybackMonths < 3
              ? "overpriced"
              : "fair",
    };
  });

  return { rows, targetMonths, staleAfterDays: STALE_AFTER_DAYS };
});
