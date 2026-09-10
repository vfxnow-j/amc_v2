import Link from "next/link";
import { QuickQuoteButton } from "@/components/quotes/quick-quote-button";
import { OnboardButton } from "@/components/leads/onboard-button";

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
 * Quick quote and Onboard were placeholders here until Track D landed. Both are
 * Client Components, because both open a dialog, and both take their own look
 * from this file rather than knowing about it: the bar decides how its buttons
 * look, and the same components render elsewhere at other sizes.
 *
 * Onboard is labelled with the short verb here and reads "Request onboarding"
 * on a lead record, where there is room and the longer phrase is the clearer
 * one. Deliberately not the same string in both places.
 */

const PRIMARY =
  "rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800";
const SECONDARY =
  "rounded-pill bg-panel px-4 py-2 text-pill text-ink shadow-sm transition-colors hover:bg-row-hover";

export function ActionBar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/dashboard/orders/new" className={PRIMARY}>
        New order
      </Link>

      <QuickQuoteButton className={SECONDARY} />

      <OnboardButton label="Onboard" className={SECONDARY} />

      <Link href="/dashboard/scan" className={SECONDARY}>
        Scan
      </Link>
    </div>
  );
}
