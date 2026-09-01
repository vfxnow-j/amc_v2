"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PricingType } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import {
  setLineQuantity,
  setLineRate,
  type StageOutcome,
} from "@/lib/actions/order-stage";

const PRICING: PricingType[] = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "PROJECT", "CUSTOM"];

/**
 * Editing a line in place.
 *
 * Revising an order is mostly changing a number on a row somebody is looking
 * at, so the row is where it happens — not a modal, and not a separate edit
 * screen that reloads the record to change a 2 into a 3.
 *
 * Committed on blur or Enter, never per keystroke: each save is a transaction
 * that reprices the whole order, and firing one for the "1" in "12" would both
 * hammer the database and briefly write a price nobody chose. Escape puts the
 * original back.
 *
 * A refusal is shown against the row and the value reverts. The interesting one
 * is quantity, which the server will not let drop below what is physically
 * checked out — an order claiming two machines while three are with the client
 * is worse than a rejected edit.
 */
export function LineEditor({
  reservationId,
  itemId,
  quantity,
  rate,
  pricingType,
  isOneTime,
}: {
  reservationId: string;
  itemId: string;
  quantity: number;
  rate: number;
  pricingType: string;
  isOneTime: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(quantity));
  const [amount, setAmount] = useState(rate.toFixed(2));
  const [type, setType] = useState(pricingType);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function handle(result: StageOutcome, revert: () => void) {
    if (result.status === "error") {
      setError(result.message);
      revert();
    } else {
      setError("");
      router.refresh();
    }
  }

  function commitQuantity() {
    const next = Number(qty);
    if (next === quantity) return;
    startTransition(async () => {
      handle(await setLineQuantity(reservationId, itemId, next), () =>
        setQty(String(quantity)),
      );
    });
  }

  function commitRate(nextType = type) {
    const next = Number(amount);
    if (next === rate && nextType === pricingType) return;
    startTransition(async () => {
      handle(
        await setLineRate(reservationId, itemId, next, nextType as PricingType),
        () => {
          setAmount(rate.toFixed(2));
          setType(pricingType);
        },
      );
    });
  }

  return (
    <>
      <input
        value={qty}
        inputMode="numeric"
        disabled={busy}
        aria-label="Quantity"
        onChange={(event) => setQty(event.target.value)}
        onBlur={commitQuantity}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setQty(String(quantity));
            event.currentTarget.blur();
          }
        }}
        className={CELL}
      />

      <span className="flex items-baseline justify-end gap-1">
        <input
          value={amount}
          inputMode="decimal"
          disabled={busy}
          aria-label="Rate"
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => commitRate()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setAmount(rate.toFixed(2));
              event.currentTarget.blur();
            }
          }}
          className={`${CELL} w-[54px]`}
        />
        {isOneTime ? (
          <span className="text-micro text-ink-faint">once</span>
        ) : (
          <select
            value={type}
            disabled={busy}
            aria-label="Rate basis"
            onChange={(event) => {
              setType(event.target.value);
              commitRate(event.target.value);
            }}
            className="rounded-row border-0 bg-transparent text-micro text-ink-faint outline-none hover:bg-row-hover"
          >
            {PRICING.map((option) => (
              <option key={option} value={option}>
                /{option.toLowerCase()}
              </option>
            ))}
          </select>
        )}
      </span>

      {error ? (
        <Notice tone="error" className="col-span-full mt-1">
          {error}
        </Notice>
      ) : null}
    </>
  );
}

const CELL =
  "w-full rounded-row border-0 bg-transparent px-1 py-0 text-right tabular-nums text-ink outline-none hover:bg-row-hover focus:bg-sunken disabled:opacity-50";
