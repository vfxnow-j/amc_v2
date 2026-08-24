"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { navDestinations, type NavMatch } from "@/lib/nav/clusters";
import type { Role } from "@/lib/roles";

/**
 * ⌘K destination search. Mounted only while open, so each launch starts with a
 * clean query and selection without resetting state in an effect.
 *
 * Scope today is the rail's destinations. The handoff also wants orders, units,
 * serials and clients in here; that needs the data layer, so it joins once the
 * screens are wired to real queries.
 */
/**
 * Dashboard and Settings are pinned rows outside the six clusters, so they have
 * no cluster code for the mark tile and no cluster name for the right-hand
 * label. They are shown as "Pinned" rather than being given a fake cluster —
 * the rail treats them as a category of their own, and the palette should read
 * the same way.
 */
const PINNED_CODE = "★";

function groupOf(destination: NavMatch): string {
  return destination.cluster?.label ?? "Pinned";
}

export function CommandPalette({
  role,
  onClose,
}: {
  role: Role;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const destinations = useMemo(() => navDestinations(role), [role]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter((destination) =>
      `${groupOf(destination)} ${destination.page.label}`
        .toLowerCase()
        .includes(needle),
    );
  }, [destinations, query]);

  // The query can shrink the list under the highlight between renders.
  const selected = Math.min(highlighted, Math.max(results.length - 1, 0));

  function go(index: number) {
    const destination = results[index];
    if (!destination) return;
    router.push(destination.page.href);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(selected);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      setHighlighted(
        event.key === "ArrowDown"
          ? (selected + 1) % results.length
          : (selected - 1 + results.length) % results.length,
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search or scan"
        className="w-full max-w-lg overflow-hidden rounded-card bg-panel shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          // The palette exists to be typed into, and it only mounts on an
          // explicit ⌘K / click.
          autoFocus
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          role="combobox"
          aria-expanded
          aria-controls="command-palette-results"
          aria-activedescendant={
            results.length > 0 ? `command-palette-option-${selected}` : undefined
          }
          placeholder="Search or scan"
          className="w-full bg-sunken px-4 py-3 text-body outline-none placeholder:text-ink-faint"
        />

        {results.length === 0 ? (
          <p className="px-4 py-6 text-detail text-ink-muted">
            Nothing matches “{query.trim()}” — try a page name like
            “Reservations”, or clear the box to see everything.
          </p>
        ) : (
          <ul
            id="command-palette-results"
            role="listbox"
            aria-label="Destinations"
            className="max-h-80 overflow-y-auto p-2"
          >
            {results.map((destination, index) => (
              <li key={`${destination.cluster?.id ?? "pinned"}-${destination.page.id}`}>
                <button
                  type="button"
                  id={`command-palette-option-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(index)}
                  className={`flex w-full items-center gap-[9px] rounded-row px-[10px] py-2 text-left transition-colors duration-[160ms] ${
                    index === selected ? "bg-row-hover" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className="flex size-[26px] flex-none items-center justify-center rounded-tile bg-nav-mark-closed text-[10px] font-extrabold text-ink-muted"
                  >
                    {destination.cluster?.code ?? PINNED_CODE}
                  </span>
                  <span className="truncate text-body">
                    {destination.page.label}
                  </span>
                  <span className="ml-auto text-detail text-ink-faint">
                    {groupOf(destination)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-hairline px-4 py-2 text-[11px] text-ink-faint">
          Pages only for now · orders, units, serials and clients join this
          search when the data layer lands
        </p>
      </div>
    </div>
  );
}
