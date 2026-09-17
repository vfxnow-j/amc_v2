/**
 * Business dates and the billing anchor.
 *
 * **The convention: an order date is a calendar day stored at 12:00 UTC.**
 * Start, end, quote expiry, next billing date and invoice periods are days, not
 * instants, and they had been written three ways — UTC midnight by v2's
 * builder, Pacific midnight (`07:00Z`/`08:00Z`) by v1, and the raw moment an
 * order was created. Formatted on a Pacific server, a UTC-midnight date reads a
 * day early: the builder saved "Sep 25" and every screen said Sep 24, and a
 * next billing date of Oct 1 said Sep 30. Noon UTC falls on the same calendar
 * day from Hawaii to Central Europe, and it is what `lib/pricing/periods.ts`
 * (UTC components) and the old `calculateNextBillingDate` already assumed, so
 * one convention serves the formatter, the period math and the billing run.
 *
 * **The anchor is a business setting, not an order field.** Monthly bills on
 * one day of every month — the 1st, which is written into client agreements,
 * or the 15th or month end — and weekly bills on one weekday. A term that starts
 * between anchors bills a prorated stub up to the next anchor, then whole
 * periods on it.
 *
 * No server-only imports: the builder calls these in the browser and must land
 * on the dates the server stores.
 */

/** Where the business keeps its calendar. "Today" is today here. */
export const BUSINESS_TIME_ZONE = "America/Los_Angeles";

const MS_PER_DAY = 86_400_000;

/** A calendar day, as stored. Month is 0-indexed, like `Date`. */
export function calendarDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

/** `YYYY-MM-DD` from a date input → the stored day. Null when unparseable. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = calendarDay(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The stored day → `YYYY-MM-DD` for a date input. */
export function toDateInput(value: Date): string {
  const date = new Date(value);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The business's calendar day at an instant, as a stored day. */
export function businessDayOf(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return calendarDay(part("year"), part("month") - 1, part("day"));
}

/** Today, in the business's time zone — not UTC, which turns over at 5pm Pacific. */
export function businessToday(now: Date = new Date()): Date {
  return businessDayOf(now);
}

/**
 * Which calendar day a date already in the database was meant to be.
 *
 * - exactly midnight UTC → that UTC day (v2's builder wrote `new Date("YYYY-MM-DD")`)
 * - exactly noon UTC → already the convention
 * - anything else → the Pacific calendar day (v1 wrote Pacific midnight, and a
 *   raw creation timestamp was that day in the office)
 */
export function intendedDay(value: Date): Date {
  const date = new Date(value);
  const h = date.getUTCHours();
  const exact =
    date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  if (exact && (h === 0 || h === 12)) {
    return calendarDay(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return businessDayOf(date);
}

/** True when a stored value already follows the convention. */
export function isCalendarDay(value: Date): boolean {
  return intendedDay(value).getTime() === new Date(value).getTime();
}

export function addDays(day: Date, days: number): Date {
  return new Date(new Date(day).getTime() + days * MS_PER_DAY);
}

/** Whole days from `a` to `b`, both stored days. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY);
}

/* ── The anchor ─────────────────────────────────────────────────────────── */

/** Day of the month monthly billing falls on. "EOM" is the last day. */
export type MonthlyAnchor = 1 | 15 | "EOM";

export type BillingAnchor = {
  monthly: MonthlyAnchor;
  /** 0 = Sunday … 6 = Saturday. */
  weekly: number;
};

export const DEFAULT_BILLING_ANCHOR: BillingAnchor = { monthly: 1, weekly: 1 };

export const MONTHLY_ANCHOR_LABEL: Record<string, string> = {
  "1": "The 1st of the month",
  "15": "The 15th of the month",
  EOM: "The last day of the month",
};

export const WEEKDAY_LABEL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Cycles the anchor governs. Anything else keeps its legacy per-order rule. */
export type AnchoredCycle = "MONTHLY" | "WEEKLY";

export function isAnchoredCycle(cycle: string): cycle is AnchoredCycle {
  return cycle === "MONTHLY" || cycle === "WEEKLY";
}

function monthlyAnchorIn(year: number, month: number, anchor: MonthlyAnchor): Date {
  const normalized = new Date(Date.UTC(year, month, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  const day = anchor === "EOM" ? new Date(Date.UTC(y, m + 1, 0)).getUTCDate() : anchor;
  return calendarDay(y, m, day);
}

/** The latest anchor date on or before `day`. */
export function anchorOnOrBefore(day: Date, cycle: AnchoredCycle, anchor: BillingAnchor): Date {
  const d = intendedDay(day);
  if (cycle === "WEEKLY") {
    const back = (d.getUTCDay() - anchor.weekly + 7) % 7;
    return addDays(d, -back);
  }
  const here = monthlyAnchorIn(d.getUTCFullYear(), d.getUTCMonth(), anchor.monthly);
  return here.getTime() <= d.getTime()
    ? here
    : monthlyAnchorIn(d.getUTCFullYear(), d.getUTCMonth() - 1, anchor.monthly);
}

/** The first anchor date strictly after `day`. */
export function anchorAfter(day: Date, cycle: AnchoredCycle, anchor: BillingAnchor): Date {
  const base = anchorOnOrBefore(day, cycle, anchor);
  if (cycle === "WEEKLY") return addDays(base, 7);
  return monthlyAnchorIn(base.getUTCFullYear(), base.getUTCMonth() + 1, anchor.monthly);
}

/** The first anchor date on or after `day`. */
export function anchorOnOrAfter(day: Date, cycle: AnchoredCycle, anchor: BillingAnchor): Date {
  const d = intendedDay(day);
  const before = anchorOnOrBefore(d, cycle, anchor);
  return before.getTime() === d.getTime() ? d : anchorAfter(d, cycle, anchor);
}

/** One whole billing period that begins on an anchor date. End is inclusive. */
export function periodFromAnchor(
  anchorDate: Date,
  cycle: AnchoredCycle,
  anchor: BillingAnchor,
): { start: Date; end: Date } {
  const start = intendedDay(anchorDate);
  return { start, end: addDays(anchorAfter(start, cycle, anchor), -1) };
}

/**
 * The first stretch a term bills: from its start to the day before the next
 * anchor, as a fraction of the whole period it falls in.
 *
 * A start on an anchor is a whole period (fraction 1). A rental starting
 * Sep 20 on a 1st-of-month anchor bills Sep 20–30, 11 of September's 30 days,
 * and its next bill is Oct 1.
 */
export function firstBillingStretch(
  termStart: Date,
  cycle: AnchoredCycle,
  anchor: BillingAnchor,
): { start: Date; end: Date; fraction: number; nextBillingDate: Date } {
  const start = intendedDay(termStart);
  const periodStart = anchorOnOrBefore(start, cycle, anchor);
  const next = anchorAfter(start, cycle, anchor);
  const fullDays = daysBetween(periodStart, next);
  const billedDays = daysBetween(start, next);
  return {
    start,
    end: addDays(next, -1),
    fraction: fullDays > 0 ? billedDays / fullDays : 1,
    nextBillingDate: next,
  };
}

/**
 * How many periods' rate a stretch of days is worth: each anchor period it
 * overlaps counts for the share of that period's days it covers.
 *
 * `firstBillingStretch` covers a start inside one period. This covers the rest —
 * a backdated order whose first invoice spans September's stub and all of
 * October, or an invoice date left over from before the anchor moved, which
 * bills the stretch up to the new day rather than a whole period.
 * `toExclusive` is the next billing date.
 */
export function billedPeriods(
  from: Date,
  toExclusive: Date,
  cycle: AnchoredCycle,
  anchor: BillingAnchor,
): number {
  const start = intendedDay(from);
  const end = intendedDay(toExclusive);
  let total = 0;
  let periodStart = anchorOnOrBefore(start, cycle, anchor);
  // Bounded: a term would have to run for centuries to get near this.
  for (let guard = 0; guard < 5000 && periodStart.getTime() < end.getTime(); guard++) {
    const periodEnd = anchorAfter(periodStart, cycle, anchor);
    const overlapStart = Math.max(periodStart.getTime(), start.getTime());
    const overlapEnd = Math.min(periodEnd.getTime(), end.getTime());
    if (overlapEnd > overlapStart) {
      total += (overlapEnd - overlapStart) / (periodEnd.getTime() - periodStart.getTime());
    }
    periodStart = periodEnd;
  }
  return total;
}

/**
 * When an anchored order next bills, given where its term starts.
 *
 * The first anchor after the start — or, for an order that started in the
 * past, the first anchor after today, which is what the old calculation's
 * "advance until it is in the future" loop did. The first invoice then covers
 * the start up to this date, however many periods that is.
 */
export function nextAnchoredBillingDate(
  termStart: Date,
  cycle: AnchoredCycle,
  anchor: BillingAnchor,
  today: Date = businessToday(),
): Date {
  const start = intendedDay(termStart);
  const from = start.getTime() > today.getTime() ? start : today;
  return anchorAfter(from, cycle, anchor);
}

/**
 * The stretch an order's first invoice covers, or null when it bills whole.
 *
 * Only recurring rentals and cloud orders on an anchored cycle get one. A
 * rent-to-own bills fixed installments — prorating the first would leave the
 * count of payments short of the agreement — and a sale bills once.
 *
 * The stretch runs from the term start up to the scheduled next billing date,
 * so it is a stub for a start inside the month and more than one period for a
 * start that was backdated past an anchor.
 */
export function firstInvoiceStretch(
  order: {
    reservationType: string;
    isRecurring: boolean;
    billingCycleType: string;
    startDate: Date;
    nextBillingDate: Date | null;
  },
  anchor: BillingAnchor,
): { start: Date; end: Date; periods: number } | null {
  if (!order.isRecurring || !order.nextBillingDate) return null;
  if (order.reservationType !== "RENTAL" && order.reservationType !== "CLOUD") return null;
  if (!isAnchoredCycle(order.billingCycleType)) return null;
  const start = intendedDay(order.startDate);
  const next = intendedDay(order.nextBillingDate);
  if (next.getTime() <= start.getTime()) return null;
  return {
    start,
    end: addDays(next, -1),
    periods: billedPeriods(start, next, order.billingCycleType, anchor),
  };
}

const STRETCH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Sep 20 – Sep 30", for an invoice line. Read in UTC, where the stored day lives. */
export function stretchLabel(start: Date, end: Date): string {
  return `${STRETCH_DAY.format(start)} – ${STRETCH_DAY.format(end)}`;
}

/** "Sep 30", for a single stored day. */
export function dayLabel(day: Date): string {
  return STRETCH_DAY.format(day);
}
