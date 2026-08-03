"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/**
 * The list search every rail screen puts in its header card. Debounced into the
 * URL as `q` so the server does the filtering — these lists run to thousands of
 * rows and the client is never handed the whole set to sift.
 *
 * Written for the Reservations hub and generalised when the rest of the rail
 * landed; it was already path-agnostic, so only the placeholder differs per
 * screen. Which columns `q` actually matches is each screen's query decision.
 */
export function ListSearch({
  placeholder = "Search orders, projects, clients",
}: {
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const committed = searchParams.get("q") ?? "";
  const [value, setValue] = useState(committed);
  // Skips the first run, so mounting doesn't push the URL it just read.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set("q", value);
      else params.delete("q");
      // A narrower result set invalidates the page number.
      params.delete("page");
      const query = params.toString();
      startTransition(() =>
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        }),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [pathname, router, searchParams, value]);

  return (
    <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
      <Search className="size-[14px] flex-none text-ink-faint" aria-hidden />
      <input
        type="search"
        value={value}
        aria-busy={pending}
        onChange={(event) => {
          typed.current = true;
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        className="w-52 border-0 bg-transparent text-detail text-ink outline-none placeholder:text-ink-faint"
      />
    </label>
  );
}
