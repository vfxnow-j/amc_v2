import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import { money } from "@/lib/format";
import { getIdleItems, getTopItems } from "@/lib/queries/dashboard";

/**
 * The two halves of "what is the fleet doing" — the hardware carrying the
 * business, and the hardware sitting still.
 *
 * Both rank on money rather than on counts. An asset booked twice at $20,000
 * matters more than one booked ten times at $50, and one idle server matters
 * more than ten idle cables; a screen that ranked by frequency would put the
 * cables at the top and be wrong in a way nobody would notice.
 */

/**
 * `Frame` was here, module-private: the section chrome plus a header of title,
 * qualifier and a link out. Both of those are now `Tile` and `TileHeader` in
 * `components/dashboard/tile.tsx`, so every tile agrees on one shape.
 */
function Frame({
  title,
  meta,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  meta: string;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader title={title} meta={meta} href={href} hrefLabel={hrefLabel} />
      {children}
    </Tile>
  );
}

export async function TopItemsCard() {
  const items = await getTopItems();

  return (
    <Frame
      title="Earning most"
      meta="by what its lines were booked at"
      href="/dashboard/reports/inventory"
      hrefLabel="Inventory report →"
    >
      {items.length === 0 ? (
        <p className="text-detail text-ink-muted">
          No committed order lines yet. This ranks assets once orders are
          approved — quotes and lost deals are deliberately left out.
        </p>
      ) : (
        <ul className="flex flex-col gap-[2px]">
          {items.map((item, index) => (
            <li key={item.assetId}>
              <Link
                href={`/dashboard/assets/${item.assetId}`}
                className={`grid grid-cols-[minmax(0,1fr)_72px_96px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  {item.name}
                  {item.category ? (
                    <span className="text-ink-faint"> · {item.category}</span>
                  ) : null}
                </span>
                <span className="text-right text-detail tabular-nums text-ink-muted">
                  {item.orders} {item.orders === 1 ? "line" : "lines"}
                </span>
                <span className="text-right font-bold tabular-nums">
                  {money(item.booked)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

export async function IdleItemsCard() {
  const items = await getIdleItems();
  const capital = items.reduce((sum, item) => sum + item.capital, 0);
  const unpriced = items.reduce(
    (sum, item) => sum + (item.fleet - item.priced),
    0,
  );

  return (
    <Frame
      title="Never booked"
      meta={
        items.length === 0
          ? "nothing idle"
          : `${money(capital)} of hardware, no order line against it`
      }
      href="/dashboard/units?view=available"
      hrefLabel="Units →"
    >
      {items.length === 0 ? (
        <p className="text-detail text-ink-muted">
          Every asset with units in the fleet has been on at least one committed
          order. Nothing is sitting entirely unused.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-[2px]">
            {items.map((item, index) => (
              <li key={item.assetId}>
                <Link
                  href={`/dashboard/assets/${item.assetId}`}
                  className={`grid grid-cols-[minmax(0,1fr)_64px_96px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {item.name}
                    {item.category ? (
                      <span className="text-ink-faint"> · {item.category}</span>
                    ) : null}
                  </span>
                  <span className="text-right text-detail tabular-nums text-ink-muted">
                    {item.fleet} {item.fleet === 1 ? "unit" : "units"}
                  </span>
                  <span className="text-right font-bold tabular-nums">
                    {item.priced === 0 ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      money(item.capital)
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {unpriced > 0 ? (
            // A missing purchase price is not a cost of zero, and the ranking
            // is by cost — so the rows it could not price have to be named.
            <p className="mt-2 text-detail text-ink-muted">
              {unpriced} of these units {unpriced === 1 ? "has" : "have"} no
              purchase price recorded, so the capital above is what could be
              priced, not the whole of it.
            </p>
          ) : null}
        </>
      )}
    </Frame>
  );
}
