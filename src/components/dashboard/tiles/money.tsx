import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import {
  Empty,
  Excludes,
  Figure,
  Figures,
  countLabel,
} from "@/components/dashboard/tiles/parts";
import { money, moneyCompact } from "@/lib/format";
import { getSaleMargin } from "@/lib/queries/margin";
import { getArAging } from "@/lib/queries/receivables";

/**
 * The two money tiles that needed a query written for them.
 *
 * Both are as much about what they exclude as what they report, and both say so
 * on the tile rather than in a comment nobody opens: an AR position without its
 * drafts beside it reads as the whole position, and a margin that quietly
 * folded in the lines with no cost recorded would read as a company-wide gross
 * margin when it is a reading of twenty-one lines.
 */

/**
 * Money owed, aged on the due date.
 *
 * Overdue is unsettled *and* past due, judged on the date rather than on
 * `Invoice.status` — that column is maintained by a nightly job v2 does not
 * run, so an invoice can be four months late and still read SENT. One
 * definition, shared with the invoice list and the client record, so the tile
 * and the record it links to can never disagree.
 */
export async function ArAgingTile() {
  const { buckets, owed, count, overdue, overdueCount, drafts, oldest } =
    await getArAging();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Money owed"
        meta={count === 0 ? undefined : countLabel(count, "unsettled invoice")}
        badge={
          overdueCount > 0 ? (
            <span className="rounded-pill bg-accent-tint-strong px-2 py-px text-pill text-accent-on-tint">
              {moneyCompact(overdue)} late
            </span>
          ) : undefined
        }
        href="/dashboard/invoices?view=outstanding"
        hrefLabel="Invoices →"
      />

      {count === 0 ? (
        <Empty>
          Nothing is outstanding — no invoice has been sent and left unpaid.
          {drafts.count > 0
            ? ` ${countLabel(drafts.count, "draft")} worth ${money(
                drafts.value,
              )} is waiting to be sent, and is not owed by anyone until it is.`
            : ""}
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-[2px]">
            {buckets.map((bucket, index) => (
              <li
                key={bucket.key}
                className={`grid grid-cols-[minmax(0,1fr)_40px_96px] items-center gap-2 rounded-row px-2 py-[6px] ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
              >
                <span
                  className={`min-w-0 truncate ${
                    bucket.key === "90+" && bucket.count > 0
                      ? "font-bold text-accent-text"
                      : ""
                  }`}
                >
                  {bucket.label}
                </span>
                <span className="text-right text-detail tabular-nums text-ink-muted">
                  {bucket.count === 0 ? "—" : bucket.count}
                </span>
                <span className="text-right font-bold tabular-nums">
                  {bucket.owed === 0 ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    money(bucket.owed)
                  )}
                </span>
              </li>
            ))}
          </ul>

          {oldest ? (
            <p className="mt-2 text-detail text-ink-muted">
              Oldest:{" "}
              <Link
                href={`/dashboard/invoices/${oldest.id}`}
                className="text-accent-text hover:underline"
              >
                {oldest.invoiceNumber}
              </Link>{" "}
              — {oldest.clientName}, {oldest.daysPastDue} days past due for{" "}
              {money(oldest.owed)}.
            </p>
          ) : null}

          <Excludes>
            {money(owed)} outstanding is what has been sent and not settled.{" "}
            {drafts.count > 0
              ? `${countLabel(drafts.count, "draft invoice")} worth ${money(
                  drafts.value,
                )} ${
                  drafts.count === 1 ? "sits" : "sit"
                } outside that figure entirely — nobody has been asked for it yet.`
              : "No draft is waiting behind it."}{" "}
            Aged on the due date, not the issue date: payment terms differ per
            client, and an invoice issued sixty days ago on net-90 terms is not
            late.
          </Excludes>
        </>
      )}
    </Tile>
  );
}

/**
 * What the sale book makes on what it sells.
 *
 * Sales and rent-to-own only. A rental has no cost of goods — the hardware was
 * bought once and earns many times over — so putting rentals in this figure
 * would report the entire rental book as profit. The question a rental raises
 * is payback, and the pricing report answers it properly.
 *
 * Read from the lines on each order's **active package**, never from
 * `Reservation.subtotal`, which sums the alternative configurations that were
 * priced and rejected too: on the largest committed sale here that is $385,219
 * of subtotal against an active package worth $198,979.
 */
export async function SaleMarginTile() {
  const {
    orders,
    lines,
    costed,
    revenue,
    cost,
    margin,
    percent,
    uncostedRevenue,
    internalCost,
  } = await getSaleMargin();

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="Margin on the sale book"
        meta={
          orders === 0
            ? undefined
            : `${countLabel(orders, "committed sale order")} · ${costed} of ${lines} lines costed`
        }
        href="/dashboard/sales"
        hrefLabel="Sales →"
      />

      {orders === 0 ? (
        <Empty>
          No sale or rent-to-own order is committed. Approve one and what it
          makes shows up here — rentals are deliberately not counted, because
          hardware bought once and rented many times has no cost of goods per
          order.
        </Empty>
      ) : costed === 0 ? (
        <Empty>
          {countLabel(lines, "line")} on{" "}
          {countLabel(orders, "committed sale order")},
          and not one records a cost. Enter a cost on the sale lines and the
          margin appears here; until then this can report revenue but not what
          it made.
        </Empty>
      ) : (
        <>
          <Figures>
            <Figure
              label="Revenue"
              value={moneyCompact(revenue)}
              detail="lines that record a cost"
            />
            <Figure label="Cost" value={moneyCompact(cost)} detail="as entered" />
            <Figure
              label="Margin"
              value={moneyCompact(margin)}
              tone={margin <= 0 ? "alert" : "plain"}
              detail={percent === null ? "no revenue" : `${percent}% of revenue`}
            />
          </Figures>

          <Excludes>
            Sales and rent-to-own only — a rental has no cost of goods, so
            including it would report the whole rental book as profit.{" "}
            {lines - costed > 0
              ? `${countLabel(lines - costed, "line")} worth ${money(
                  uncostedRevenue,
                )} ${
                  lines - costed === 1 ? "records" : "record"
                } no cost, and ${
                  lines - costed === 1 ? "is" : "are"
                } in neither figure. `
              : "Every line records a cost. "}
            {internalCost > 0
              ? `${money(internalCost)} of sub-rental, hardware and internal shipping is counted against the margin. `
              : ""}
            Costs are what somebody typed on the line: there is no vendor
            invoice, no landed cost and no freight-in allocation in this schema.
          </Excludes>
        </>
      )}
    </Tile>
  );
}
