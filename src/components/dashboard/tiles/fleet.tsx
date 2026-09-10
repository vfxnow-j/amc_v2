import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Empty,
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { getPricing } from "@/lib/queries/reports";

/**
 * Which rates are out of step with what the hardware cost.
 *
 * `getPricing` already computes this for the Pricing report — payback months
 * against the units' own purchase price, with v1's thresholds unchanged (over
 * ten months to pay back is underpriced, under three overpriced). It is `cache`d
 * there, so placing this tile beside the report's own panels costs one pass.
 *
 * The `unrated` count is the honest half of the tile and the reason it is shown
 * as prominently as the verdicts: an asset with no monthly rate, or no unit
 * carrying a purchase price, cannot be judged at all. Reporting only the three
 * verdicts would quietly present a partial catalogue as the whole one.
 */
export async function RateHealthTile() {
  const { rows, targetMonths } = await getPricing();

  const count = (verdict: string) =>
    rows.filter((row) => row.verdict === verdict).length;

  const under = count("underpriced");
  const over = count("overpriced");
  const unrated = count("unrated");
  const judged = rows.length - unrated;

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Rates to review"
        meta={
          rows.length === 0
            ? undefined
            : `${judged} of ${rows.length} assets can be judged`
        }
        href="/dashboard/reports/pricing"
        hrefLabel="Pricing report →"
      />

      {rows.length === 0 ? (
        <Empty>
          No asset has units in the fleet yet. Rates are judged against what the
          units cost, so an asset needs both a rate and a purchase price to
          appear here.
        </Empty>
      ) : (
        <>
          <Figures>
            <Figure
              label="Underpriced"
              value={under}
              tone={under > 0 ? "alert" : "plain"}
              detail="over 10 months to pay back"
            />
            <Figure
              label="Overpriced"
              value={over}
              detail="pays back inside 3 months"
            />
            <Figure
              label="Unrated"
              value={unrated}
              detail="no rate, or no cost recorded"
            />
          </Figures>

          <Excludes>
            Payback is measured against what the units actually cost, not against
            the market reference, and the target is {targetMonths} months.{" "}
            {unrated === 0 ? (
              "Every asset in the fleet could be judged."
            ) : (
              <>
                {countLabel(unrated, "asset")} could not be judged at all — those
                are a{" "}
                <Link
                  href="/dashboard/insights"
                  className="text-accent-text hover:underline"
                >
                  gap to fill in
                </Link>
                , not a verdict of fair.
              </>
            )}
          </Excludes>
        </>
      )}
    </Tile>
  );
}
