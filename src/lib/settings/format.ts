/**
 * The one thing Settings writes that no other screen does: a time of day.
 *
 * Everywhere else in v2 a date is enough — an order ships on a day, an invoice
 * falls due on a day. The audit log and the document repository are different:
 * both are read to reconstruct a sequence, and "who changed it first" is
 * unanswerable from a date alone when six things happened on the same
 * afternoon.
 *
 * Kept out of `lib/format.ts` because that module is shared by every cluster
 * and this belongs to two screens. Same rule as the formatters there: `Intl`
 * instances are expensive to construct and safe to reuse, so it is built once.
 */

const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
  hour: "numeric",
  minute: "2-digit",
});

/** "Aug 3, 26, 2:14 PM" — a date somebody can line up against a story. */
export function stamp(value: Date): string {
  return STAMP.format(value);
}

/** "1.4 MB". File sizes are stored in bytes and read by people. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
