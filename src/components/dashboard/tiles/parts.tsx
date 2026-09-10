import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The small pieces the tiles in this directory share.
 *
 * `Tile`, `TileHeader` and `Kpi` live in `components/dashboard/tile.tsx` and
 * are the shape of a tile. These are the shapes *inside* one — a labelled
 * figure, a qualifying footnote, an empty state. They were about to be written
 * a fourth time, which is the point at which a near-copy starts to drift: the
 * maintenance card and the billing book already carry two versions of the same
 * "stat in a well" with different padding and different type.
 *
 * Nothing here reads the database, but this is still a server-side file by
 * association — it is only ever imported by tile components, which are Server
 * Components. It carries no `"use client"` and needs none.
 */

/**
 * One figure in a well, with the line that says what it is made of.
 *
 * `tone` is not decoration. A figure is `alert` when it is a number somebody
 * has to do something about — an untracked shipment, an overdue invoice — and
 * `plain` otherwise. Two tones, so "this needs a person" means one thing
 * across every tile.
 */
export function Figure({
  label,
  value,
  detail,
  tone = "plain",
  href,
}: {
  label: string;
  value: React.ReactNode;
  /** What the figure is made of. Counts are always qualified. */
  detail?: React.ReactNode;
  tone?: "plain" | "alert";
  href?: string;
}) {
  const alert = tone === "alert";

  const body = (
    <>
      <span
        className={cn(
          "text-micro uppercase",
          alert ? "text-accent-on-tint" : "text-ink-muted",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "mt-1 text-[20px] font-bold tabular-nums tracking-[-0.02em]",
          alert && "text-accent-text",
        )}
      >
        {value}
      </span>
      {detail ? (
        <span
          className={cn(
            "mt-[2px] text-detail",
            alert ? "text-accent-on-tint" : "text-ink-muted",
          )}
        >
          {detail}
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "flex min-w-0 flex-col rounded-well px-3 py-2",
    alert ? "bg-accent-tint" : "bg-sunken",
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(className, "transition-colors hover:bg-row-hover")}
      >
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

/** A row of figures that wraps rather than squashing on a narrow tile. */
export function Figures({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-3">{children}</div>;
}

/**
 * The line under a tile that names what its figures leave out.
 *
 * It is a component rather than a `<p className="…">` because it is a rule,
 * not a style: a number a tile excludes has to be named, and giving that
 * sentence its own name is how the rule stays visible when somebody adds the
 * ninth tile.
 */
export function Excludes({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-detail text-ink-muted">{children}</p>;
}

/**
 * What a tile says when it has nothing to show.
 *
 * Always the next action, never "no data". "No work orders are open" is a
 * fact; "a unit flagged at check-in opens one" is what the reader does with
 * it, and an empty tile that doesn't say that reads as broken.
 */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-detail text-ink-muted">{children}</p>;
}

/** A count of things needing hands, or a dash when there are none. */
export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
