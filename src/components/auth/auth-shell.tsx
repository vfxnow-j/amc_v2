import { BrandLockup } from "@/components/shell/brand-lockup";

/**
 * The frame every signed-out screen shares: the ground color, a centerd panel
 * card, the brand lockup above it.
 *
 * Same vocabulary as the shell — panel surface, 16px card radius, shadow-sm,
 * no borders, the same lockup component — so signing in doesn't look like a
 * different product.
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
        {/* One lockup component, not a second hand-typeset copy of it. This
            screen and the rail had drifted to two sizes of the same markup. */}
        <BrandLockup size="auth" />

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
 * `Notice` used to live here, scoped to the auth screens. It is now
 * `components/feedback/notice` — the rest of the app had hand-rolled the same
 * strip twenty-five times without ever finding this one, which is the argument
 * for it not being in a cluster folder. The auth screens pass `mb-4`, which
 * this version hard-coded.
 */
