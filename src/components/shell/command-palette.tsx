"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { navDestinations, type NavMatch } from "@/lib/nav/clusters";
import { searchRecords, type SearchHit } from "@/lib/actions/search";
import type { Role } from "@/lib/roles";

/**
 * ⌘K destination search. Mounted only while open, so each launch starts with a
 * clean query and selection without resetting state in an effect.
 *
 * Two kinds of result in one list: the rail's destinations, matched in the
 * browser because they are already here, and records — units, orders, clients,
 * models, invoices — fetched as you type.
 *
 * Records took a while to arrive and their absence was worse than it looked.
 * The placeholder has always said "Search or scan", so the box invited a
 * barcode gun and then reported no match, which is not a missing feature so
 * much as a lie. A scan now lands on the unit: an exact barcode or serial sorts
 * above everything, and a digits-only query skips the client and model searches
 * entirely, because nobody scanning a box is looking for a company name.
 *
 * Destinations stay above records when both match. Typing "orders" should go to
 * the Orders screen, not to an order that happens to be called that.
 */
/**
 * Dashboard and Settings are pinned rows outside the six clusters, so they have
 * no cluster code for the mark tile and no cluster name for the right-hand
 * label. They are shown as "Pinned" rather than being given a fake cluster —
 * the rail treats them as a category of their own, and the palette should read
 * the same way.
 */
const PINNED_CODE = "★";

/** A one-glyph tile per record kind, matching how the rail marks a cluster. */
const KIND_MARK: Record<SearchHit["kind"], string> = {
  unit: "▮",
  order: "OR",
  client: "CL",
  model: "MO",
  invoice: "IN",
};

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  unit: "Unit",
  order: "Order",
  client: "Client",
  model: "Model",
  invoice: "Invoice",
};

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

  // Results are stored with the query they answer, so "are these still the
  // right hits" is a comparison rather than a second piece of state that has to
  // be cleared in step with the first.
  const [found, setFound] = useState<{ query: string; hits: SearchHit[] }>({
    query: "",
    hits: [],
  });

  const destinations = useMemo(() => navDestinations(role), [role]);
  const pages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter((destination) =>
      `${groupOf(destination)} ${destination.page.label}`
        .toLowerCase()
        .includes(needle),
    );
  }, [destinations, query]);

  /**
   * Records, fetched as you type.
   *
   * Debounced, and every response checked against the query that is current
   * when it lands — a barcode gun types a whole code and presses Enter in a few
   * milliseconds, so responses genuinely do arrive out of order, and the fix is
   * to drop the stale one rather than to slow the box down.
   */
  const needle = query.trim();
  const searchable = needle.length >= 2;
  const hits = useMemo(
    () => (searchable && found.query === needle ? found.hits : []),
    [searchable, found, needle],
  );
  const searching = searchable && found.query !== needle;

  const latest = useRef(0);
  useEffect(() => {
    if (!searchable) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const hits = await searchRecords(needle);
      if (ticket !== latest.current) return;
      setFound({ query: needle, hits });
    }, 140);
    return () => clearTimeout(timer);
  }, [needle, searchable]);

  /** One flat list, because one set of arrow keys walks it. */
  const results = useMemo(
    () => [
      ...pages.map((destination) => ({
        key: `page-${destination.cluster?.id ?? "pinned"}-${destination.page.id}`,
        href: destination.page.href,
        mark: destination.cluster?.code ?? PINNED_CODE,
        label: destination.page.label,
        detail: null as string | null,
        group: groupOf(destination),
      })),
      ...hits.map((hit) => ({
        key: hit.key,
        href: hit.href,
        mark: KIND_MARK[hit.kind],
        label: hit.label,
        detail: hit.detail || null,
        group: KIND_LABEL[hit.kind],
      })),
    ],
    [pages, hits],
  );

  // The query can shrink the list under the highlight between renders.
  const selected = Math.min(highlighted, Math.max(results.length - 1, 0));

  function go(index: number) {
    const row = results[index];
    if (!row) return;
    router.push(row.href);
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
            {searching
              ? "Searching…"
              : !searchable
                ? "Type at least two characters, or scan a barcode."
                : `Nothing matches “${needle}” — no page, unit, order, client, model or invoice. A barcode finds its unit whatever state it is in.`}
          </p>
        ) : (
          <ul
            id="command-palette-results"
            role="listbox"
            aria-label="Search results"
            className="max-h-80 overflow-y-auto p-2"
          >
            {results.map((row, index) => (
              <li key={row.key}>
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
                    {row.mark}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{row.label}</span>
                    {row.detail ? (
                      <span className="block truncate text-detail text-ink-faint">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-auto flex-none text-detail text-ink-faint">
                    {row.group}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-hairline px-4 py-2 text-[11px] text-ink-faint">
          Pages, units, orders, clients, models and invoices · scan a barcode to
          jump to its unit
        </p>
      </div>
    </div>
  );
}
