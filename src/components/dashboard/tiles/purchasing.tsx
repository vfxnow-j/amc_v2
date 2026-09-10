import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Empty,
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { money, moneyCompact } from "@/lib/format";
import { getPOHeaderStats, getPOViewCounts } from "@/lib/queries/accounting";

/**
 * What has been ordered from vendors and not yet arrived.
 *
 * Both queries already exist and both already back the Purchase orders screen's
 * header, so this tile invents nothing. It reads two rather than one for a
 * reason the rule insists on: `getPOHeaderStats` counts SUBMITTED and PARTIAL
 * only, so drafts are outside the money figure, and a tile saying "on order"
 * has to say how much has not been sent to anybody yet.
 */
export async function PurchaseOrdersTile() {
  const [{ openCount, openValue }, counts] = await Promise.all([
    getPOHeaderStats(),
    getPOViewCounts(),
  ]);

  if (counts.all === 0) {
    return (
      <Tile className="flex min-h-0 flex-col">
        <TileHeader
          title="On order"
          href="/dashboard/purchase-orders"
          hrefLabel="Purchase orders →"
        />
        <Empty>
          No purchase order has been raised. Raise one against a vendor and the
          value sitting with them shows up here until it is received.
        </Empty>
      </Tile>
    );
  }

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="On order"
        meta={countLabel(openCount, "open PO")}
        href="/dashboard/purchase-orders"
        hrefLabel="Purchase orders →"
      />

      <Figures>
        <Figure
          label="Committed"
          value={moneyCompact(openValue)}
          detail="submitted and part-received"
          href="/dashboard/purchase-orders?view=open"
        />
        <Figure
          label="Received"
          value={counts.received}
          detail="closed out"
          href="/dashboard/purchase-orders?view=received"
        />
        <Figure
          label="Draft"
          value={counts.draft}
          detail={counts.draft === 0 ? "none waiting" : "not sent to a vendor"}
          href="/dashboard/purchase-orders?view=draft"
        />
      </Figures>

      <Excludes>
        {money(openValue)} is what has actually been sent to vendors.{" "}
        {counts.draft === 0
          ? "No draft is waiting behind it."
          : `${countLabel(counts.draft, "draft")} sits behind that figure and is in none of it.`}
      </Excludes>
    </Tile>
  );
}
