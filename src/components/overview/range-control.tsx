"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { RANGE_LABEL, type Range } from "@/lib/queries/range";

const ORDER: Range[] = ["today", "week", "month"];

/**
 * Segmented pill from the design spec. It drives a real query — the revenue
 * window — through the URL, so the reading is shareable and survives a reload,
 * and the server recomputes rather than the client filtering a cached blob.
 */
export function RangeControl({ range }: { range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(next: Range) {
    const params = new URLSearchParams(searchParams);
    if (next === "month") params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Revenue window"
      aria-busy={pending}
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {ORDER.map((option) => {
        const selected = option === range;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(option)}
            className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              selected
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {RANGE_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
