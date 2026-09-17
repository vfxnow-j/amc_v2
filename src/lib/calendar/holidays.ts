/**
 * US holidays for the calendar and for ship dates (owner, 2026-09-17).
 *
 * Federal holidays, on the day they are observed: one falling on a Saturday is
 * observed the Friday before, on a Sunday the Monday after. Computed, not
 * listed, so there is no table to go stale each year. Prisma-free and
 * dependency-free — the shipping dialog runs this in the browser.
 *
 * `carrierClosed` marks the days the parcel and freight carriers don't pick up
 * or deliver — New Year's, Memorial Day, Independence Day, Labor Day,
 * Thanksgiving and Christmas. On the others (MLK, Presidents', Juneteenth,
 * Columbus, Veterans) the carriers run, so ship dates don't step over them.
 */

export type Holiday = { name: string; carrierClosed: boolean };

/** `YYYY-MM-DD` for a UTC year/month/day. */
function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** A fixed-date holiday moved to its observed weekday. */
function observed(year: number, month: number, day: number): [number, number, number] {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(day - 1);
  if (weekday === 0) date.setUTCDate(day + 1);
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}

const cache = new Map<number, Map<string, Holiday>>();

/** Every holiday observed in a year, keyed `YYYY-MM-DD`. */
export function holidaysIn(year: number): Map<string, Holiday> {
  const hit = cache.get(year);
  if (hit) return hit;
  const days = new Map<string, Holiday>();
  const fixed = (month: number, day: number, name: string, carrierClosed: boolean) => {
    const [y, m, d] = observed(year, month, day);
    days.set(iso(y, m, d), { name, carrierClosed });
  };
  const floating = (month: number, weekday: number, n: number, name: string, carrierClosed: boolean) =>
    days.set(iso(year, month, nthWeekday(year, month, weekday, n)), { name, carrierClosed });

  fixed(0, 1, "New Year's Day", true);
  floating(0, 1, 3, "Martin Luther King Jr. Day", false);
  floating(1, 1, 3, "Presidents' Day", false);
  floating(4, 1, -1, "Memorial Day", true);
  fixed(5, 19, "Juneteenth", false);
  fixed(6, 4, "Independence Day", true);
  floating(8, 1, 1, "Labor Day", true);
  floating(9, 1, 2, "Columbus Day", false);
  fixed(10, 11, "Veterans Day", false);
  floating(10, 4, 4, "Thanksgiving", true);
  fixed(11, 25, "Christmas Day", true);
  cache.set(year, days);
  return days;
}

/** The holiday on a stored day (noon UTC), if any. */
export function holidayOn(day: Date): Holiday | null {
  const year = day.getUTCFullYear();
  const key = iso(year, day.getUTCMonth(), day.getUTCDate());
  // An observed New Year's can fall on Dec 31 of the year before.
  return holidaysIn(year).get(key) ?? holidaysIn(year + 1).get(key) ?? null;
}

/** A holiday for a calendar-grid day built from local date parts. */
export function holidayOnLocal(date: Date): Holiday | null {
  const year = date.getFullYear();
  const key = iso(year, date.getMonth(), date.getDate());
  return holidaysIn(year).get(key) ?? holidaysIn(year + 1).get(key) ?? null;
}
