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
  const written = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!written || !(DAY.test(v) || DATETIME.test(v))) {
    return bad("Enter the date as YYYY-MM-DD, or a full date and time with its time zone.");
  }
  // The day as written must be a real day: Feb 30 would otherwise roll over into March.
  const [y, m, d] = [Number(written[1]), Number(written[2]), Number(written[3])];
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return bad("That date isn't valid.");
  let date: Date;
  if (DAY.test(v)) {
    date = probe;
  } else {
    const hour = Number(v.slice(11, 13)), minute = Number(v.slice(14, 16));
    if (hour > 23 || minute > 59) return bad("That time isn't valid.");
    const sec = /^.{16}:(\d{2})/.exec(v);
    if (sec && Number(sec[1]) > 59) return bad("That time isn't valid.");
    const off = /([+-])(\d{2}):(\d{2})$/.exec(v);
    if (off && (Number(off[2]) * 60 + Number(off[3]) > 14 * 60 || Number(off[3]) > 59)) return bad("That time zone isn't valid.");
    date = new Date(v);
    if (Number.isNaN(date.getTime())) return bad("That date isn't valid.");
  }
  if (date.getTime() < EARLIEST) return bad("That date is too far in the past.");
  if (date.getTime() > now.getTime() + 86_400_000) return bad("That date is in the future.");
  return { ok: true, date };
}
