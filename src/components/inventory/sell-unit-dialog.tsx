"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { sellAssetUnit } from "@/lib/actions/assets";
import {
  SALE_CHANNELS,
  SALE_CHANNEL_LABEL,
  guessChannel,
  netReceived,
  type SaleChannelValue,
} from "@/lib/sales/sale-channel";

/**
 * Record how a unit was sold: the channel, what it sold for, and for eBay the
 * fees taken out of it.
 *
 * Also the way to correct a sale already recorded: it opens pre-filled on a
 * SOLD unit and saving writes the new figures over the old. Gain or loss is
 * shown against what we keep (price less fees), not the headline price.
 *
 * The same rules run again on the server in `normalizeSale`; this form only
 * stops a bad submit early.
 */

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

const money = (n: number) => `$${n.toFixed(2)}`;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SellUnitDialog({
  unitId,
  barcode,
  cost,
  sold,
}: {
  unitId: string;
  barcode: string;
  /** Landed cost, when the unit has one. Used only for the gain or loss line. */
  cost: number | null;
  /** The sale already on record, when correcting one. */
  sold: {
    soldAt: string;
    soldPrice: number | null;
    soldTo: string | null;
    soldNotes: string | null;
    saleChannel: SaleChannelValue | null;
    saleFees: number | null;
  } | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [channel, setChannel] = useState<SaleChannelValue>(
    guessChannel(sold?.saleChannel ?? null, sold?.soldTo ?? null),
  );
  const [soldTo, setSoldTo] = useState(
    sold?.soldTo && !/\be-?bay\b/i.test(sold.soldTo) ? sold.soldTo : "",
  );
  const [soldAt, setSoldAt] = useState(sold?.soldAt ?? today());
  const [price, setPrice] = useState(
    sold?.soldPrice != null ? String(sold.soldPrice) : "",
  );
  const [fees, setFees] = useState(
    sold?.saleFees != null ? String(sold.saleFees) : "",
  );
  const [notes, setNotes] = useState(sold?.soldNotes ?? "");

  const ebay = channel === "EBAY";
  const priceValue = price === "" ? NaN : Number(price);
  const priceOk = Number.isFinite(priceValue) && priceValue >= 0;
  // A fee typed before switching away from eBay is ignored, not submitted.
  const feesValue = !ebay || fees === "" ? null : Number(fees);
  const feesOk =
    feesValue === null
      ? !ebay
      : Number.isFinite(feesValue) &&
        feesValue >= 0 &&
        (!priceOk || feesValue <= priceValue);
  const net = priceOk ? netReceived(priceValue, feesValue) : null;
  const canSubmit =
    (ebay || soldTo.trim() !== "") && soldAt !== "" && priceOk && feesOk;
  const gain = cost != null && net !== null ? net - cost : null;

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        await sellAssetUnit(unitId, {
          soldAt,
          soldPrice: priceValue,
          soldTo: ebay ? "eBay" : soldTo.trim(),
          soldNotes: notes.trim() || null,
          saleChannel: channel,
          saleFees: feesValue,
        });
        setOpen(false);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
      >
        {sold ? "Edit sale" : "Sell unit"}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={sold ? `Edit the sale of ${barcode}` : `Sell ${barcode}`}
        blurb="Marks the unit sold, closes any open check-out on it, and takes it out of the fleet count."
        footer={
          <>
            {error ? (
              <span className="mr-auto text-detail text-destructive">{error}</span>
            ) : null}
            <ModalCancel />
            <ModalConfirm disabled={busy || !canSubmit} onClick={submit}>
              {busy ? "Saving…" : sold ? "Save sale" : "Mark sold"}
            </ModalConfirm>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <span className={LABEL}>Sold via</span>
            <div
              role="radiogroup"
              aria-label="Sold via"
              className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
            >
              {SALE_CHANNELS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={channel === value}
                  onClick={() => setChannel(value)}
                  className={`rounded-pill px-3 py-[5px] text-pill ${
                    channel === value
                      ? "bg-accent-solid text-accent-on-solid"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {SALE_CHANNEL_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          {!ebay ? (
            <label className={LABEL}>
              {channel === "CUSTOMER" ? "Customer" : "Sold to"}
              <input
                value={soldTo}
                onChange={(e) => setSoldTo(e.target.value)}
                placeholder={channel === "CUSTOMER" ? "Client name" : "Reseller, buyer…"}
                className={`${INPUT} mt-[6px] normal-case`}
              />
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Sale price
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className={`${INPUT} mt-[6px]`}
              />
            </label>
            <label className={LABEL}>
              Sale date
              <input
                type="date"
                value={soldAt}
                max={today()}
                onChange={(e) => setSoldAt(e.target.value)}
                className={`${INPUT} mt-[6px]`}
              />
            </label>
          </div>

          {ebay ? (
            <>
              <p className="text-detail text-ink-muted">
                Use eBay&rsquo;s &ldquo;Sold for&rdquo; amount, not the order
                total, which includes the buyer&rsquo;s sales tax.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>
                  eBay fees
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={fees}
                    onChange={(e) => setFees(e.target.value)}
                    placeholder="0.00"
                    className={`${INPUT} mt-[6px]`}
                  />
                </label>
                <div>
                  <span className={LABEL}>Net we receive</span>
                  <div className="flex h-9 items-center rounded-well bg-sunken px-3 text-detail font-bold tabular-nums">
                    {net !== null && feesValue !== null && feesOk
                      ? money(net)
                      : "—"}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {gain !== null ? (
            <p className="text-detail text-ink-muted">
              Cost {money(cost!)} ·{" "}
              <span className="font-bold text-ink">
                {gain >= 0 ? "Gain" : "Loss"} {money(Math.abs(gain))}
              </span>{" "}
              against what we keep.
            </p>
          ) : null}

          <label className={LABEL}>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={ebay ? "eBay order number, bundle details…" : "Order number, bundle details…"}
              className={`${INPUT} mt-[6px] h-auto py-2 normal-case`}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
