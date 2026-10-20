/**
 * Which backup sets to keep and which to delete.
 *
 * Pure: names in, decision out. No filesystem, so the same function drives the
 * cron script (via scripts/backup-rotate.ts) and the tests. A "set" is a
 * directory named by its UTC start time, `YYYYmmdd-HHMMSS`; anything whose name
 * is not exactly that is ignored and can never be deleted.
 *
 * Policy: the newest set of each of the 14 most recent days that have one,
 * plus the FIRST set of each of the 8 most recent ISO weeks that have one,
 * plus the newest set overall (which is always also a daily). Everything else
 * is deleted. Stamps are UTC so a daylight-saving change never shifts a set
 * across a day or week boundary.
 *
 * A stamp more than an hour AFTER `now` is not trusted: it is ignored (never
 * counted, never deleted), so a stray or planted future-dated directory can
 * neither become "the newest set" nor push real sets out of the window.
 */

export const FUTURE_SLACK_MS = 3_600_000;

export const DAILY_KEEP = 14;
export const WEEKLY_KEEP = 8;

const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

export type KeepReason = "newest" | "daily" | "weekly";

export type RotationDecision = {
  keep: { name: string; reasons: KeepReason[] }[];
  delete: string[];
  /** Names that are not a valid stamp; never touched. */
  ignored: string[];
};

/** The instant a stamp names, or null when it is not a real UTC date-time. */
export function parseStamp(name: string): Date | null {
  const m = STAMP.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s;
  return real ? date : null;
}

export function formatStamp(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/** ISO-8601 week key (`2026-W43`), using the ISO week-year, in UTC. */
export function isoWeekKey(date: Date): string {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // the Thursday of this week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The policy is relative to the sets that exist, not to the clock: a machine
 * that was off for a month must not wake up and delete every set it has. The
 * clock is used only to reject stamps from the future.
 */
export function decideRotation(
  names: readonly string[],
  now: Date = new Date(),
  opts: { daily?: number; weekly?: number } = {},
): RotationDecision {
  const dailyN = opts.daily ?? DAILY_KEEP;
  const weeklyN = opts.weekly ?? WEEKLY_KEEP;

  const ignored: string[] = [];
  const sets: { name: string; at: Date }[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const at = parseStamp(name);
    if (!at || at.getTime() > now.getTime() + FUTURE_SLACK_MS) ignored.push(name);
    else if (!seen.has(name)) {
      seen.add(name);
      sets.push({ name, at });
    }
  }
  sets.sort((a, b) => a.name.localeCompare(b.name)); // stamps sort chronologically

  const reasons = new Map<string, Set<KeepReason>>();
  const mark = (name: string, why: KeepReason) => {
    if (!reasons.has(name)) reasons.set(name, new Set());
    reasons.get(name)!.add(why);
  };

  if (sets.length) mark(sets[sets.length - 1].name, "newest");

  // Newest set of each day, for the most recent `dailyN` days.
  const newestOfDay = new Map<string, string>();
  for (const s of sets) newestOfDay.set(dayKey(s.at), s.name); // ascending, so last wins
  [...newestOfDay.keys()]
    .sort()
    .slice(-dailyN)
    .forEach((k) => mark(newestOfDay.get(k)!, "daily"));

  // First set of each ISO week, for the most recent `weeklyN` weeks.
  const firstOfWeek = new Map<string, string>();
  for (const s of sets) {
    const k = isoWeekKey(s.at);
    if (!firstOfWeek.has(k)) firstOfWeek.set(k, s.name); // ascending, so first wins
  }
  [...firstOfWeek.keys()]
    .sort()
    .slice(-weeklyN)
    .forEach((k) => mark(firstOfWeek.get(k)!, "weekly"));

  return {
    keep: sets
      .filter((s) => reasons.has(s.name))
      .map((s) => ({ name: s.name, reasons: [...reasons.get(s.name)!] })),
    delete: sets.filter((s) => !reasons.has(s.name)).map((s) => s.name),
    ignored,
  };
}
