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
import { LINE_NUMBER, LINE_SELECT, LINE_TEXT } from "@/components/orders/line-field";

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

  // Follow the server after a refresh. A build's rate changes when its parts do,
  // so the boxes must not keep what was seeded when the page first loaded.
  const [seed, setSeed] = useState({ quantity, rate, pricingType });
  if (seed.quantity !== quantity || seed.rate !== rate || seed.pricingType !== pricingType) {
    setSeed({ quantity, rate, pricingType });
    setQty(String(quantity));
    setAmount(rate.toFixed(2));
    setType(pricingType);
  }

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
          className={`${CELL} w-[68px]`}
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
            className={`min-w-[78px] ${LINE_SELECT} text-ink-muted`}
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

const CELL = `w-full ${LINE_NUMBER} text-ink`;

/**
 * The quantity of a part under a line, edited in place — the same save as a
 * line's own quantity, without the rate: a part included in its parent's rate
 * has none to change.
 */
export function PartQuantity({
  reservationId,
  itemId,
  quantity,
}: {
  reservationId: string;
  itemId: string;
  quantity: number;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(quantity));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [seed, setSeed] = useState(quantity);
  if (seed !== quantity) {
    setSeed(quantity);
    setQty(String(quantity));
  }

  function commit() {
    const next = Number(qty);
    if (next === quantity) return setQty(String(quantity));
    startTransition(async () => {
      const result = await setLineQuantity(reservationId, itemId, next);
      if (result.status === "error") {
        setError(result.message);
        setQty(String(quantity));
      } else {
        setError("");
        router.refresh();
      }
    });
  }

  return (
    <span className="flex flex-col items-end">
      <input
        value={qty}
        inputMode="numeric"
        disabled={busy}
        aria-label="Part quantity"
        onChange={(event) => setQty(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setQty(String(quantity));
            event.currentTarget.blur();
          }
        }}
        className={`w-[52px] ${LINE_NUMBER} text-ink-muted`}
      />
      {error ? <span className="text-micro text-danger">{error}</span> : null}
    </span>
  );
}

/**
 * The monthly rate of a part in a build that is priced by its parts. Changing it
 * reprices the build above; the part itself still charges nothing on its own line.
 */
export function PartRate({
  reservationId,
  itemId,
  rate,
  unit,
}: {
  reservationId: string;
  itemId: string;
  rate: number;
  unit: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(rate.toFixed(2));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [seed, setSeed] = useState(rate);
  if (seed !== rate) {
    setSeed(rate);
    setAmount(rate.toFixed(2));
  }

  function commit() {
    const next = Number(amount);
    if (next === rate) return setAmount(rate.toFixed(2));
    startTransition(async () => {
      const result = await setLineRate(reservationId, itemId, next);
      if (result.status === "error") {
        setError(result.message);
        setAmount(rate.toFixed(2));
      } else {
        setError("");
        router.refresh();
      }
    });
  }

  return (
    <span className="flex flex-col items-end">
      <span className="flex items-baseline gap-1 text-ink-faint">
        <input
          value={amount}
          inputMode="decimal"
          disabled={busy}
          aria-label="Part rate"
          onChange={(event) => setAmount(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setAmount(rate.toFixed(2));
              event.currentTarget.blur();
            }
          }}
          className={`w-[76px] ${LINE_NUMBER} text-ink-muted`}
        />
        {unit}
      </span>
      {error ? <span className="text-micro text-danger">{error}</span> : null}
    </span>
  );
}
