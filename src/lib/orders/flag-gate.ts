/**
 * The ship gate for flag cases: an open Critical flag stops an order shipping.
 *
 * Its own file, beside handover-rules, so the scan-gate rules stay about scans.
 * Pure: the caller counts the flags.
 */
export function criticalFlagBlock(openCritical: number): string | null {
  return openCritical > 0
    ? `${openCritical} critical flag${openCritical === 1 ? "" : "s"} open on this order. Resolve or override before shipping.`
    : null;
}
