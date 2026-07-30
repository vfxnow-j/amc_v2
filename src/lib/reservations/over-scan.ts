/**
 * The over-scan guard.
 *
 * v1 resolved "a 7th unit scanned onto a line of 6" by silently widening the
 * order: `quantity = checkedOutCount + 1`, and the line's subtotal recomputed
 * with it. A physical act at the shelf rewrote what the client had agreed to
 * buy, and moved the price, with nobody asked and nothing recorded.
 *
 * That is also how the custody import doubled 48 lines. It seeded
 * `checkedOutCount` equal to `quantity`, so the very first scan tripped the
 * condition and every unit after it widened the order by one — quantity and
 * counter climbing in lockstep to exactly twice the units. Two priced orders
 * are overstated by $1,430 as a result.
 *
 * So the widening still exists, but it is no longer a side effect: the caller
 * has to say which resolution it wants, and "expand" is a decision somebody
 * made rather than a default nobody saw. The design handoff's rule for every
 * conflict applies — offer a way out, never a dead end, and never a silent one.
 */

export type OverScanResolution =
  /** Widen the line and reprice it. The client is being charged for more. */
  | "expand"
  /** Put the extra unit on its own line, so the original terms stand. */
  | "new-line"
  /** Take it out with no charge — a swap, a spare, a goodwill loan. */
  | "no-charge";

export type OverScanConflict = {
  kind: "over-quantity";
  reservationItemId: string;
  /** What the line says was ordered. */
  ordered: number;
  /** Units already out against it. */
  alreadyOut: number;
  /** Per-unit rate, so the prompt can price each way out. */
  rate: number;
  pricingType: string;
  label: string;
};

/**
 * The question a person answers, and the ways out. Copy lives here so the
 * scanner, the record and any future mobile surface all say the same thing.
 */
export function overScanPrompt(conflict: OverScanConflict) {
  const nth = conflict.alreadyOut + 1;
  return {
    title: `That's unit ${nth} on a line of ${conflict.ordered}`,
    detail: `${conflict.label} was ordered ${conflict.ordered}× and ${conflict.alreadyOut} ${conflict.alreadyOut === 1 ? "is" : "are"} already out. Checking this one out too changes what the client agreed to — say which.`,
    options: [
      {
        resolution: "expand" as const,
        label: `Increase the line to ${nth}`,
        detail: "Reprices the line. The client is charged for the extra unit.",
      },
      {
        resolution: "new-line" as const,
        label: "Put it on its own line",
        detail: "Leaves the original line and its price untouched.",
      },
      {
        resolution: "no-charge" as const,
        label: "Send it out at no charge",
        detail: "A swap, a spare or a goodwill loan. Nothing is billed for it.",
      },
    ],
  };
}
