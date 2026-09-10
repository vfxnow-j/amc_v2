import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { dayYear, money, moneyExact } from "@/lib/format";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import {
  getContractInvoices,
  getContractLines,
  getContractUnits,
  getLeaseUnits,
} from "@/lib/queries/contract-record";
import { INVOICE_STATUS_LABEL } from "@/lib/accounting/labels";

/**
 * The Contract record's cards, for both kinds of contract.
 *
 * Sales and rent-to-own ask about margin and settlement; a lease asks how far
 * through paying for itself it is. They share the card chrome and nothing else,
 * which is exactly why Contracts gives leases their own view rather than a
 * filter chip.
 */

/* ── Sales and rent-to-own ──────────────────────────────────────────────── */

/**
 * What was sold, at what it cost.
 *
 * The order record shows these lines as things to pull. Here they are margin,
 * which is the question a sale asks and a rental doesn't — and a line with no
 * `costBasis` recorded is left out of the totals rather than counted as pure
 * profit, with the count of what was left out on the card.
 */
export async function ContractLinesCard({ id }: { id: string }) {
  const { lines, alternatives, costedCount, costedRevenue, costedCost } =
    await getContractLines(id);

  if (lines.length === 0) {
    return (
      <Card title="Lines">
        <CardEmpty>
          Nothing has been added to this contract. Add a line to price it.
        </CardEmpty>
      </Card>
    );
  }

  const uncosted = lines.length - costedCount;
  const margin = costedRevenue - costedCost;

  return (
    <Card
      title="Lines"
      meta={
        costedCount === 0
          ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} · no costs recorded`
          : `${money(margin)} margin on the ${costedCount} ${costedCount === 1 ? "line" : "lines"} that carry a cost`
      }
    >
      <div className="grid grid-cols-[1fr_46px_98px_98px_84px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Price</span>
        <span className="text-right">Margin</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {lines.map((line, index) => (
          <li
            key={line.id}
            className={`grid grid-cols-[1fr_46px_98px_98px_84px] items-baseline gap-2 rounded-row p-2 text-detail ${
              index % 2 === 1 ? "bg-row-alt" : ""
            }`}
          >
            <span
              className={`truncate ${line.isComponent ? "pl-4 text-ink-muted" : ""}`}
            >
              {line.label}
            </span>
            <span className="text-right tabular-nums text-ink-muted">
              {line.quantity}
            </span>
            <span className="text-right tabular-nums text-ink-muted">
              {line.cost === null ? <Unset /> : moneyExact(line.cost)}
            </span>
            <span className="text-right tabular-nums">
              {moneyExact(line.revenue)}
            </span>
            <span className="text-right tabular-nums">
              {line.margin === null ? (
                <Unset />
              ) : (
                <span className={line.margin < 0 ? "text-destructive" : undefined}>
                  {moneyExact(line.margin)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <footer className="flex flex-col gap-1 px-4 py-3 text-detail text-ink-muted">
        {/* The unchosen configurations. Named rather than summed in: their lines
            would treble the contract, and named rather than dropped, because
            somebody priced them and will look for them. */}
        {alternatives.length > 0 ? (
          <p>
            {alternatives.length} other{" "}
            {alternatives.length === 1 ? "configuration was" : "configurations were"}{" "}
            priced on this order and not chosen —{" "}
            {alternatives
              .map((entry) => `${entry.name} at ${money(entry.value)}`)
              .join(", ")}
            . Neither the lines above nor the contract value include them.
          </p>
        ) : null}
        <p>
        {costedCount === 0 ? (
          <>
            No line on this contract records what it cost, so no margin can be
            shown. Costs are entered per line when a sale is priced.
          </>
        ) : (
          <>
            {moneyExact(costedRevenue)} sold against {moneyExact(costedCost)}{" "}
            bought
            {uncosted > 0 ? (
              <>
                {" "}
                — {uncosted} further {uncosted === 1 ? "line has" : "lines have"}{" "}
                no cost recorded and {uncosted === 1 ? "is" : "are"} in neither
                figure.
              </>
            ) : (
              " across every line."
            )}
          </>
        )}
        </p>
      </footer>
    </Card>
  );
}

/** What has been billed against the contract, and what has come in. */
/**
 * The units that physically changed hands.
 *
 * Only `completeSale` stamps `AssetUnit.soldViaReservation`, and almost nothing
 * in this database went through it — 546 of 548 sold units carry no contract.
 * So the empty state names the gap rather than implying the contract shipped
 * nothing, which would be a fabrication in the other direction.
 */
export async function ContractUnitsCard({ id }: { id: string }) {
  const units = await getContractUnits(id);

  return (
    <Card
      title="Units transferred"
      meta={units.length > 0 ? `${units.length}` : undefined}
    >
      {units.length === 0 ? (
        <CardEmpty>
          No unit is recorded as having transferred on this contract. Units are
          stamped only when a sale is completed through the sale flow — hardware
          marked sold by hand, or imported, carries no contract, so an empty list
          here does not mean nothing shipped.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {units.map((unit) => (
            <li key={unit.id}>
              <Link
                href={`/dashboard/units/${unit.id}`}
                className="grid grid-cols-[86px_1fr_88px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold tabular-nums">
                  {unit.barcode}
                </span>
                <span className="truncate text-ink-muted">
                  {unit.assetName}
                  {unit.serialNumber ? (
                    <span className="text-ink-faint"> · {unit.serialNumber}</span>
                  ) : null}
                </span>
                <span className="text-right tabular-nums">
                  {unit.soldPrice === null ? <Unset /> : moneyExact(unit.soldPrice)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Leases ─────────────────────────────────────────────────────────────── */

/**
 * The hardware a lease paid for, and what each piece has earned back.
 *
 * `totalRevenue` is booked per unit as rentals complete, so this is the one
 * figure on a lease that is a fact rather than a schedule.
 */
export async function LeaseUnitsCard({ id }: { id: string }) {
  const { rows, total } = await getLeaseUnits(id);

  return (
    <Card
      title="Hardware financed"
      meta={
        total === 0
          ? undefined
          : total > rows.length
            ? `${rows.length} of ${total} shown, best earning first`
            : `all ${total} shown`
      }
    >
      {rows.length === 0 ? (
        <CardEmpty>
          No unit is attached to this lease. Attach the hardware it paid for and
          the earnings against it appear here.
        </CardEmpty>
      ) : (
        <>
        <div className="grid grid-cols-[80px_1fr_92px_92px_92px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
          <span>Unit</span>
          <span>Asset</span>
          <span>State</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Earned</span>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
          {rows.map((unit, index) => (
            <li
              key={unit.id}
              className={index % 2 === 1 ? "rounded-row bg-row-alt" : ""}
            >
              <Link
                href={`/dashboard/units/${unit.id}`}
                className="grid grid-cols-[80px_1fr_92px_92px_92px] items-baseline gap-2 rounded-row p-2 text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold tabular-nums">
                  {unit.barcode}
                </span>
                <span className="truncate text-ink-muted">{unit.assetName}</span>
                <span className="truncate text-ink-faint">
                  {UNIT_STATUS_LABEL[unit.status]}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {unit.cost === null ? <Unset /> : money(unit.cost)}
                </span>
                <span className="text-right tabular-nums">
                  {unit.earned > 0 ? money(unit.earned) : <Unset />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
      {rows.length > 0 ? (
        <p className="px-4 pb-3 text-detail text-ink-muted">
          Cost is what the unit was bought for; earned is rental income booked
          against it since.
        </p>
      ) : null}
    </Card>
  );
}
