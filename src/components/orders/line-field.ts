/**
 * How an editable field on an order line looks.
 *
 * A shaded well at rest, so a number you can change reads as a field and not as
 * text that happens to sit in the row; a slightly darker well on hover and a
 * ring on focus. They used to be transparent until hovered, which on a dense
 * line of figures made quantity, rate and name indistinguishable from the
 * read-only text around them. Colour is left to each caller: some fields are
 * deliberately quieter (a part under a build).
 */
const BASE =
  "rounded-well border-0 bg-sunken px-2 py-1 outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** A figure: quantity, rate, cost, margin. */
export const LINE_NUMBER = `${BASE} text-right tabular-nums`;

/** A name or a description. */
export const LINE_TEXT = BASE;

/** A drop-down beside a figure (the rate basis, the build a part is in). */
export const LINE_SELECT = `${BASE} text-micro`;
