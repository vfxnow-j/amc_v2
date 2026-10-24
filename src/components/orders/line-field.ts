/**
 * How an editable field on an order line looks.
 *
 * A thin outline at rest, so a number you can change reads as a field and not
 * as text that happens to sit in the row, without filling every cell with a
 * grey well (the first version did, and a dense line looked heavy). A faint tint
 * on hover and a ring on focus. Colour is left to each caller: some fields are
 * deliberately quieter (a part under a build).
 */
const BASE =
  "rounded-well border-0 bg-transparent px-1.5 py-0.5 outline-none ring-1 ring-inset ring-hairline hover:bg-row-alt focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** A figure: quantity, rate, cost, margin. */
export const LINE_NUMBER = `${BASE} text-right tabular-nums`;

/** A name or a description. */
export const LINE_TEXT = BASE;

/** A drop-down beside a figure (the rate basis, the build a part is in). */
export const LINE_SELECT = `${BASE} text-micro`;
