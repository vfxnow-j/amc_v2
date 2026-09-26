"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { setLineQuantity, type StageOutcome } from "@/lib/actions/order-stage";
import { setFlowLineBasis } from "@/lib/actions/flow-record";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * A Flow line, edited in place: its quantity, and its cost basis per unit.
 *
 * A Flow line has no rate of its own to type — the rate is the line's share of
 * the contract, built from the basis — so the price pencil edits the basis
 * (v1 reservation-items-table), and there is no pricing-type select: Flow bills
 * monthly from its schedule, whatever a line's type says. What the client pays
 * for the line is shown beside it as a monthly average over the term.
 *
 * The basis is saved by line id — never matched by asset — so two lines of the
 * same asset can never swap values. Locked once the client has agreed or the
 * order has been billed; the server refuses then too.
 */
export function FlowLineEditor({
  reservationId,
  itemId,
  quantity,
  costBasis,
  trueCost,
  monthly,
  basisLock,
}: {
  reservationId: string;
  itemId: string;
  quantity: number;
  costBasis: number | null;
  trueCost: number | null;
  /** The line's contract spread over the term. */
  monthly: number | null;
  /** Why the basis can't change, or null while it can. */
  basisLock: string | null;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(quantity));
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState(costBasis == null ? "" : costBasis.toFixed(2));
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
      handle(await setLineQuantity(reservationId, itemId, next), () => setQty(String(quantity)));
    });
  }

  function commitBasis() {
    setEditing(false);
    const next = Number(basis);
    if (basis.trim() === "" || next === costBasis) {
      setBasis(costBasis == null ? "" : costBasis.toFixed(2));
      return;
    }
    startTransition(async () => {
      handle(await setFlowLineBasis(reservationId, itemId, next), () =>
        setBasis(costBasis == null ? "" : costBasis.toFixed(2)),
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

      <span className="flex flex-col items-end">
        {editing ? (
          <input
            value={basis}
            inputMode="decimal"
            autoFocus
            disabled={busy}
            aria-label="Cost basis per unit"
            onChange={(event) => setBasis(event.target.value)}
            onBlur={commitBasis}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setBasis(costBasis == null ? "" : costBasis.toFixed(2));
                setEditing(false);
              }
            }}
            className={`${CELL} w-[96px] bg-sunken`}
          />
        ) : (
          <button
            type="button"
            disabled={busy || basisLock != null}
            title={
              basisLock ??
              "Edit this line's cost basis per unit — the Flow payment is built from it"
            }
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-row px-1 tabular-nums text-ink hover:bg-row-hover disabled:hover:bg-transparent"
          >
            <span className="text-micro text-ink-faint">basis</span>
            {costBasis == null ? "—" : MONEY.format(costBasis)}
            {basisLock ? null : <Pencil className="size-3 text-ink-faint" aria-hidden />}
          </button>
        )}
        <span className="text-micro text-ink-faint tabular-nums">
          {monthly != null ? `≈ ${MONEY.format(monthly)}/mo avg` : ""}
          {trueCost != null && costBasis != null && costBasis > trueCost + 0.005
            ? ` · cost ${MONEY.format(trueCost)}`
            : ""}
        </span>
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
