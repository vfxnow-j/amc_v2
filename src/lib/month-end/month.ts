/** Month-end screen and export: which month, and stepping between months. */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The last full month, as YYYY-MM (UTC, like the roll-forward's month bounds). */
export function lastMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

/** A `?month=` value, or last month when it is missing or not a month. */
export function parseMonth(value: string | null | undefined, now: Date = new Date()): string {
  return value && MONTH.test(value) ? value : lastMonth(now);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
