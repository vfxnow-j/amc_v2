"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { formatCount } from "@/lib/nav/counts";

/**
 * The segmented sub-view control, generalised from
 * `components/reservations/view-tabs.tsx`.
 *
 * Links rather than client state, so the server re-queries and the reading is
 * shareable — the same reasoning as the Overview's range control. Selecting a
 * tab drops `page`, because a new tab is a new result set and the old page
 * number would land on nothing.
 *
 * Takes plain data, never a Prisma type: this is a client component, and an
 * import that reaches `lib/prisma` drags the pg driver into the browser and
 * fails the build on `dns`.
 */

export type TabOption = {
  value: string;
  label: string;
  /** Omit when a count would be misleading or unprovable — the tab shows bare. */
  count?: number;
};

export function FilterTabs({
  param,
  value,
  options,
  fallback,
  label,
}: {
  /** Search-param name this strip writes, e.g. `"view"`. */
  param: string;
  value: string;
  options: TabOption[];
  /** The value that means "no param in the URL". */
  fallback: string;
  label: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === fallback) params.delete(param);
    else params.set(param, next);
    params.delete("page");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Link
            key={option.value}
            href={href(option.value)}
            role="tab"
            aria-selected={selected}
            className={`flex items-center gap-[6px] rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              selected
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className={selected ? "text-ink-muted" : "opacity-70"}>
                {formatCount(option.count)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Matches the strip's real height so the header doesn't reflow. */
export function FilterTabsSkeleton({ width = 360 }: { width?: number }) {
  return (
    <div
      className="h-[30px] animate-pulse rounded-pill bg-segmented-track"
      style={{ width }}
    />
  );
}
