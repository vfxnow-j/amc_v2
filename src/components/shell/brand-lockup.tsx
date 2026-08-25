import Image from "next/image";

const BLACK = "/brand/VFXnow-Logo-Allblack-Vector.png";
const WHITE = "/brand/VFXnow-Logo-AllWhite-Vector.png";

/** Intrinsic size of both files — identical artwork, 1.495:1, tightly cropped. */
const INTRINSIC = { width: 4009, height: 2681 };

/**
 * Deliberately small. The mark is an identifier, not the point of the screen —
 * the rail's job is the six clusters below it, and the first pass at this took
 * 113px of vertical before the first nav row: a 124px-wide lockup with a label
 * stacked under it. This is 54px tall including the label, and the artwork is
 * still legible at that size — the "VFX" inside the ring was the limit, and it
 * holds down to about 68px wide.
 */
const SIZE = {
  /** The rail header, inside a 236px column. 80 x 54. */
  rail: { logo: "w-[80px]", rule: "h-[16px]", label: "text-[8px]" },
  /** Signed-out screens, where the lockup is the only thing on the page. */
  auth: { logo: "w-[108px]", rule: "h-[20px]", label: "text-[9px]" },
} as const;

/**
 * The supplied VFXnow lockup, in whichever of the two supplied colourways the
 * surface can carry.
 *
 * The client's brand folder holds an all-black and an all-white version of the
 * same artwork. Both are used: black on the light surfaces, white on the dark
 * ones, so the mark is never the same value as the ground it sits on. This is
 * what the v2 shell had been typesetting by hand — the earlier lockup existed
 * because the only supplied logo had a white "now" and worked on dark grounds
 * only, which is no longer true.
 *
 * **Both images are rendered and CSS hides one**, rather than picking in JS.
 * `dark:` keys off `data-mode`, which ThemeScript resolves before first paint,
 * so the right colourway is on screen from the first frame with no flash and no
 * hydration mismatch. The hidden one is `display:none`, so it is out of the
 * accessibility tree too — the accessible name comes from the wrapper instead
 * of being announced twice.
 *
 * Intrinsic dimensions are passed and the display size set in CSS, so the exact
 * 1.495 ratio is preserved rather than being rounded into a slightly squashed
 * box, and next/image still gets what it needs to serve a sized variant of a
 * 4009px source. Optimised, each is about 5KB.
 *
 * Sizes live in one place above. Both callers scale together, so the rail and
 * the sign-in screen cannot drift into two different marks again.
 *
 * The cost, stated rather than hidden: both colourways are fetched and both are
 * preloaded, so about 10KB is spent to have 5KB on screen. A `display:none`
 * <img> is still downloaded, and in this version of next/image `loading="eager"`
 * emits a `<link rel="preload">` just as `priority` does — the only way to get
 * one preload instead of two is to go lazy, which pops the mark in after first
 * paint on the one element that should never do that. 10KB is the right price
 * for a mark that is the correct colour in the first frame.
 *
 * The consequence worth naming: this artwork is monochrome, so the accent no
 * longer appears in the wordmark. "now" was tinted with `--brand-wordmark`,
 * which is why that token is gone — the brand is the client's file now, not
 * something the theme recolours.
 */
export function BrandLockup({
  size = "rail",
}: {
  size?: keyof typeof SIZE;
}) {
  const scale = SIZE[size];
  const shared = `${scale.logo} h-auto flex-none`;

  return (
    <div
      className={
        size === "rail"
          ? "flex items-center gap-[7px] px-2 pt-[2px] pb-[12px]"
          : "mb-6 flex items-center justify-center gap-[9px]"
      }
    >
      {/* The visible "AMC" is only half the name; the wrapper supplies the rest. */}
      <span className="sr-only">VFXnow</span>
      <Image
        src={BLACK}
        alt=""
        aria-hidden
        loading="eager"
        {...INTRINSIC}
        sizes="108px"
        className={`${shared} block dark:hidden`}
      />
      <Image
        src={WHITE}
        alt=""
        aria-hidden
        loading="eager"
        {...INTRINSIC}
        sizes="108px"
        className={`${shared} hidden dark:block`}
      />
      {/* Beside the mark on a rule, not stacked under it. The supplied artwork
          is a full lockup ending in a wordmark, so a label underneath read as a
          third line of branding; alongside, it reads as what it is — which
          product of theirs this is. */}
      <span aria-hidden className={`${scale.rule} w-px flex-none bg-hairline`} />
      <span
        className={`${scale.label} font-bold tracking-[0.18em] text-ink-faint`}
      >
        AMC
      </span>
    </div>
  );
}
