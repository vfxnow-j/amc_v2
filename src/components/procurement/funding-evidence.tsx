"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  attachOrder,
  attachPurchaseOrder,
  detachOrder,
  detachPurchaseOrder,
  type FundingOutcome,
} from "@/lib/procurement/funding";

/**
 * A request's supporting evidence — the purchase orders it funds, or the client
 * orders that justify it — with attach and detach.
 *
 * One component for both lists, because the two differ only in what they link
 * to and which action writes the join. The join is written from the request's
 * side here; the purchase order record writes the same join from its own side,
 * and either one shows up on the other after a refresh.
 *
 * Detaching removes the link and nothing else. It does not take a PO off the
 * loan it was moved onto when the request was funded — that is a change to the
 * PO's financing, made on the PO.
 */

export type EvidenceRow = {
  id: string;
  href: string;
  title: string;
  detail: string;
  /** Right-hand figure or state, already formatted. */
  aside: string;
};

export function FundingEvidence({
  requestId,
  kind,
  rows,
  options,
  editable,
  empty,
}: {
  requestId: string;
  kind: "purchaseOrder" | "order";
  rows: EvidenceRow[];
  options: { id: string; label: string }[];
  /** False for non-admins and closed requests: the list shows, the controls don't. */
  editable: boolean;
  empty: React.ReactNode;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const noun = kind === "purchaseOrder" ? "purchase order" : "order";

  function run(action: () => Promise<FundingOutcome>) {
    setError("");
    startTransition(async () => {
      const outcome = await action();
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      setPicked("");
      router.refresh();
    });
  }

  return (
    <>
      {error ? (
        <Notice tone="error" className="mx-4 mb-2">
          {error}
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-body text-balance text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-1">
              <Link
                href={row.href}
                className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate">
                  <span className="font-bold tabular-nums">{row.title}</span>
                  <span className="text-ink-faint"> · {row.detail}</span>
                </span>
                <span className="text-right tabular-nums text-ink-muted">{row.aside}</span>
              </Link>
              {editable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      kind === "purchaseOrder"
                        ? detachPurchaseOrder(requestId, row.id)
                        : detachOrder(requestId, row.id),
                    )
                  }
                  aria-label={`Detach ${row.title}`}
                  className="h-7 flex-none rounded-pill px-2 text-micro text-ink-muted hover:bg-row-hover disabled:opacity-50"
                >
                  Detach
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!picked || busy) return;
            run(() =>
              kind === "purchaseOrder"
                ? attachPurchaseOrder(requestId, picked)
                : attachOrder(requestId, picked),
            );
          }}
          className="flex gap-2 px-4 pb-4"
        >
          <select
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            aria-label={`${noun} to attach`}
            className="h-8 min-w-0 flex-1 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
          >
            <option value="">
              {options.length === 0 ? `No ${noun} left to attach` : `Attach a ${noun}…`}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!picked || busy}
            className="h-8 flex-none rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
          >
            Attach
          </button>
        </form>
      ) : null}
    </>
  );
}
