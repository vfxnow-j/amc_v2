import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import { Empty, Excludes, countLabel } from "@/components/dashboard/tiles/parts";
import { BandPill, REASON_LABEL } from "@/components/tracker/band";
import { getTrackerRows } from "@/lib/queries/tracker";
import { getSessionUser } from "@/lib/roles";

const SHOWN = 6;

/**
 * Who to call: the Tracker's queue, cut to the few most urgent.
 *
 * Yours first. A person who owns accounts sees their own due items; one who
 * owns none — everyone, until accounts are claimed — sees the whole queue,
 * because an empty "yours" tile on day one would say nothing is due when 85
 * accounts are. The tile says which it is showing.
 *
 * A prompt, not the list: the ranking and every reason live on the Tracker,
 * and a tile that scrolled through all of them would be a worse copy of it.
 */
export async function TrackerQueueTile() {
  const [rows, viewer] = await Promise.all([getTrackerRows(), getSessionUser()]);
  const due = rows.filter((row) => row.reasons.length > 0);
  const mine = viewer ? due.filter((row) => row.owner?.id === viewer.id) : [];
  const owns = viewer ? rows.some((row) => row.owner?.id === viewer.id) : false;
  const shown = owns ? mine : due;

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Who to call"
        meta={
          shown.length === 0
            ? undefined
            : owns
              ? `${countLabel(mine.length, "of yours", "of yours")} due`
              : `${countLabel(due.length, "account")} due · nobody owns any yet`
        }
        href="/dashboard/clients/tracker"
        hrefLabel="Tracker →"
      />

      {shown.length === 0 ? (
        <Empty>
          {owns
            ? "Nothing of yours is due today. The rest of the queue is on the Tracker."
            : "Nothing is due. Follow-ups appear here when a next step, a quote, a quiet account or a returning rental needs a call."}
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
          {shown.slice(0, SHOWN).map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">{row.name}</span>
                  <span className="block truncate text-detail text-ink-muted">
                    {[...new Set(row.reasons.map((reason) => REASON_LABEL[reason.kind]))].join(" · ")}
                  </span>
                </span>
                <BandPill band={row.band} pinned={!!row.temperature.pinned} />
                <span className="text-right text-detail tabular-nums text-ink-muted">
                  {row.overdueDays === 0 ? "today" : `${row.overdueDays}d`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {shown.length > SHOWN ? (
        <Excludes>{shown.length - SHOWN} more on the Tracker, ranked the same way.</Excludes>
      ) : null}
    </Tile>
  );
}
