import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { getBenchLoad } from "@/lib/queries/bench";

/**
 * Who is carrying the bench.
 *
 * The maintenance tile says what is broken; this says who is fixing it, which
 * is the question you ask before handing somebody the next thing.
 *
 * The line that earns the tile is the last one. A unit in `MAINTENANCE` status
 * is out of bookable stock; a work order is the record of somebody doing
 * something about it. Nothing in the schema ties the two, so a unit can sit off
 * the shelf for months with no work order, no owner and no clock running — and
 * nothing else in the app counts it. That is reported, never repaired: opening
 * work orders in bulk would invent a fault, a date and an owner for hardware
 * whose real story is in somebody's head.
 */
export async function BenchLoadTile() {
  const {
    open,
    unassigned,
    atRma,
    techs,
    unitsInService,
    untracked,
    oldestDays,
  } = await getBenchLoad();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="On the bench"
        meta={
          open === 0
            ? `${countLabel(unitsInService, "unit")} in service`
            : `${countLabel(open, "open work order")}${
                oldestDays === null ? "" : ` · oldest ${oldestDays}d`
              }`
        }
        href="/dashboard/service/work-orders"
        hrefLabel="Work orders →"
      />

      <Figures>
        <Figure
          label="In service"
          value={unitsInService}
          detail="out of bookable stock"
        />
        <Figure
          label="Untracked"
          value={untracked}
          tone={untracked > 0 ? "alert" : "plain"}
          detail={untracked === 0 ? "all have a work order" : "no work order"}
        />
        <Figure
          label="At RMA"
          value={atRma}
          detail={atRma === 0 ? "none away" : "waiting on a vendor"}
        />
      </Figures>

      {techs.length > 0 ? (
        <ul className="mt-2 flex min-h-0 flex-col gap-[2px] overflow-y-auto">
          {techs.map((tech, index) => (
            <li
              key={tech.id}
              className={`grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2 rounded-row px-2 py-[6px] ${
                index % 2 === 1 ? "bg-row-alt" : ""
              }`}
            >
              <span className="min-w-0 truncate">{tech.name}</span>
              <span className="text-right text-detail tabular-nums text-ink-muted">
                {countLabel(tech.open, "open")}
              </span>
            </li>
          ))}
          {unassigned > 0 ? (
            <li className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2 rounded-row px-2 py-[6px]">
              <span className="min-w-0 truncate text-ink-muted">Nobody</span>
              <span className="text-right text-detail font-bold tabular-nums text-accent-text">
                {countLabel(unassigned, "open")}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <Excludes>
        {open === 0
          ? "No work order is open, so no bench has a load to show."
          : unassigned === open
            ? `No open work order has a tech assigned, so there is no bench to split ${
                open === 1 ? "it" : "them"
              } across.`
            : `${unassigned} of ${open} open work orders have nobody assigned.`}{" "}
        {untracked > 0 ? (
          <>
            {untracked} of {unitsInService} units in service{" "}
            {untracked === 1 ? "has" : "have"} no open work order at all — off
            the shelf, and tracked by nothing. A unit flagged at check-in opens
            one;{" "}
            <Link
              href="/dashboard/units?view=service"
              className="text-accent-text hover:underline"
            >
              these were put in service another way
            </Link>
            .
          </>
        ) : (
          "Every unit in service has an open work order against it."
        )}
      </Excludes>
    </Tile>
  );
}
