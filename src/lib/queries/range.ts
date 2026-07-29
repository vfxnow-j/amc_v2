import {
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";

/**
 * The header's segmented control. Kept apart from the query module on purpose:
 * the control is a client component, and importing anything that reaches
 * `lib/prisma` would pull the pg driver into the browser bundle.
 */
export type Range = "today" | "week" | "month";

export function isRange(value: unknown): value is Range {
  return value === "today" || value === "week" || value === "month";
}

export const RANGE_LABEL: Record<Range, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
};

/** Current window, and the one before it for a like-for-like comparison. */
export function windowFor(range: Range, now: Date) {
  if (range === "today") {
    return {
      from: startOfDay(now),
      previousFrom: startOfDay(subDays(now, 1)),
      previousTo: subDays(now, 1),
      comparedTo: "yesterday",
    };
  }
  if (range === "week") {
    return {
      from: startOfWeek(now, { weekStartsOn: 1 }),
      previousFrom: startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }),
      previousTo: subWeeks(now, 1),
      comparedTo: "last week",
    };
  }
  return {
    from: startOfMonth(now),
    previousFrom: startOfMonth(subMonths(now, 1)),
    previousTo: subMonths(now, 1),
    comparedTo: "last month",
  };
}
