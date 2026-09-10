"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { selectDashboardView } from "@/lib/actions/dashboard";

/**
 * Which dashboard you are looking at, and the way into rearranging it.
 *
 * Two controls rather than one because they answer different questions — what
 * am I looking at, and I want it to look different — but they live in one file
 * because they are one strip in the page header and share the parameter
 * juggling below.
 *
 * **Choosing a view is also setting your default.** There is no separate "make
 * this my home view" checkbox: the view you picked is the view you want next
 * time, and asking a second question about it is a question nobody wants asked.
 * `selectDashboardView` writes `User.dashboardView` and the URL carries the
 * choice for this navigation, so the link is still shareable and the answer
 * still survives a different browser.
 *
 * The failure is deliberately silent. The navigation is what the person asked
 * for and it has already happened; an error strip in the page header saying the
 * *preference* did not stick would be interrupting somebody about a detail they
 * will correct by clicking the same thing tomorrow.
 */
export function DashboardViewPicker({
  views,
  current,
}: {
  views: { key: string; label: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // One view is not a choice, and a select with one option is furniture.
  if (views.length < 2) return null;

  function select(key: string) {
    const params = new URLSearchParams(searchParams);
    params.set("view", key);
    startTransition(async () => {
      router.push(`${pathname}?${params.toString()}`);
      try {
        await selectDashboardView(key);
      } catch {
        // See the note above: the navigation stands either way.
      }
    });
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Dashboard view</span>
      <select
        value={current}
        aria-busy={pending}
        onChange={(event) => select(event.target.value)}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink transition-colors hover:bg-row-hover"
      >
        {views.map((view) => (
          <option key={view.key} value={view.key}>
            {view.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Into edit mode, carrying the rest of the URL with it.
 *
 * A button rather than a `<Link href="?edit=1">`, because a bare query-string
 * href would drop `range` and `view` and drop somebody into a different
 * dashboard than the one they were looking at when they asked to change it.
 */
export function CustomiseButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function open() {
    const params = new URLSearchParams(searchParams);
    params.set("edit", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={open}
      className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
    >
      Customise
    </button>
  );
}
