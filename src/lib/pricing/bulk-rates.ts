/**
 * The arithmetic behind Operate → Pricing's bulk edit.
 *
 * Its own module because two sides need it and one of them is a browser: the
 * dialog previews old → new for every selected model, and `setAssetRatesBulk`
 * works out the figures it actually writes. Were this exported from the actions
 * file it would become a server action, and every keystroke in the dialog would
 * be a round trip to compute a multiplication. Kept here, the preview and the
 * write run the same function and cannot disagree.
 *
 * Client-safe: no server-only imports, the same rule as ./rates.ts.
 */

/**
 * What a bulk edit asks of one tier. A tier left out of the request is left
 * alone — that is how a blank field in the dialog says "unchanged", and it is
 * why there is no way to clear a rate from here: clearing is a per-model
 * decision about where `pickRate` falls through to, and the inline cell is
 * where that is made.
 */
export type BulkRateChange =
  | { mode: "set"; value: number }
  | { mode: "adjust"; percent: number };

/**
 * The new figure for one tier of one model. An adjustment on a tier with no
 * rate stays no rate — ten percent of nothing is not zero, it is still nothing
 * — and every result is rounded to cents the way a typed figure is.
 */
export function applyBulkChange(
  current: number | null,
  change: BulkRateChange,
): number | null {
  if (change.mode === "set") return roundCents(change.value);
  if (current === null) return null;
  return roundCents(current * (1 + change.percent / 100));
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Why a change cannot be made, or null when it can. The dialog shows this under
 * the field and the action refuses on it, so the rule lives in one place.
 */
export function bulkChangeProblem(change: BulkRateChange): string | null {
  if (change.mode === "set") {
    return Number.isFinite(change.value) && change.value >= 0
      ? null
      : "Enter an amount of zero or more.";
  }
  if (change.mode === "adjust") {
    // Below −100% every rate would go negative, which no price can be.
    return Number.isFinite(change.percent) && change.percent >= -100
      ? null
      : "Enter a percentage of −100 or more.";
  }
  return "Not a change this screen knows how to make.";
}
