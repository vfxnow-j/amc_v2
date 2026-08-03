/**
 * How v2 writes numbers and dates on screen.
 *
 * Centralised because the shipped screens had each declared their own
 * `Intl.NumberFormat`, and small divergences — cents on one table, none on the
 * next — read as bugs to anyone comparing two figures across the app.
 *
 * `Intl` formatters are expensive to construct and safe to reuse, so these are
 * module-level singletons rather than built per render.
 */

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const MONEY_EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
});

/** Whole dollars. The default for table cells — cents are noise in a column. */
export function money(value: number): string {
  return MONEY.format(value);
}

/** Cents shown. For anything a person will reconcile against a bank statement. */
export function moneyExact(value: number): string {
  return MONEY_EXACT.format(value);
}

/** "$1.24M". For header blurbs and totals, never for a row a clerk checks. */
export function moneyCompact(value: number): string {
  return MONEY_COMPACT.format(value);
}

export function day(value: Date): string {
  return DAY.format(value);
}

export function dayYear(value: Date): string {
  return DAY_YEAR.format(value);
}

/** "Aug 3 – Sep 12, 26" — the window a booking covers. */
export function windowLabel(start: Date, end: Date): string {
  return `${day(start)} – ${dayYear(end)}`;
}

/**
 * Whole days from `from` to `to`, negative when `to` is already past. Used for
 * expiry countdowns, which is why it floors rather than rounds: "expires in 0
 * days" must mean today, not "some time in the next 36 hours".
 */
export function daysUntil(to: Date, from: Date = new Date()): number {
  const MS_PER_DAY = 86_400_000;
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((end - start) / MS_PER_DAY);
}
