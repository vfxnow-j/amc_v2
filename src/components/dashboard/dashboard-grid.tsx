import type { CSSProperties } from "react";
import type { PlacedTile } from "@/lib/dashboard/layout";
import { byReadingOrder } from "@/lib/dashboard/layout";
import "./dashboard-grid.css";
import "./tile-accent.css";

/**
 * The dashboard as everybody but the person editing it sees it.
 *
 * A Server Component that emits a `<div>` of `<div>`s and stops. There is no
 * client component anywhere in this subtree, no measurement, no effect — the
 * grid arrives drawn. `react-grid-layout` is a real dependency of this feature
 * and it is not on this path at all: it is behind `?edit=1`, in a chunk the
 * reading view never asks for.
 *
 * Tiles are emitted in reading order — `(y, x)` — and that ordering is load
 * bearing rather than tidy. Below 1024px the stylesheet abandons the grid and
 * the cells stack in DOM order, so document order *is* the phone layout. A
 * saved layout therefore needs no mobile counterpart, and there is no second
 * arrangement to keep honest.
 *
 * Grid lines are 1-indexed and stored coordinates are 0-indexed, which is the
 * one conversion in this file and the reason it is spelled out here rather than
 * in the CSS: `--tile-x` is `x + 1`.
 *
 * A tile's colour is one attribute on the same cell — `data-accent`, absent
 * when the tile has none, which is how a plain tile stays byte-identical to
 * what this emitted before. Everything it means is in `tile-accent.css` and in
 * `globals.css`; nothing about it costs this view a line of JavaScript, which
 * was the condition for having it at all.
 */

export type DashboardGridItem = {
  tile: PlacedTile;
  /** The rendered tile, already inside its own Suspense boundary. */
  node: React.ReactNode;
};

type CellStyle = CSSProperties & Record<`--tile-${string}`, string>;

export function DashboardGrid({ items }: { items: DashboardGridItem[] }) {
  const ordered = [...items].sort((a, b) => byReadingOrder(a.tile, b.tile));

  return (
    <div className="tile-grid">
      {ordered.map(({ tile, node }) => {
        const style: CellStyle = {
          "--tile-x": String(tile.x + 1),
          "--tile-y": String(tile.y + 1),
          "--tile-w": String(tile.w),
          "--tile-h": String(tile.h),
        };

        return (
          <div
            key={tile.id}
            className="tile-cell"
            data-accent={tile.accent}
            style={style}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the grid says when a view has no tiles on it.
 *
 * Reachable: an administrator can empty a view under Settings → Dashboards, and
 * a view made entirely of admin-only tiles is empty for everybody else. Both
 * are somebody else's decision, so this says what happened and where the way
 * out is rather than apologising.
 */
export function DashboardGridEmpty({ canEdit }: { canEdit: boolean }) {
  return (
    <section className="flex flex-1 items-center justify-center rounded-card bg-tile p-[14px] shadow-sm">
      <p className="max-w-md text-center text-body text-balance text-ink-muted">
        This view has no tiles on it that your access can see.{" "}
        {canEdit
          ? "Choose another view above, or add tiles with Customise."
          : "Choose another view above, or ask an administrator what belongs on it."}
      </p>
    </section>
  );
}
