import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Empty,
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { money, moneyCompact } from "@/lib/format";
import {
  getRecurringBillingHealth,
  getReportsHeader,
} from "@/lib/queries/reports";

/**
 * Two tiles over queries the Reports index already runs.
 *
 * Neither adds a query: `getReportsHeader` and `getRecurringBillingHealth` are
 * both in `queries/reports.ts`, both already reasoned about, and both already
 * carry the caveats the copy below repeats. That is the whole point of the
 * reuse wave — a tile that invents its own arithmetic for a figure another
 * screen already shows is how two screens start disagreeing about the same
 * month.
 */

/**
 * The year, on the accrual basis the rest of the app uses.
 *
 * Deliberately shows no invoice figure. `getReportsHeader` computes one, and
 * it excludes drafts — which in this database is $97,793 of the $98,568 ever
 * raised. A tile that showed "invoiced" without that number beside it would
 * be quietly wrong by two orders of magnitude, so the invoice position lives
 * on its own tile where the drafts can be named properly.
 */
export async function YearToDateTile() {
  const { earned, fleet, out, assets, since } = await getReportsHeader();
  const year = since.getFullYear();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="This year so far"
        meta={`since 1 January ${year}`}
        href="/dashboard/reports"
        hrefLabel="Reports →"
      />

      <Figures>
        <Figure
          label="Earned"
          value={moneyCompact(earned.total)}
          detail={`${moneyCompact(earned.recurring)} of it recurring`}
        />
        <Figure
          label="Fleet"
          value={fleet}
          detail={`${countLabel(assets, "asset")} on the shelf`}
        />
        <Figure
          label="Out now"
          value={out}
          detail={
            fleet === 0
              ? "nothing to book"
              : `${((out / fleet) * 100).toFixed(0)}% of the fleet`
          }
        />
      </Figures>

      <Excludes>
        Earned is accrual basis — recurring cycles that fell in the year, rental
        checkouts and completed sales — not money collected. Retired and sold
        units are outside the fleet count.
      </Excludes>
    </Tile>
  );
}

/**
 * Whether the recurring book is actually billing.
 *
 * **Read the word "behind" carefully — it is not the billing book's "stalled",
 * and the two tiles sit on the same dashboard.** `runBillingCycle` selects
 * `nextBillingDate: { lte: now }`, so a date in the past is *due*, not skipped:
 * the run would raise it the moment anything ran the run, and nothing in v2
 * does. A null date is the different, worse case — the filter never matches it,
 * so that order bills nobody ever, and it is the billing book's `stalled`.
 * `getRecurringBillingHealth` counts both together because the forecast, which
 * is what it was written for, cannot place either in a future month.
 *
 * Naming them the same thing on one screen is how the dashboard would end up
 * saying "8 stalled" and "0 stalled" in two tiles a hand's width apart.
 *
 * The money figure is `_sum(total)` over those orders. `getRecurringBillingHealth`
 * calls that field `perCycle`, which it is not — `Reservation.total` is what the
 * whole term is worth, and no column holds the value of a single cycle
 * (`runBillingCycle` derives it from the lines at billing time). Labelled here
 * as contract value for that reason; summing totals and calling it MRR is the
 * fabricated-figure trap this project has been bitten by before.
 */
export async function RecurringHealthTile() {
  const { live, stranded, perCycle } = await getRecurringBillingHealth();
  const onSchedule = live - stranded;

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Recurring billing"
        meta={live === 0 ? "nothing recurring" : countLabel(live, "live order")}
        href="/dashboard/orders?view=open"
        hrefLabel="Orders →"
      />

      {live === 0 ? (
        <Empty>
          No live order bills on a cycle. An order billed monthly or weekly shows
          up here once it is approved.
        </Empty>
      ) : (
        <>
          <Figures>
            <Figure
              label="On schedule"
              value={onSchedule}
              detail="next date still ahead"
            />
            <Figure
              label="Behind"
              value={stranded}
              tone={stranded > 0 ? "alert" : "plain"}
              detail={
                stranded === 0
                  ? "none waiting"
                  : "billing date passed or unset"
              }
            />
            <Figure
              label="Contract value"
              value={moneyCompact(perCycle)}
              detail="carried by those orders"
            />
          </Figures>

          {stranded > 0 ? (
            <Excludes>
              {stranded} of {live} recurring orders{" "}
              {stranded === 1 ? "is" : "are"} past the next billing date, or have
              none set — {money(perCycle)} of contract value with nothing raised
              against them since. The billing run picks up a passed
              date as soon as it is run; nothing in v2 runs it. That figure is
              the whole term, not one cycle: no column holds what a single cycle
              costs.
            </Excludes>
          ) : null}
        </>
      )}
    </Tile>
  );
}
