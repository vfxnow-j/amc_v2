import {
  calculateDepreciatedValue,
  type DepreciationMethod,
} from "@/lib/utils/depreciation";

/**
 * What a unit is worth on the books, and when the answer is "we can't say".
 *
 * A thin guard over the ported `lib/utils/depreciation`, which is the one
 * schedule in the codebase and stays that way. The guard exists because that
 * function's `default` branch returns the **purchase price** for methods it
 * doesn't implement — `SUM_OF_YEARS` and `UNITS_OF_PRODUCTION` — and a screen
 * that prints the purchase price under the heading "Book value" is stating a
 * figure nobody computed. Every asset in the restored database is
 * `STRAIGHT_LINE` today, so nothing currently hits it; the guard is here so the
 * first asset that doesn't reads "no schedule" instead of "hasn't depreciated a
 * cent in five years".
 *
 * Prisma-free, like the rest of `lib/inventory` — these numbers are shown on
 * cards that may end up client-side, and an import that reaches `lib/prisma`
 * drags the pg driver into the browser bundle.
 */

/** Methods `calculateDepreciatedValue` actually runs a schedule for. */
const IMPLEMENTED: DepreciationMethod[] = ["STRAIGHT_LINE", "DECLINING_BALANCE"];

export function hasSchedule(method: string): method is DepreciationMethod {
  return IMPLEMENTED.includes(method as DepreciationMethod);
}

export type BookValue = {
  cost: number;
  book: number;
  /** Cost less book. What has been written off so far. */
  accumulated: number;
  /** True once the schedule has run its course and book value is salvage. */
  fullyDepreciated: boolean;
  monthsOwned: number;
  usefulLifeMonths: number;
};

/**
 * Book value of one unit, or null when the record can't support one.
 *
 * Null in three cases, all of them real in this data: no purchase price on the
 * unit, no useful life on the asset, or a depreciation method with no schedule.
 * Callers must count the nulls and say so rather than treating them as zero —
 * a unit worth an unknown amount is not a unit worth nothing.
 */
export function bookValue(
  {
    purchasePrice,
    purchaseDate,
    receivedDate,
  }: {
    purchasePrice: number | null;
    purchaseDate: Date;
    receivedDate: Date | null;
  },
  {
    method,
    usefulLifeMonths,
    salvageValue,
  }: {
    method: string;
    usefulLifeMonths: number;
    salvageValue: number | null;
  },
  now: Date = new Date(),
): BookValue | null {
  if (purchasePrice === null || purchasePrice <= 0) return null;
  if (!hasSchedule(method)) return null;
  if (!usefulLifeMonths || usefulLifeMonths <= 0) return null;

  const salvage = salvageValue ?? 0;
  const book = calculateDepreciatedValue(
    purchasePrice,
    purchaseDate,
    method,
    usefulLifeMonths,
    salvage,
    receivedDate,
  );

  // The same start date the schedule uses: received if we have it, ordered if
  // not. Depreciation runs from when the hardware arrived, not when it was paid
  // for, and on this import `receivedDate` is usually null.
  const start = receivedDate ?? purchaseDate;
  const monthsOwned = Math.max(
    0,
    Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)),
  );

  return {
    cost: purchasePrice,
    book,
    accumulated: purchasePrice - book,
    fullyDepreciated: monthsOwned >= usefulLifeMonths,
    monthsOwned,
    usefulLifeMonths,
  };
}

/**
 * Roll a set of units up into one position, keeping the unpriced ones countable.
 *
 * `valued` and `unvalued` are both returned because the totals are only
 * trustworthy alongside how much of the fleet they cover. "Book value $180,400"
 * means something different across 40 of 40 units than across 40 of 141.
 */
export function rollUp(values: (BookValue | null)[]) {
  const valued = values.filter((value): value is BookValue => value !== null);
  return {
    cost: valued.reduce((sum, value) => sum + value.cost, 0),
    book: valued.reduce((sum, value) => sum + value.book, 0),
    accumulated: valued.reduce((sum, value) => sum + value.accumulated, 0),
    fullyDepreciated: valued.filter((value) => value.fullyDepreciated).length,
    valued: valued.length,
    unvalued: values.length - valued.length,
  };
}
