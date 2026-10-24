import { Tile, TileHeader } from "@/components/dashboard/tile";
import { Empty, Figure, Figures, countLabel } from "@/components/dashboard/tiles/parts";
import { moneyCompact } from "@/lib/format";
import { getFlagTile } from "@/lib/queries/order-flag-tile";

/**
 * Orders carrying an open flag case: how many, how bad, how much is at risk,
 * and how many are past their follow-up date. A prompt, not the list: it links
 * to the Orders screen filtered to flagged orders.
 */
export async function OrderFlagsTile() {
  const t = await getFlagTile();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Flagged"
        meta={t.open === 0 ? undefined : countLabel(t.open, "open case")}
        href="/dashboard/orders?flag=flagged"
        hrefLabel="Orders →"
      />
      {t.open === 0 ? (
        <Empty>No order has an open flag. Use Flag on an order to open a case.</Empty>
      ) : (
        <Figures>
          <Figure
            label="Critical"
            value={t.critical}
            detail={`${t.attention} attention · ${t.info} info`}
            tone={t.critical > 0 ? "alert" : "plain"}
            href="/dashboard/orders?flag=critical"
          />
          <Figure label="At risk" value={moneyCompact(t.exposure)} detail="replacement cost of units on open cases" />
          <Figure
            label="Overdue follow-up"
            value={t.stale}
            detail="past their next action date"
            tone={t.stale > 0 ? "alert" : "plain"}
            href="/dashboard/orders?flag=stale"
          />
        </Figures>
      )}
    </Tile>
  );
}
