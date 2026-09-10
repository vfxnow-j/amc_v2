"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import GridLayout, {
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import { Notice } from "@/components/feedback/notice";
import { TileAccentPicker } from "@/components/dashboard/tile-accent-picker";
import type { TileAccent } from "@/lib/dashboard/accents";
import {
  resetDashboardLayout,
  saveDashboardLayout,
} from "@/lib/actions/dashboard";
import {
  TILE_CATEGORIES,
  TILE_GRID,
  tileMeta,
  type TileId,
  type TileMeta,
} from "@/lib/dashboard/catalog";
import {
  appendTile,
  byReadingOrder,
  serializeTiles,
  setTileAccent,
  tilesFingerprint,
  type PlacedTile,
} from "@/lib/dashboard/layout";
import { cn } from "@/lib/utils";

import "react-grid-layout/css/styles.css";
import "./canvas.css";
import "./tile-accent.css";

/**
 * The dashboard, with handles on it.
 *
 * Reached only through `dashboard-editor.tsx`, which loads this module with
 * `next/dynamic` under `?edit=1`. Everything expensive about the feature —
 * `react-grid-layout`, `react-draggable`, `react-resizable` and their
 * stylesheets — lives in this chunk and nowhere near the reading view.
 *
 * **The tiles are not rendered here.** Each one arrives as a finished Server
 * Component node in `items`, rendered by the page against the same registry the
 * read view uses. This file positions boxes; it has never seen a figure. That
 * is what keeps a client component from reaching `lib/prisma`, and it is why
 * per-tile client filtering is impossible by construction.
 *
 * **RGL clones its children**, injecting `ref`, `className` and `style` onto
 * whatever element it is handed, and react-resizable then appends the grip
 * elements to that child's children. A Server Component node cannot survive
 * either operation, so a server node is *never* a direct child of the grid —
 * it goes in as a prop of `TileFrame`, which is ours, is a client component,
 * and forwards the injected props to a real `<div>`. Hand `<GridLayout>` a
 * server node directly and it breaks at runtime, not at build.
 *
 * Save is explicit. There is no autosave, no debounce and no "saving…" that
 * happens while you are still deciding: you leave with the shape you chose or
 * you leave with the one you had. **A tile's colour rides that same save**: it
 * is part of the shape you are composing, so Discard throws it away with
 * everything else and there is no second little write to reason about.
 */

/** Below this the canvas stops pretending — see the note by `narrow` below. */
const DRAG_FLOOR = 1024;

export type CanvasItem = { id: TileId; node: React.ReactNode };

export type DashboardCanvasProps = {
  viewKey: string;
  viewLabel: string;
  /** The shape as saved, and what Discard returns to. */
  initial: PlacedTile[];
  /** One rendered node per placed tile. A tile added since has none. */
  items: CanvasItem[];
  /** The catalog, already filtered to what this user's role may place. */
  available: TileMeta[];
  /** Whether this user has a stored layout of their own to throw away. */
  reshaped: boolean;
};

export default function DashboardCanvas({
  viewKey,
  viewLabel,
  initial,
  items,
  available,
  reshaped,
}: DashboardCanvasProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tiles, setTiles] = useState<PlacedTile[]>(initial);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });

  /**
   * Under 1024px the placement rules do not apply — the read view collapses to
   * one column in reading order — so there is no geometry to drag and dragging
   * would be editing something nobody will ever see. Adding and removing still
   * work, because those are decisions about *what* is on the dashboard rather
   * than where, and they are the same decisions at any width.
   */
  const narrow = width < DRAG_FLOOR;

  const rendered = useMemo(
    () => new Map(items.map((item) => [item.id, item.node])),
    [items],
  );

  const placed = useMemo(() => new Set(tiles.map((tile) => tile.id)), [tiles]);
  const dirty = tilesFingerprint(tiles) !== tilesFingerprint(initial);

  /** Where the reading view is: this URL without the edit flag. */
  const readHref = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("edit");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const layout = useMemo<LayoutItem[]>(
    () =>
      tiles.map((tile) => {
        const meta = tileMeta(tile.id);
        return {
          i: tile.id,
          x: tile.x,
          y: tile.y,
          w: tile.w,
          h: tile.h,
          minW: meta.size.min.w,
          minH: meta.size.min.h,
          maxW: Math.min(meta.size.max.w, TILE_GRID.columns),
          maxH: meta.size.max.h,
        };
      }),
    [tiles],
  );

  /**
   * RGL fires this on mount as well as on every drag, and the mount call is a
   * compaction pass over what we already handed it. The fingerprint guard is
   * what stops that no-op from marking a freshly opened editor dirty — and, in
   * the case where our compaction and theirs ever disagree, it is also the
   * thing that would show it.
   */
  function onLayoutChange(next: Layout) {
    setTiles((current) => {
      // RGL knows about boxes and has never heard of the colour, so the accent
      // is carried across from the tile of the same id rather than read off the
      // layout item — otherwise every drag would strip it.
      const accents = new Map(current.map((tile) => [tile.id, tile.accent]));

      const updated = next
        .map((item) => {
          const id = item.i as TileId;
          const accent = accents.get(id);
          const box = { id, x: item.x, y: item.y, w: item.w, h: item.h };
          return accent ? { ...box, accent } : box;
        })
        .sort(byReadingOrder);

      return tilesFingerprint(current) === tilesFingerprint(updated)
        ? current
        : updated;
    });
  }

  function add(id: TileId) {
    setError("");
    setTiles((current) => appendTile(current, id));
  }

  function remove(id: TileId) {
    setError("");
    setTiles((current) => current.filter((tile) => tile.id !== id));
  }

  function colour(id: TileId, accent: TileAccent | undefined) {
    setError("");
    setTiles((current) => setTileAccent(current, id, accent));
  }

  function save() {
    if (tiles.length === 0) {
      setError("A dashboard needs at least one tile.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await saveDashboardLayout(viewKey, serializeTiles(tiles));
        router.push(readHref);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function reset() {
    setError("");
    startTransition(async () => {
      try {
        await resetDashboardLayout(viewKey);
        router.push(readHref);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not reset.");
      }
    });
  }

  const frames = tiles.map((tile) => (
    <TileFrame
      key={tile.id}
      meta={tileMeta(tile.id)}
      node={rendered.get(tile.id)}
      accent={tile.accent}
      onAccent={(accent) => colour(tile.id, accent)}
      onRemove={() => remove(tile.id)}
    />
  ));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Toolbar
        viewLabel={viewLabel}
        count={tiles.length}
        dirty={dirty}
        busy={busy}
        reshaped={reshaped}
        picking={picking}
        onPick={() => setPicking((open) => !open)}
        onSave={save}
        onReset={reset}
        discardHref={readHref}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {picking ? (
        <TilePicker available={available} placed={placed} onAdd={add} />
      ) : null}

      {narrow ? (
        <Notice tone="ok">
          This window is narrower than {DRAG_FLOOR}px, where the dashboard
          collapses to one column in reading order — so there is nothing to drag
          here. Adding, removing and colouring tiles still save. Widen the
          window to rearrange them.
        </Notice>
      ) : null}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
        {narrow || !mounted ? (
          <div className="flex flex-col gap-3">
            {tiles.map((tile) => (
              <TileFrame
                key={tile.id}
                meta={tileMeta(tile.id)}
                node={rendered.get(tile.id)}
                accent={tile.accent}
                onAccent={(accent) => colour(tile.id, accent)}
                onRemove={() => remove(tile.id)}
                stacked
              />
            ))}
          </div>
        ) : (
          <GridLayout
            width={width}
            layout={layout}
            onLayoutChange={onLayoutChange}
            gridConfig={{
              cols: TILE_GRID.columns,
              rowHeight: TILE_GRID.rowHeight,
              margin: [TILE_GRID.gap, TILE_GRID.gap],
              // No container padding: the read grid has none either, and a
              // canvas inset by a gap would put every tile a few pixels off
              // where it renders once the editor closes.
              containerPadding: [0, 0],
            }}
            // The colour menu is cancelled as well as the buttons inside it: a
            // press landing on the menu's own padding would otherwise drag the
            // tile out from under the swatches.
            dragConfig={{ cancel: "button,.tile-accent-menu" }}
            resizeConfig={{ handles: ["se", "e", "s"] }}
          >
            {frames}
          </GridLayout>
        )}
      </div>
    </div>
  );
}

/* ── Chrome ──────────────────────────────────────────────────────────────── */

const BUTTON =
  "rounded-pill px-3 py-1 text-pill transition-colors disabled:opacity-50";

function Toolbar({
  viewLabel,
  count,
  dirty,
  busy,
  reshaped,
  picking,
  onPick,
  onSave,
  onReset,
  discardHref,
}: {
  viewLabel: string;
  count: number;
  dirty: boolean;
  busy: boolean;
  reshaped: boolean;
  picking: boolean;
  onPick: () => void;
  onSave: () => void;
  onReset: () => void;
  discardHref: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card bg-tile px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <p className="text-micro uppercase text-ink-muted">Customising</p>
        <p className="text-card-title truncate">{viewLabel}</p>
      </div>

      <p className="text-detail text-ink-muted">
        {count} {count === 1 ? "tile" : "tiles"}
        {dirty ? " · unsaved" : reshaped ? " · your layout" : " · as set up"}
      </p>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPick}
          aria-expanded={picking}
          className={cn(BUTTON, "bg-sunken text-ink hover:bg-row-hover")}
        >
          {picking ? "Close the tile list" : "Add a tile"}
        </button>

        {/* Only offered once there is something of your own to throw away —
            "Reset" on a layout that is already the template does nothing, and
            a control that does nothing is a control you learn to distrust. */}
        {reshaped ? (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className={cn(BUTTON, "bg-sunken text-ink-muted hover:bg-row-hover")}
          >
            Reset to the view
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => router.push(discardHref)}
          disabled={busy}
          className={cn(BUTTON, "bg-sunken text-ink hover:bg-row-hover")}
        >
          {dirty ? "Discard" : "Done"}
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={busy || !dirty}
          className={cn(
            BUTTON,
            "bg-accent-solid text-accent-on-solid hover:bg-accent-800",
          )}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/**
 * What can go on, grouped the way the catalog groups it.
 *
 * A tile already placed is shown as placed rather than hidden, so the list is
 * the whole catalogue every time you open it and "where did that one go" has an
 * answer on screen. `readsRange` is stated because it is the one thing about a
 * tile you cannot tell by looking at it: the header's range control moves some
 * of these and not others.
 */
function TilePicker({
  available,
  placed,
  onAdd,
}: {
  available: TileMeta[];
  placed: Set<TileId>;
  onAdd: (id: TileId) => void;
}) {
  const groups = TILE_CATEGORIES.map((category) => ({
    category,
    metas: available.filter((meta) => meta.category === category),
  })).filter((group) => group.metas.length > 0);

  return (
    <section className="rounded-card bg-tile p-[14px] shadow-sm">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ category, metas }) => (
          <div key={category}>
            <h3 className="text-micro uppercase text-ink-muted">{category}</h3>
            <ul className="mt-2 flex flex-col gap-px">
              {metas.map((meta) => {
                const on = placed.has(meta.id);
                return (
                  <li key={meta.id}>
                    <button
                      type="button"
                      disabled={on}
                      onClick={() => onAdd(meta.id)}
                      className={cn(
                        "w-full rounded-row px-2 py-[7px] text-left transition-colors",
                        on ? "opacity-55" : "hover:bg-row-hover",
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-body font-bold">{meta.title}</span>
                        {meta.readsRange ? (
                          <span className="rounded-pill bg-sunken px-2 py-px text-pill text-ink-muted">
                            follows the range
                          </span>
                        ) : null}
                        <span className="ml-auto text-detail text-ink-muted">
                          {on ? "on" : "add"}
                        </span>
                      </span>
                      <span className="block text-detail text-ink-muted">
                        {meta.blurb}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── One tile ────────────────────────────────────────────────────────────── */

type TileFrameProps = React.ComponentProps<"div"> & {
  meta: TileMeta;
  /** The server-rendered tile. Absent for a tile added this session. */
  node?: React.ReactNode;
  accent?: TileAccent;
  onAccent: (accent: TileAccent | undefined) => void;
  onRemove: () => void;
  /** Narrow mode: in flow at content height, rather than absolutely placed. */
  stacked?: boolean;
};

/**
 * The wrapper RGL is allowed to clone.
 *
 * `className`, `style` and `ref` arrive from RGL's `cloneElement` and are
 * forwarded straight to the `<div>`; `children` arrives from react-resizable
 * and is the resize grips, which is why it is rendered last and why nothing
 * else is ever passed as children. The tile itself comes in as `node` — a prop,
 * not a child, so that a Server Component node is never the thing being cloned.
 *
 * `data-accent` goes here rather than on the tile inside, for the same reason
 * the read grid puts it on the cell: the tile is a Server Component nobody may
 * reach into, and the frame is the one element per tile that both views own.
 * `tile-accent.css` styles `.tile-frame` and `.tile-cell` identically, so the
 * colour does not change when the editor opens.
 */
function TileFrame({
  meta,
  node,
  accent,
  onAccent,
  onRemove,
  stacked,
  className,
  style,
  children,
  ...rest
}: TileFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      {...rest}
      // Raised only while its colour menu is open. RGL positions every item
      // absolutely in DOM order, so without this the menu would be painted over
      // by whichever tile happens to come after this one.
      style={menuOpen ? { ...style, zIndex: 3 } : style}
      data-accent={accent}
      className={cn(
        "tile-frame",
        stacked && "relative min-h-[120px]",
        className,
      )}
    >
      <div className="tile-frame-tools">
        <TileAccentPicker
          value={accent}
          tileTitle={meta.title}
          onChange={onAccent}
          onOpenChange={setMenuOpen}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${meta.title}`}
          className="rounded-pill bg-sunken/90 px-2 py-px text-pill text-ink-muted shadow-sm transition-colors hover:bg-row-hover hover:text-ink"
        >
          Remove
        </button>
      </div>

      <div className={cn(stacked ? "relative" : "tile-frame-body")}>
        {node ?? <TileGhost meta={meta} />}
      </div>

      {children}
    </div>
  );
}

/**
 * A tile added during this session, before it has ever been rendered.
 *
 * There is no server node for it: tiles are Server Components, the page renders
 * the ones the *saved* layout named, and this one was not in that list. Fetching
 * it from the client is the thing the whole catalog/registry split exists to
 * prevent. So it says what it is and what will fill it, which is honest, and it
 * takes up exactly the space the real tile will — the point of placing it is to
 * decide where it goes.
 */
function TileGhost({ meta }: { meta: TileMeta }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 rounded-card border border-dashed border-hairline bg-sunken p-[14px] text-center">
      <p className="text-card-title">{meta.title}</p>
      <p className="max-w-xs text-detail text-balance text-ink-muted">
        {meta.blurb}
      </p>
      <p className="mt-1 rounded-pill bg-panel px-2 py-px text-pill text-ink-muted">
        Fills in when you save
      </p>
    </div>
  );
}
