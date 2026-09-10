import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The dashboard tile: one surface, one padding ladder, one header.
 *
 * Every card on the dashboard used to inline `rounded-card bg-panel p-[14px]
 * shadow-sm`, and the two most tile-like primitives — `Kpi` and `Frame` — were
 * module-private in the files that happened to need them first. That was fine
 * while the dashboard was a fixed stack of hand-placed cards. It stops being
 * fine the moment a tile is a thing a user can pick, move and resize: a tile
 * has to be one shape, decided in one place, or a grid of them reads as a pile
 * of near-misses.
 *
 * So this is the shape, and it is the only place the shape is written down.
 *
 * **`record-card.tsx` is deliberately not this.** The record screens carry
 * their own card, and coupling the two would mean a dashboard styling decision
 * repaints every client, order and unit record in the app. They look similar
 * today; they are not the same object, and the day the dashboard grows a
 * denser tile style is the day that difference earns its keep.
 *
 * The surface reads `--tile-surface`, which is `--panel` today and nothing
 * else. It exists so the appearance axis that is coming (a `data-tile`
 * attribute, per the plan's C9) is one line in `globals.css` rather than a
 * find-and-replace across a dozen components.
 */

/**
 * Padding is a small closed set, not a free prop, because the choice is really
 * "does the content touch the edge" and there are exactly three answers.
 */
const PAD = {
  /** Inset content: prose, pill rows, anything that shouldn't touch the edge. */
  card: "p-[14px]",
  /** A single figure. Tighter vertically — there is no header above it. */
  kpi: "px-[14px] py-3",
  /**
   * Header inset, body edge to edge. Tables live in these: their rows carry
   * their own hover fill and it has to run the full width of the tile, so the
   * horizontal padding belongs on the header and the row list, not here.
   */
  flush: "pt-[14px]",
} as const;

/**
 * Tone is not decoration. `alert` is the one card that changes colour because
 * something needs hands, and it is spelled out here so that "the alert state"
 * is a single decision rather than a colour somebody picked twice.
 */
const TONE = {
  plain: "bg-tile",
  alert: "bg-accent-tint",
} as const;

export type TilePad = keyof typeof PAD;
export type TileTone = keyof typeof TONE;

export function Tile({
  pad = "card",
  tone = "plain",
  className,
  children,
}: {
  pad?: TilePad;
  tone?: TileTone;
  /** Layout only — flex, min-height, overflow. Not surface, not padding. */
  className?: string;
  /** Optional so a skeleton can be the chrome and nothing else. */
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn("rounded-card shadow-sm", TONE[tone], PAD[pad], className)}
    >
      {children}
    </section>
  );
}

/**
 * Title, a line of qualification, an optional badge, and the way out.
 *
 * The link is always last and always `ml-auto`: every tile is a reading you
 * can get behind, and the escape hatch sits in the same place on all of them
 * so it can be found without reading.
 */
export function TileHeader({
  title,
  meta,
  badge,
  href,
  hrefLabel,
  className,
}: {
  title: string;
  /** What the number is made of. Counts are always qualified. */
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn("mb-2 flex items-baseline gap-2", className)}>
      <h2 className="text-card-title">{title}</h2>
      {meta ? <span className="text-detail text-ink-muted">{meta}</span> : null}
      {badge}
      {href && hrefLabel ? (
        <Link
          href={href}
          className="ml-auto text-detail text-accent-text hover:underline"
        >
          {hrefLabel}
        </Link>
      ) : null}
    </header>
  );
}

/**
 * One figure, its label, and the pill that says what the figure is made of.
 *
 * Exported rather than private to `kpi-row.tsx` because a KPI is the smallest
 * tile there is, and the tile picker needs to be able to place one on its own.
 *
 * `tone="alert"` is the Overdue card: same geometry, accent surface, and the
 * pill inverts to the panel colour so it stays legible on the tint. It was a
 * near-copy of this component living beside it; two copies of the alert state
 * is exactly how the alert state drifts.
 */
export function Kpi({
  label,
  value,
  meta,
  tone = "plain",
}: {
  label: string;
  value: React.ReactNode;
  meta: React.ReactNode;
  tone?: TileTone;
}) {
  const alert = tone === "alert";

  return (
    <Tile pad="kpi" tone={tone}>
      <p
        className={cn(
          "text-micro uppercase",
          alert ? "text-accent-on-tint" : "text-ink-muted",
        )}
      >
        {label}
      </p>
      <p className={cn("text-kpi mt-1", alert && "text-accent-text")}>{value}</p>
      <p
        className={cn(
          "mt-1 inline-block rounded-pill px-2 py-px text-pill",
          alert ? "bg-panel text-accent-on-tint" : "bg-sunken text-ink-muted",
        )}
      >
        {meta}
      </p>
    </Tile>
  );
}
