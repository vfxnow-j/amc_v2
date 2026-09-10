import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import { Empty, Excludes, countLabel } from "@/components/dashboard/tiles/parts";
import { getSystemFlagBoard } from "@/lib/analytics/insights";

/**
 * What the data cannot agree with itself about, and what nobody has typed in.
 *
 * Not a second "Needs a decision" card. That one carries business judgements —
 * a rate that has not kept up, a quote about to expire — and someone decides.
 * These are two different things again:
 *
 * - **Disagreements** are two records that cannot both be right. Somebody who
 *   knows what happened in the warehouse has to say which one is.
 *   `lib/analytics/data-integrity` reports them and never repairs them, for the
 *   reason this project has learned the hard way: a backfill picked by
 *   guesswork buries the evidence and makes the wrong number permanent.
 * - **Gaps** are facts nobody has entered. Somebody types them in.
 *
 * Disagreements are shown first and never mixed in with the gaps, because they
 * are deliberately low priority — nothing is broken for anyone standing at a
 * shelf — and in one priority-sorted list they sink underneath every missing
 * rate and become invisible. That is exactly the failure the Insights screen
 * was built to fix, and a tile that re-flattened them would undo it.
 */
export async function DataFlagsTile() {
  const { consistency, completeness } = await getSystemFlagBoard();
  const total = consistency.length + completeness.length;

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Doesn't add up"
        meta={
          total === 0
            ? undefined
            : `${countLabel(consistency.length, "disagreement")} · ${countLabel(
                completeness.length,
                "gap",
              )}`
        }
        href="/dashboard/insights"
        hrefLabel="Insights →"
      />

      {total === 0 ? (
        <Empty>
          Nothing disagrees with itself and nothing obvious is missing. This
          checks unit counts against attached units, inventory state against the
          order book, and looks for assets with no rate or units with no purchase
          price.
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
          {[
            // Which board a flag came from is the label, not anything on the
            // flag itself: both boards carry `category: "system"`, so reading
            // the kind off the record would print the same word on every row.
            ...consistency.map((flag) => ({ flag, kind: "disagrees" })),
            ...completeness.map((flag) => ({ flag, kind: "missing" })),
          ]
            .slice(0, 6)
            .map(({ flag, kind }) => {
            const body = (
              <>
                <span className="min-w-0 truncate">{flag.title}</span>
                <span className="text-right text-detail text-ink-faint">
                  {kind}
                </span>
              </>
            );

            return (
              <li key={flag.id}>
                {flag.link ? (
                  <Link
                    href={flag.link}
                    className="grid grid-cols-[minmax(0,1fr)_68px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="grid grid-cols-[minmax(0,1fr)_68px] items-center gap-2 rounded-row px-2 py-[6px]">
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total > 6 ? (
        <Excludes>
          {total - 6} more are on the Insights screen. This tile is a prompt, not
          the list — a tile that scrolled forever would be a worse version of a
          screen that already exists.
        </Excludes>
      ) : null}
    </Tile>
  );
}
