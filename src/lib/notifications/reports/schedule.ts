/**
 * When a scheduled report is due — cadence, day, hour, all in Pacific time.
 *
 * The shape is v1's inventory-report settings (`frequency`, `dayOfWeek`,
 * `dayOfMonth`, `hour`), so v1's stored `inventory_report_settings` row reads
 * straight in; `enabled` is v2's addition, absent means on.
 *
 * **How "due" works.** `/api/cron/reports` is polled hourly. A report is due on
 * the first poll at or after its hour, on a matching day. Each run claims that
 * day's *occurrence* ("2026-09-16") before sending, and a claimed occurrence is
 * never sent again — so two overlapping polls, a slow send or a restart can't
 * mail anyone twice. A poll that misses the hour still sends later the same day;
 * a day with no poll at all is skipped, not caught up the next morning, because
 * yesterday's inventory report is not what anyone wants today.
 *
 * Plain module, no Prisma: the schedule form (a client component) uses the
 * labels and `describeSchedule`.
 */

export const FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every other week",
  MONTHLY: "Monthly",
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type Schedule = {
  enabled: boolean;
  frequency: Frequency;
  /** 0 = Sunday. WEEKLY and BIWEEKLY. */
  dayOfWeek: number;
  /** 1–28, so every month has one. MONTHLY. */
  dayOfMonth: number;
  /** 0–23, Pacific. */
  hour: number;
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** A stored or submitted schedule, made complete and in range. Extra keys survive. */
export function normalizeSchedule<T extends Schedule>(raw: unknown, defaults: T): T {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ...defaults,
    ...stored,
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
    frequency: FREQUENCIES.includes(stored.frequency as Frequency) ? (stored.frequency as Frequency) : defaults.frequency,
    dayOfWeek: clamp(stored.dayOfWeek, 0, 6, defaults.dayOfWeek),
    dayOfMonth: clamp(stored.dayOfMonth, 1, 28, defaults.dayOfMonth),
    hour: clamp(stored.hour, 0, 23, defaults.hour),
  };
}

export function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/** "Every Monday at 11:00 AM PT." */
export function describeSchedule(schedule: Schedule): string {
  if (!schedule.enabled) return "Off — sends only when someone presses Send now.";
  const at = `${hourLabel(schedule.hour)} PT`;
  switch (schedule.frequency) {
    case "DAILY":
      return `Daily at ${at}.`;
    case "WEEKLY":
      return `Every ${DAY_NAMES[schedule.dayOfWeek]} at ${at}.`;
    case "BIWEEKLY":
      return `Every other ${DAY_NAMES[schedule.dayOfWeek]} at ${at}.`;
    case "MONTHLY":
      return `On the ${ordinal(schedule.dayOfMonth)} of each month at ${at}.`;
  }
}

export type PacificParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
  /** "2026-09-16" — the occurrence id. */
  dateKey: string;
};

export function pacificParts(at: Date): PacificParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU builds render midnight as "24".
    hour: Number(parts.hour) % 24,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Whole days between two "YYYY-MM-DD" keys. */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function dayMatches(schedule: Schedule, p: PacificParts): boolean {
  switch (schedule.frequency) {
    case "DAILY":
      return true;
    case "WEEKLY":
    case "BIWEEKLY":
      return p.weekday === schedule.dayOfWeek;
    case "MONTHLY":
      return p.day === schedule.dayOfMonth;
  }
}

export type Due = { due: true; occurrence: string } | { due: false; reason: string };

/**
 * Is this report due now, given the last occurrence that was claimed?
 *
 * Every other week counts from the last occurrence actually sent: the first run
 * on the chosen weekday starts the rhythm, and the next is fourteen days on.
 */
export function isDue(schedule: Schedule, lastOccurrence: string | null, now: Date): Due {
  if (!schedule.enabled) return { due: false, reason: "off" };
  const p = pacificParts(now);
  if (!dayMatches(schedule, p)) return { due: false, reason: "not today" };
  if (p.hour < schedule.hour) return { due: false, reason: "later today" };
  if (lastOccurrence === p.dateKey) return { due: false, reason: "already sent today" };
  if (schedule.frequency === "BIWEEKLY" && lastOccurrence && daysBetween(lastOccurrence, p.dateKey) < 14) {
    return { due: false, reason: "off week" };
  }
  return { due: true, occurrence: p.dateKey };
}

/**
 * The next Pacific date and hour this would send, as a label. Walks forward day
 * by day — at most 62 — rather than doing calendar arithmetic across DST.
 */
export function nextRunLabel(schedule: Schedule, lastOccurrence: string | null, now: Date): string | null {
  if (!schedule.enabled) return null;
  for (let offset = 0; offset < 62; offset += 1) {
    const probe = new Date(now.getTime() + offset * 86_400_000);
    const p = pacificParts(probe);
    if (!dayMatches(schedule, p)) continue;
    // Today counts unless it already went: past the hour but unsent means the
    // next hourly poll sends it.
    if (offset === 0 && lastOccurrence === p.dateKey) continue;
    if (schedule.frequency === "BIWEEKLY" && lastOccurrence && daysBetween(lastOccurrence, p.dateKey) < 14) continue;
    if (offset === 0 && pacificParts(now).hour > schedule.hour) return "at the next hourly check";
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
    const label = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    return `${label}, ${hourLabel(schedule.hour)} PT`;
  }
  return null;
}
