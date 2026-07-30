"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { formatCount } from "@/lib/nav/counts";
import { VIEW_LABEL, VIEWS, type View } from "@/lib/reservations/views";

/**
 * The hub's sub-views. Links rather than client state, so the server re-queries
 * and the reading is shareable — the same reasoning as the Overview's range
 * control.
 */
export function ViewTabs({
  view,
  counts,
}: {
  view: View;
  counts: Record<View, number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(next: View) {
    const params = new URLSearchParams(searchParams);
    if (next === "open") params.delete("view");
    else params.set("view", next);
    // A new tab is a new result set; keeping the old page number would land on
    // an empty page.
    params.delete("page");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div
      role="tablist"
      aria-label="Reservation views"
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {VIEWS.map((option) => {
        const selected = option === view;
        return (
          <Link
            key={option}
            href={href(option)}
            role="tab"
            aria-selected={selected}
            className={`flex items-center gap-[6px] rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              selected
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {VIEW_LABEL[option]}
            <span className={selected ? "text-ink-muted" : "opacity-70"}>
              {formatCount(counts[option])}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
