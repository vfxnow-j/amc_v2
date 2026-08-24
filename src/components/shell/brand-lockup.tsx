import Image from "next/image";

const BLACK = "/brand/VFXnow-Logo-Allblack-Vector.png";
const WHITE = "/brand/VFXnow-Logo-AllWhite-Vector.png";

/** Intrinsic size of both files — identical artwork, 1.495:1, tightly cropped. */
const INTRINSIC = { width: 4009, height: 2681 };

const WIDTH = {
  /** The rail header, inside a 236px column. */
  rail: "w-[124px]",
  /** Signed-out screens, where the lockup is the only thing on the page. */
  auth: "w-[168px]",
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
  size?: keyof typeof WIDTH;
}) {
  const shared = `${WIDTH[size]} h-auto flex-none`;

  return (
    <div
      className={
        size === "rail"
          ? "flex flex-col gap-[3px] px-2 pt-[2px] pb-[14px]"
          : "mb-6 flex flex-col items-center gap-1"
      }
    >
      {/* Visible text below says "AMC"; the wrapper supplies the rest. */}
      <span className="sr-only">VFXnow</span>
      <Image
        src={BLACK}
        alt=""
        aria-hidden
        loading="eager"
        {...INTRINSIC}
        sizes="168px"
        className={`${shared} block dark:hidden`}
      />
      <Image
        src={WHITE}
        alt=""
        aria-hidden
        loading="eager"
        {...INTRINSIC}
        sizes="168px"
        className={`${shared} hidden dark:block`}
      />
      <span className="text-[9px] font-bold tracking-[0.2em] text-ink-faint">
        AMC
      </span>
    </div>
  );
}
