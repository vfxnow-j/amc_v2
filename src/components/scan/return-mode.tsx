"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import { Notice } from "@/components/feedback/notice";
import { scanUnitIn, type CheckinCondition } from "@/lib/actions/desk";
import {
  findOpenReturnsForCode,
  returnProgress,
  type ReturnCandidate,
  type ReturnDiscovery,
  type ScanOrderBrief,
} from "@/lib/actions/scan-desk";
import { completeOrder } from "@/lib/actions/order-stage";
import { STATUS_LABEL } from "@/lib/reservations/status";
import type { Tone } from "@/lib/scan/audio";

/**
 * Scanning kit back in, starting from the kit rather than the order.
 *
 * The first scan identifies the job. Nobody unloading a van knows the order
 * number, and asking for one before the first box can be put down is how a
 * return gets done on paper and typed up later — which is how units end up
 * marked out for weeks after they came home.
 *
 * So: scan, and the unit says where it belongs. One order is the normal case
 * and gets a one-key confirmation; the held barcode is then checked in
 * immediately, so the confirmation costs a keypress and not a re-scan. That is
 * the owner's flow exactly — "finds the order and asks to proceed if correct,
 * scans in that first asset automatically".
 *
 * More than one order is never guessed. That only happens when data has drifted
 * and guessing writes the drift into somebody's job.
 *
 * The condition control persists between scans, deliberately. A pallet that
 * came back wet came back wet, and a modal per unit makes twenty returns
 * unbearable — the same reasoning the order record's check-in panel gives.
 * DAMAGED raises the work order in the same call, which is what actually takes
 * the unit off the shelf; asking someone to do it afterwards is asking for a
 * damaged unit to be re-rented.
 */

const LOG_CAP = 200;

const CONDITIONS: { value: CheckinCondition; label: string }[] = [
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "DAMAGED", label: "Damaged" },
];

function dayMonth(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function OrderLine({ order }: { order: ReturnCandidate }) {
  return (
    <>
      <span className="font-bold tabular-nums">{order.number}</span>
      <span className="text-ink-muted"> · {order.clientName}</span>
      <span className="text-ink-muted">
        {" "}
        · {order.stillOut} still out · due {dayMonth(order.dueBack)}
      </span>
      {order.daysLate > 0 ? (
        <span className="text-accent-text"> · {order.daysLate}d late</span>
      ) : null}
    </>
  );
}

export function ReturnMode() {
  const [order, setOrder] = useState<ReturnCandidate | null>(null);
  const [brief, setBrief] = useState<ScanOrderBrief | null>(null);
  const [discovery, setDiscovery] = useState<ReturnDiscovery | null>(null);
  const [condition, setCondition] = useState<CheckinCondition>("GOOD");
  const [damageNotes, setDamageNotes] = useState("");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);

  function log(code: string) {
    const key = `in-${seq.current++}`;
    setEntries((current) =>
      [{ key, code, state: "pending" as const }, ...current].slice(0, LOG_CAP),
    );
    setPending((count) => count + 1);
    return key;
  }

  function settle(key: string, tone: Tone, message: string, href?: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key
          ? { ...entry, state: "done" as const, tone, message, href }
          : entry,
      ),
    );
    setPending((count) => Math.max(0, count - 1));
    return tone;
  }

  const refresh = useCallback(async (id: string) => {
    const next = await returnProgress(id);
    if (next) setBrief(next);
  }, []);

  /** Check one unit in against the chosen order. */
  const checkIn = useCallback(
    async (code: string, target: ReturnCandidate): Promise<Tone> => {
      const key = log(code);
      const outcome = await scanUnitIn(
        target.orderId,
        code,
        condition,
        condition === "DAMAGED" ? damageNotes : undefined,
      );

      if (outcome.status === "wrong-order") {
        return settle(
          key,
          "warn",
          `${outcome.message} — it belongs to ${outcome.order.reservationNumber}.`,
          `/dashboard/orders/${outcome.order.id}`,
        );
      }
      if (outcome.status === "error") {
        return settle(key, "error", outcome.message);
      }

      void refresh(target.orderId);
      return settle(
        key,
        "ok",
        outcome.message,
        outcome.workOrder
          ? `/dashboard/service/work-orders/${outcome.workOrder.id}`
          : undefined,
      );
    },
    [condition, damageNotes, refresh],
  );

  /** The first scan: work out the order, then hold the code for confirmation. */
  const discover = useCallback(async (code: string): Promise<Tone> => {
    const found = await findOpenReturnsForCode(code);
    setDiscovery(found);
    if (found.kind === "none") {
      const key = log(code);
      return settle(
        key,
        "warn",
        found.known
          ? "That unit isn’t out anywhere — nothing to return."
          : "No unit carries that barcode or serial.",
      );
    }
    return "ok";
  }, []);

  const commit = useCallback(
    async (code: string): Promise<Tone> => {
      if (order) return checkIn(code, order);
      return discover(code);
    },
    [order, checkIn, discover],
  );

  async function accept(candidate: ReturnCandidate, heldCode: string) {
    setBusy(true);
    setOrder(candidate);
    setDiscovery(null);
    // The scan that found the order is the first unit back. Checking it in here
    // is why confirming costs a keypress instead of a re-scan.
    await checkIn(heldCode, candidate);
    await refresh(candidate.orderId);
    setBusy(false);
  }

  async function finish() {
    if (!order) return;
    setBusy(true);
    const outcome = await completeOrder(order.orderId);
    setBusy(false);
    setNotice({
      tone: outcome.status === "ok" ? "ok" : "error",
      message: outcome.message,
    });
    if (outcome.status === "ok") void refresh(order.orderId);
  }

  const stillOut = brief
    ? Math.max(0, brief.out - brief.returned)
    : (order?.stillOut ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        {order ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-card-title">{order.number}</h2>
            <span className="text-detail text-ink-muted">{order.clientName}</span>
            <span className="ml-auto text-detail text-ink-muted">
              {stillOut === 0
                ? "Everything is back"
                : `${stillOut} still with the client`}
            </span>
          </div>
        ) : (
          <div>
            <h2 className="text-card-title">Scan the first item back</h2>
            <p className="text-detail text-ink-muted">
              The unit says which order it belongs to — no order number needed.
            </p>
          </div>
        )}

        <ScanField
          onCommit={commit}
          pending={pending}
          blocked={!!discovery && discovery.kind !== "none"}
          blockedReason="Confirm the order before scanning the rest."
          placeholder={
            order ? `Scan items back onto ${order.number}` : "Scan any item coming back"
          }
        />

        {discovery && discovery.kind === "one" ? (
          <div
            role="alertdialog"
            aria-label="Confirm the order"
            className="rounded-bubble bg-accent-tint p-3"
          >
            <p className="text-card-title text-accent-on-tint">
              Returning {discovery.unitName} to{" "}
              <OrderLine order={discovery.order} />?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => accept(discovery.order, discovery.barcode)}
                className="rounded-well bg-panel px-3 py-2 text-detail font-bold transition-colors hover:bg-row-hover disabled:opacity-60"
              >
                Yes — check it in
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDiscovery(null)}
                className="rounded-well bg-panel px-3 py-2 text-detail transition-colors hover:bg-row-hover"
              >
                No, that&rsquo;s not it
              </button>
            </div>
          </div>
        ) : null}

        {discovery && discovery.kind === "many" ? (
          <div
            role="alertdialog"
            aria-label="Which order?"
            className="rounded-bubble bg-accent-tint p-3"
          >
            <p className="text-card-title text-accent-on-tint">
              {discovery.unitName} is out on {discovery.orders.length} orders
            </p>
            <p className="mt-1 text-detail text-accent-on-tint">
              That should not happen, so nothing is assumed. Say which one this
              is coming back to.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {discovery.orders.map((candidate) => (
                <button
                  key={candidate.orderId}
                  type="button"
                  disabled={busy}
                  onClick={() => accept(candidate, discovery.barcode)}
                  className="rounded-well bg-panel px-3 py-2 text-left text-detail transition-colors hover:bg-row-hover disabled:opacity-60"
                >
                  <OrderLine order={candidate} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-micro uppercase text-ink-muted">Condition</span>
          <div className="flex flex-wrap items-center gap-1 rounded-pill bg-segmented-track p-1">
            {CONDITIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCondition(option.value)}
                aria-pressed={condition === option.value}
                className={`rounded-pill px-3 py-1 text-pill transition-colors duration-[160ms] ${
                  condition === option.value
                    ? "bg-segmented-thumb font-bold text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-detail text-ink-faint">
            applies to every scan until changed
          </span>
        </div>

        {condition === "DAMAGED" ? (
          <label className="flex flex-col gap-[3px]">
            <span className="text-micro uppercase text-ink-muted">
              What is wrong with it
            </span>
            <input
              value={damageNotes}
              onChange={(event) => setDamageNotes(event.target.value)}
              placeholder="Raises a work order and takes the unit off the shelf"
              className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ) : null}

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        {order ? (
          <div className="flex flex-wrap items-center gap-2">
            {brief ? (
              <span className="text-detail text-ink-muted">
                {brief.returned} of {brief.out} back · {STATUS_LABEL[brief.status]}
              </span>
            ) : null}
            <button
              type="button"
              disabled={busy || stillOut > 0 || brief?.status !== "ACTIVE"}
              onClick={finish}
              title={
                stillOut > 0
                  ? `${stillOut} ${stillOut === 1 ? "unit is" : "units are"} still with the client`
                  : brief?.status !== "ACTIVE"
                    ? "An order is completed from Active"
                    : undefined
              }
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid disabled:opacity-40"
            >
              Complete order
            </button>
            <Link
              href={`/dashboard/orders/${order.orderId}`}
              className="self-center text-detail text-accent-text hover:underline"
            >
              Open the order
            </Link>
            <button
              type="button"
              onClick={() => {
                setOrder(null);
                setBrief(null);
                setEntries([]);
                setNotice(null);
              }}
              className="ml-auto text-detail text-ink-muted hover:text-ink"
            >
              Start another return
            </button>
          </div>
        ) : null}
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
        <header className="flex items-baseline gap-2 px-4 pb-2">
          <h2 className="text-card-title">This session</h2>
          {entries.length ? (
            <span className="text-detail text-ink-muted">
              {entries.length} scanned
            </span>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ScanLog entries={entries} />
        </div>
      </section>
    </div>
  );
}
