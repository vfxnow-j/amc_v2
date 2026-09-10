import Link from "next/link";

/**
 * The four things people come to the dashboard to start.
 *
 * Under the header rather than in it. `PageHeader`'s actions slot already
 * carries the range control, and a row of four buttons crammed beside it wraps
 * badly and reads as chrome; on its own line these are the first thing on the
 * screen, which is what they are.
 *
 * Scan lives here rather than in the rail, on the owner's call. It is a thing
 * you go and do, not a place in the information architecture — and the rail is
 * organised by where records live.
 *
 * Two are still to come. Quick Quote (a priced scope against a client or a
 * prospect) and Onboard (an email address, and the onboarding link sent to it)
 * are Track D; when they land they replace the two placeholders below with
 * `<QuickQuoteButton />` and `<OnboardButton />` — client components, since
 * both open a dialog. Nothing else here changes. They are rendered as disabled
 * rather than omitted deliberately: the shape of the bar is the design, and
 * shipping it three-quarters empty and then rearranging it later is worse than
 * showing what is coming.
 */

const PRIMARY =
  "rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800";
const SECONDARY =
  "rounded-pill bg-panel px-4 py-2 text-pill text-ink shadow-sm transition-colors hover:bg-row-hover";
const PENDING =
  "cursor-not-allowed rounded-pill bg-panel px-4 py-2 text-pill text-ink-faint shadow-sm";

export function ActionBar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/dashboard/orders/new" className={PRIMARY}>
        New order
      </Link>

      <button type="button" disabled className={PENDING} title="Coming soon">
        Quick quote
      </button>

      <button type="button" disabled className={PENDING} title="Coming soon">
        Onboard
      </button>

      <Link href="/dashboard/scan" className={SECONDARY}>
        Scan
      </Link>
    </div>
  );
}
