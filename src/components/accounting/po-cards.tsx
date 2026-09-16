import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { dayYear, moneyExact } from "@/lib/format";
import {
  getPOAssets,
  getPODocuments,
  getPOFees,
  getPOLines,
} from "@/lib/queries/po-record";
import { getPOReceivedUnits } from "@/lib/procurement/po-queries";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import type { ReceiveMode } from "@/lib/accounting/labels";

/**
 * The Purchase order record's cards.
 *
 * The receiving state is the point of this screen — a PO that has been half
 * received has hardware standing somewhere that isn't bookable stock yet — so
 * every line carries its received-of-ordered split rather than the PO carrying
 * one flag.
 */

const MODE_NOTE: Record<ReceiveMode, string> = {
  units: "serialized — receiving creates units",
  serials: "for resale — serials captured, no units",
  consumable: "consumable — no units, no serials",
  unlinked: "no model yet — receiving creates one",
};

export async function POLinesCard({ id }: { id: string }) {
  const lines = await getPOLines(id);

  if (lines.length === 0) {
    return (
      <Card title="Lines">
        <CardEmpty>
          Nothing has been ordered on this PO. Add a line before submitting it to
          the vendor.
        </CardEmpty>
      </Card>
    );
  }

  const outstanding = lines.filter((line) => line.remaining > 0).length;

  return (
    <Card
      title="Lines"
      meta={
        outstanding === 0
          ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} · all received`
          : `${outstanding} of ${lines.length} still to come`
      }
    >
      <div className="grid grid-cols-[1fr_92px_100px_104px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Description</span>
        <span className="text-right">Received</span>
        <span className="text-right">Unit</span>
        <span className="text-right">Amount</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
        {lines.map((line, index) => (
          <li
            key={line.id}
            className={`rounded-row p-2 text-detail ${index % 2 === 1 ? "bg-row-alt" : ""}`}
          >
            <div className="grid grid-cols-[1fr_92px_100px_104px] items-baseline gap-2">
              <span className="truncate">{line.description}</span>
              <span
                className={`text-right tabular-nums ${line.remaining > 0 ? "font-bold text-accent-text" : "text-ink-muted"}`}
              >
                {line.received}/{line.quantity}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {moneyExact(line.unitPrice)}
              </span>
              <span className="text-right tabular-nums">
                {moneyExact(line.amount)}
              </span>
            </div>
            <p className="truncate pt-[2px] text-ink-faint">
              {line.assetName ? `${line.assetName} · ` : ""}
              {MODE_NOTE[line.mode]}
              {line.serials.length > 0
                ? ` · serials ${line.serials.join(", ")}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * What the PO costs, in the order the total is built.
 *
 * Fees are their own model rather than a column, so they are listed rather than
 * summed into a single line: `feesTotal` is a denormalized sum and the lines are
 * the reason it is what it is.
 */
export async function POCostsCard({
  id,
  subtotal,
  discountAmount,
  freightAmount,
  feesTotal,
  taxAmount,
  taxExempt,
  total,
}: {
  id: string;
  subtotal: number;
  discountAmount: number;
  freightAmount: number;
  feesTotal: number;
  taxAmount: number;
  taxExempt: boolean;
  total: number;
}) {
  const fees = await getPOFees(id);
  const feeSum = fees.reduce((sum, fee) => sum + fee.amount, 0);

  return (
    <Card title="Cost">
      <div className="flex flex-col gap-1 px-4 pb-4 text-detail">
        <Row label="Lines" value={moneyExact(subtotal)} />
        {discountAmount > 0 ? (
          <Row label="Discount" value={`−${moneyExact(discountAmount)}`} />
        ) : null}
        {freightAmount > 0 ? (
          <Row label="Freight" value={moneyExact(freightAmount)} />
        ) : null}
        {fees.map((fee) => (
          <Row key={fee.id} label={fee.description} value={moneyExact(fee.amount)} />
        ))}
        {/* The stored sum is what the total was built from; if the fee lines no
            longer add up to it, say so rather than showing one and implying the
            other. */}
        {Math.abs(feeSum - feesTotal) > 0.01 ? (
          <Row
            label={fees.length === 0 ? "Fees" : "Fees, unitemised"}
            value={moneyExact(feesTotal - feeSum)}
          />
        ) : null}
        <Row
          label={taxExempt ? "Tax · exempt" : "Tax"}
          value={moneyExact(taxAmount)}
        />
        <Row label="Total" value={moneyExact(total)} loud />
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  loud,
}: {
  label: string;
  value: string;
  loud?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={`truncate ${loud ? "font-bold" : "text-ink-muted"}`}>
        {label}
      </span>
      <span
        className={`ml-auto flex-none tabular-nums ${loud ? "text-[16px] font-bold" : "text-ink-muted"}`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * The models this PO brought into the catalog.
 *
 * Models only — the units it delivered are their own card, counted off
 * `AssetUnit.purchaseOrderId`. The figure here is what each model holds today,
 * which a later PO for the same model also adds to, so it is labeled as that.
 */
export async function POAssetsCard({ id }: { id: string }) {
  const assets = await getPOAssets(id);

  return (
    <Card
      title="Models created"
      meta={assets.length > 0 ? "units each holds today" : undefined}
    >
      {assets.length === 0 ? (
        <CardEmpty>
          No model was created from this PO. A fleet line with no model gets one
          when it is received; resale and consumable lines never do.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {assets.map((asset) => (
            <li key={asset.id}>
              <Link
                href={`/dashboard/assets/${asset.id}`}
                className="grid grid-cols-[1fr_64px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate">
                  <span className="font-bold">{asset.name}</span>
                  {asset.maker ? (
                    <span className="text-ink-faint"> · {asset.maker}</span>
                  ) : null}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {asset.units || <Unset />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The units this PO delivered — the fleet end of the trail.
 *
 * Counted off `AssetUnit.purchaseOrderId`, which receiving stamps. Every PO
 * received before that column existed shows none here even though hardware
 * arrived, and the empty state says so rather than implying nothing came.
 */
export async function POUnitsCard({ id, received }: { id: string; received: number }) {
  const { rows, total } = await getPOReceivedUnits(id);

  return (
    <Card
      title="Units received"
      meta={
        total === 0
          ? undefined
          : total > rows.length
            ? `${rows.length} newest of ${total}`
            : `all ${total}`
      }
    >
      {total === 0 ? (
        <CardEmpty>
          {received > 0
            ? `${received} ${received === 1 ? "item was" : "items were"} received on this PO, but no unit is linked back to it — they arrived before receiving recorded the PO on each unit, or on lines that make no units.`
            : "Nothing has been received against this PO yet. Units booked in on a fleet line appear here, each linked back to this order."}
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {rows.map((unit) => (
            <li key={unit.id}>
              <Link
                href={`/dashboard/units/${unit.id}`}
                className="grid grid-cols-[92px_minmax(0,1fr)_80px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold tabular-nums">{unit.barcode}</span>
                <span className="truncate">
                  {unit.asset.name}
                  <span className="text-ink-faint">
                    {unit.serialNumber ? ` · ${unit.serialNumber}` : " · no serial"}
                    {unit.location ? ` · ${unit.location.name}` : ""}
                  </span>
                </span>
                <span className="truncate text-right text-ink-muted">
                  {UNIT_STATUS_LABEL[unit.status] ?? unit.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function PODocumentsCard({ id }: { id: string }) {
  const documents = await getPODocuments(id);

  return (
    <Card title="Documents">
      {documents.length === 0 ? (
        <CardEmpty>
          No PO document has been generated. One is written automatically the
          first time this order is received.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {documents.map((document) => (
            <li
              key={document.id}
              className="grid grid-cols-[1fr_74px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
            >
              <span className="truncate">{document.filename}</span>
              <span className="text-right tabular-nums text-ink-faint">
                {dayYear(document.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* The PDF renders on demand and always matches the PO as it stands. The
          saved documents do not: each is a snapshot from the moment it was
          written, and the PO has been edited since more often than not. Both
          are worth having, so both are offered, said apart. */}
      <p className="px-4 pb-4 text-detail text-ink-muted">
        <a
          href={`/dashboard/purchase-orders/${id}/pdf`}
          target="_blank"
          rel="noopener"
          className="text-accent-text hover:underline"
        >
          Print this PO as it stands
        </a>
        {documents.length > 0
          ? " — the copies above are snapshots from when each was written."
          : "."}
      </p>
    </Card>
  );
}
