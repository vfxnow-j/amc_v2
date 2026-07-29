import Image from "next/image";

/**
 * Ring mark plus a typeset wordmark: "VFX" in ink, "now" in accent, "AMC"
 * beneath in a tracked micro-label.
 *
 * The supplied full logo has a white "now" and only works on dark grounds, so
 * the lockup is typeset here instead — per design/README.md, which also asks the
 * client for an SVG mark before shipping (this PNG is a raster crop and will
 * soften on hi-dpi).
 */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-[9px] px-2 pt-[2px] pb-[14px]">
      <Image
        src="/brand/vfxnow-mark.png"
        alt=""
        width={24}
        height={24}
        priority
        className="size-6 flex-none"
      />
      <div className="leading-[1.02]">
        <div className="text-[15px] font-extrabold tracking-[-0.01em]">
          VFX<span className="text-brand-wordmark">now</span>
        </div>
        <div className="text-[9px] font-bold tracking-[0.2em] text-ink-faint">
          AMC
        </div>
      </div>
    </div>
  );
}
