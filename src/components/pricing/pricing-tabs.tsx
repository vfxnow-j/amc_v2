import Link from "next/link";

/**
 * The strip across the top of Operate → Pricing.
 *
 * Routes rather than a search param, unlike `FilterTabs` everywhere else. The
 * four surfaces here are not four views of one result set — they are four
 * different screens with their own layouts and their own params. The catalogue
 * pages and searches, Cloud carries a form beside its table and drives it with
 * `?edit=`, and Services will do the same. One page juggling `tab`, `view`,
 * `edit`, `q` and `page` would have every tab's state leak into the next.
 *
 * So each is its own route and this is a nav strip, not a filter. It renders as
 * a Server Component with plain links: no client bundle, works with JS off, and
 * the browser's back button does the obvious thing.
 */

const TABS = [
  { id: "catalogue", label: "Catalogue", href: "/dashboard/pricing" },
  { id: "cards", label: "Rate cards", href: "/dashboard/pricing/cards" },
  { id: "cloud", label: "Cloud", href: "/dashboard/pricing/cloud" },
  { id: "services", label: "Services", href: "/dashboard/pricing/services" },
] as const;

export type PricingTab = (typeof TABS)[number]["id"];

export function PricingTabs({ current }: { current: PricingTab }) {
  return (
    <nav
      aria-label="Pricing surfaces"
      className="flex flex-wrap items-center gap-1 rounded-pill bg-segmented-track p-1"
    >
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-pill px-3 py-1 text-pill transition-colors duration-[160ms] ${
              active
                ? "bg-segmented-thumb font-bold text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
