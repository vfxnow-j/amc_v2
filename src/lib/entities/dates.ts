/**
 * When a movement happened, as typed by a person. Strict on purpose: the
 * ledger is append-only, so a lax parse ("1" becomes 2001) can never be fixed.
 *
 * Accepted:
 *  - `YYYY-MM-DD`, a real calendar day. Stored as noon UTC on that day, the
 *    project's convention for calendar days (calendarDay in billing/calendar.ts),
 *    which lands on the same date in the business timezone.
 *  - A full ISO datetime with an explicit offset or Z, e.g. 2026-10-20T14:30:00-07:00.
 *    A datetime without an offset is refused as ambiguous.
 * Bounded to 2000-01-01 through one day after `now`.
 */
export type ParsedDate = { ok: true; date: Date } | { ok: false; reason: string };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EARLIEST = Date.UTC(2000, 0, 1);
const bad = (reason: string): ParsedDate => ({ ok: false, reason });

export function parseOccurredAt(value: string, now: Date = new Date()): ParsedDate {
  const v = value.trim();
  let date: Date;
  const day = DAY.exec(v);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    date = new Date(Date.UTC(y, m - 1, d, 12));
    // Feb 31 rolls over into March; a real day round-trips.
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return bad("That date isn't valid.");
  } else if (DATETIME.test(v)) {
    date = new Date(v);
    if (Number.isNaN(date.getTime())) return bad("That date isn't valid.");
  } else {
    return bad("Enter the date as YYYY-MM-DD, or a full date and time with its time zone.");
  }
  if (date.getTime() < EARLIEST) return bad("That date is too far in the past.");
  if (date.getTime() > now.getTime() + 86_400_000) return bad("That date is in the future.");
  return { ok: true, date };
}
