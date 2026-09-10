/**
 * Which way a thing is moving: out to a client, or back to us.
 *
 * One component rather than a glyph typed at each call site, because the pair
 * only works as a pair. The calendar grid, the calendar strip tile and the
 * logistics tile all showed direction and all three had drifted to `↗` and `↘`
 * — and those are not opposites. Both point right; they differ only in whether
 * they rise or fall, which at 11px reads as two shades of the same thing. `↙`
 * is the true reverse of `↗`, so out and back finally mirror each other and the
 * distinction survives being small.
 *
 * **Sized in `em`, not pixels.** These sit in three different type scales —
 * `text-micro` in a calendar cell, `text-detail` in a tile row — and an arrow
 * pinned to one size is either lost in the larger context or overbearing in the
 * smaller. At 1.35em it is reliably bigger than whatever label it precedes,
 * everywhere, without knowing where it is.
 *
 * The glyph is `aria-hidden` and carries a real word for screen readers, unless
 * the caller already prints one — the logistics tile writes "out" and "back"
 * beside it, and hearing "out out" is worse than hearing nothing.
 */

export type MoveDirection = "out" | "back";

export function MoveArrow({
  direction,
  labelled = true,
}: {
  direction: MoveDirection;
  /** False when visible text beside this already names the direction. */
  labelled?: boolean;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        // `leading-none` and the baseline nudge keep a 1.35em glyph from
        // stretching the line box of the row it sits in.
        className="inline-block shrink-0 translate-y-[0.06em] text-[1.35em] font-semibold leading-none"
      >
        {direction === "out" ? "↗" : "↙"}
      </span>
      {labelled ? (
        <span className="sr-only">{direction === "out" ? "Out" : "Back"}</span>
      ) : null}
    </>
  );
}
