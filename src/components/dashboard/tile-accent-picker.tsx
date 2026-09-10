"use client";

import { useRef, useState } from "react";
import {
  ACCENT_LABEL,
  TILE_ACCENTS,
  type TileAccent,
} from "@/lib/dashboard/accents";
import { cn } from "@/lib/utils";

/**
 * Twelve colours and None, for one tile.
 *
 * Used from both places a tile can be coloured — the edit canvas, where you are
 * arranging your own dashboard, and Settings → Dashboards, where an
 * administrator is composing everyone's. One component, because the choice is
 * the same choice and a second copy of it is how the two drift apart.
 *
 * **Imports `lib/dashboard/accents` and nothing else from the feature.** That
 * module is pure by design; `store.ts` and `registry.tsx` are server-only and a
 * client component that reached either would pull the pg driver into the
 * browser bundle and fail on `dns`. There is no route from here to a query.
 *
 * The swatches are the real thing rather than a hardcoded list of hexes: each
 * one carries `data-accent`, so it is painted by the same `globals.css` rule
 * that will paint the tile, in whatever theme and mode the person is in. A
 * swatch cannot be wrong about the colour it is offering.
 *
 * It writes nothing. `onChange` hands the value to whoever owns the draft, and
 * the accent is saved by the Save that was already there — the canvas's, or the
 * settings form's. A colour is part of the layout you are composing, not a
 * separate little write that happens behind your back.
 */

export function TileAccentPicker({
  value,
  tileTitle,
  onChange,
  onOpenChange,
  align = "right",
  className,
}: {
  value: TileAccent | undefined;
  /** Named in every label, because a page of these is otherwise twelve of the same. */
  tileTitle: string;
  onChange: (accent: TileAccent | undefined) => void;
  /** The canvas raises the tile it is opened on, so it is not covered. */
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  function toggle(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  function choose(accent: TileAccent | undefined) {
    onChange(accent);
    toggle(false);
  }

  return (
    <div
      ref={wrap}
      // The class is a hook as much as a name: `react-grid-layout` is told to
      // cancel drags that start inside it, or picking a colour would drag the
      // tile out from under the menu.
      className={cn("tile-accent-menu relative", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          toggle(false);
        }
      }}
      onBlur={(event) => {
        // Closes when focus leaves the whole control rather than any one
        // button, so tabbing along the swatches keeps it open.
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) {
          toggle(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => toggle(!open)}
        aria-expanded={open}
        aria-label={`Colour of ${tileTitle}: ${
          value ? ACCENT_LABEL[value] : "none"
        }`}
        title={`Colour · ${value ? ACCENT_LABEL[value] : "none"}`}
        className="flex items-center gap-1 rounded-pill bg-sunken/90 px-2 py-px text-pill text-ink-muted shadow-sm transition-colors hover:bg-row-hover hover:text-ink"
      >
        <Swatch accent={value} />
        <span>Colour</span>
      </button>

      {open ? (
        <div
          className={cn(
            "absolute top-full z-10 mt-1 w-[164px] rounded-card bg-panel p-2 shadow-sm ring-1 ring-hairline",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="grid grid-cols-6 gap-1">
            {TILE_ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                onClick={() => choose(accent)}
                aria-label={ACCENT_LABEL[accent]}
                aria-pressed={value === accent}
                title={ACCENT_LABEL[accent]}
                className={cn(
                  "flex h-6 items-center justify-center rounded-row transition-colors hover:bg-row-hover",
                  value === accent && "bg-row-hover",
                )}
              >
                <Swatch accent={accent} selected={value === accent} />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => choose(undefined)}
            aria-pressed={value === undefined}
            className={cn(
              "mt-1 w-full rounded-row px-2 py-1 text-left text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink",
              value === undefined && "bg-row-hover text-ink",
            )}
          >
            None
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The colour itself, or the absence of one.
 *
 * No accent is drawn as an outlined circle rather than as a grey one, because
 * grey is `slate` and slate is a choice somebody may have made on purpose.
 */
export function Swatch({
  accent,
  selected,
}: {
  accent: TileAccent | undefined;
  selected?: boolean;
}) {
  if (!accent) {
    return (
      <span
        aria-hidden
        className="inline-block size-3 rounded-full border border-dashed border-ink-faint"
      />
    );
  }

  return (
    <span
      aria-hidden
      data-accent={accent}
      className={cn(
        "inline-block size-3 rounded-full bg-tile-accent-solid",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-panel",
      )}
    />
  );
}
