import Image from "next/image";

/**
 * The frame every signed-out screen shares: the ground colour, a centred panel
 * card, the brand lockup above it.
 *
 * Same vocabulary as the shell — panel surface, 16px card radius, shadow-sm,
 * no borders — so signing in doesn't look like a different product.
 */
export function AuthShell({
  title,
  blurb,
  children,
  footer,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ground p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-[10px]">
          <Image
            src="/brand/vfxnow-mark.png"
            alt=""
            width={32}
            height={32}
            priority
            className="size-8 flex-none"
          />
          <div className="leading-[1.02]">
            <div className="text-[19px] font-extrabold tracking-[-0.01em]">
              VFX<span className="text-brand-wordmark">now</span>
            </div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-ink-faint">
              AMC
            </div>
          </div>
        </div>

        <div className="rounded-card bg-panel p-6 shadow-sm">
          <h1 className="text-card-title text-[18px]">{title}</h1>
          <p className="mt-1 mb-5 text-detail text-ink-muted">{blurb}</p>
          {children}
        </div>

        {footer ? (
          <div className="mt-4 text-center text-detail text-ink-muted">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Sunken well, no border — matching the rail's search field. */
export const FIELD_CLASS =
  "h-10 w-full rounded-well border-0 bg-sunken px-3 text-body text-ink placeholder:text-ink-faint outline-none disabled:opacity-50";

export const LABEL_CLASS = "mb-[6px] block text-detail font-bold";

export const PRIMARY_CLASS =
  "h-10 w-full rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50";

export const SECONDARY_CLASS =
  "flex h-10 w-full items-center justify-center rounded-pill bg-sunken px-4 text-pill text-ink transition-colors hover:bg-row-hover";

/**
 * Inline status line. Sentence-case copy, and an error always says what to do
 * next rather than only what failed.
 */
export function Notice({
  tone,
  children,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 rounded-well px-3 py-2 text-detail ${
        tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-accent-tint text-accent-on-tint"
      }`}
    >
      {children}
    </p>
  );
}
