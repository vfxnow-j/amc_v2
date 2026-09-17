import {
  addDays,
  calendarDay,
  daysBetween,
  intendedDay,
} from "@/lib/billing/calendar";
import { DAYS_PER_MONTH, DAYS_PER_WEEK, roundMoney } from "@/lib/pricing/periods";

/**
 * What extending an overdue rental bills (owner, 2026-09-16).
 *
 * Only a fixed-term rental is extended — a monthly or weekly one is recurring
 * and simply keeps billing. The extension runs from the day after the old
 * return date, so days it was already late are billed too, to the new one.
 * Each extension picks how:
 *
 * - **prorate** — the exact extra days, as a share of each line's rate period;
 * - **whole** — rounded up to whole periods of the order's billing unit, and the
 *   return date moves out to the end of those periods, so what is billed and
 *   what is booked agree.
 *
 * One-time charges are never re-billed, and a part included in its parent's
 * price carries no rate of its own. Pure, so the dialog previews the same
 * figures the server invoices.
 */

export type ExtensionMode = "prorate" | "whole";

export type ExtensionLine = {
  id: string;
  label: string;
  quantity: number;
  rate: number;
  pricingType: string;
  isOneTime: boolean;
  includedInParent?: boolean;
};

export type ExtensionQuote = {
  /** First day billed: the day after the old return date. */
  from: Date;
  /** The new return date — pushed to the end of whole periods in "whole" mode. */
  to: Date;
  days: number;
  lines: { id: string; label: string; quantity: number; rate: number; unit: string; periods: number; amount: number }[];
  total: number;
};

const UNIT: Record<string, { days: number; label: string }> = {
  DAILY: { days: 1, label: "day" },
  WEEKLY: { days: DAYS_PER_WEEK, label: "week" },
  MONTHLY: { days: DAYS_PER_MONTH, label: "month" },
};

/** The billing unit the order mostly runs on: the one carrying the most value. */
export function mainUnit(lines: ExtensionLine[]): string {
  const weight = new Map<string, number>();
  for (const line of lines) {
    if (line.isOneTime || line.includedInParent || !UNIT[line.pricingType]) continue;
    weight.set(line.pricingType, (weight.get(line.pricingType) ?? 0) + line.rate * line.quantity);
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "MONTHLY";
}

function addUnits(day: Date, unit: string, count: number): Date {
  const d = intendedDay(day);
  if (unit === "MONTHLY") {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + count;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return calendarDay(y, m, Math.min(d.getUTCDate(), last));
  }
  return addDays(d, count * (unit === "WEEKLY" ? 7 : 1));
}

export function quoteExtension(
  oldEnd: Date,
  newEnd: Date,
  mode: ExtensionMode,
  lines: ExtensionLine[],
): ExtensionQuote | null {
  const end = intendedDay(oldEnd);
  let to = intendedDay(newEnd);
  if (daysBetween(end, to) < 1) return null;

  const billable = lines.filter(
    (line) => !line.isOneTime && !line.includedInParent && UNIT[line.pricingType] && line.rate > 0,
  );

  if (mode === "whole") {
    // Round the stretch up to whole periods of the order's main unit, counted
    // from the old end, and move the return date to the end of them.
    const unit = mainUnit(billable);
    let count = 1;
    while (addUnits(end, unit, count).getTime() < to.getTime()) count++;
    to = addUnits(end, unit, count);
  }

  const days = daysBetween(end, to);
  const quoted = billable.map((line) => {
    const unit = UNIT[line.pricingType];
    const exact = days / unit.days;
    const periods = mode === "whole" ? Math.ceil(exact - 1e-9) : exact;
    return {
      id: line.id,
      label: line.label,
      quantity: line.quantity,
      rate: line.rate,
      unit: unit.label,
      periods,
      amount: roundMoney(line.rate * line.quantity * periods),
    };
  });

  return {
    from: addDays(end, 1),
    to,
    days,
    lines: quoted,
    total: roundMoney(quoted.reduce((sum, line) => sum + line.amount, 0)),
  };
}
