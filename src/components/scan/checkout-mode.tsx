"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import { OverScanPrompt } from "@/components/scan/over-scan-prompt";
import { Notice } from "@/components/feedback/notice";
import { scanUnitOut } from "@/lib/actions/desk";
import {
  scanOrderBrief,
  scanOrderQueue,
  scanOrderSearch,
  type ScanOrderBrief,
  type ScanOrderRow,
} from "@/lib/actions/scan-desk";
import { shipOrder, activateOrder, completeOrder } from "@/lib/actions/order-stage";
import { movesFor } from "@/lib/orders/lifecycle";
import { STATUS_LABEL } from "@/lib/reservations/status";
import type { Tone } from "@/lib/scan/audio";
import type {
  OverScanConflict,
  OverScanResolution,
} from "@/lib/reservations/over-scan";

/**
 * Scanning units out against one order.
 *
 * A state machine in three steps, because the expensive mistake here is picking
 * the wrong order — every scan after that writes a checkout against somebody
 * else's job, and each one has to be undone by hand. So: pick, confirm what was
 * picked, then scan.
 *
 * The queue comes first and needs no typing. A person at the packing bench is
 * almost always working the list of what is due out, and making them search for
 * an order they can see on the wall is how a scanner ends up unused.
 *
 * Every write goes through `scanUnitOut`, exactly as the order record does.
 * There is no second check-out implementation here, and there must not be — the
 * quantity guards, the over-scan conflict and the unit-status rules all live
 * under that one action. What this surface adds is the refusal to invent a line
 * for an asset the order never ordered: on the record that is tolerable because
 * you are looking at the order, here one wrong box off a pallet would put a
 * charged line on a client's order with nobody asked.
 *
 * While a conflict is open the field is blocked rather than queueing. A scan
 * must never land behind an unanswered commercial question — that is the entire
 * reason the conflict exists instead of the server widening the line quietly.
 *
 * The moves offered come from `movesFor`, not from a guess about the stage.
 * That matters more here than it looks: `checkoutReservationItem` auto-activates
 * an order on its first checkout, so an order that was PREPARING when you picked
 * it is ACTIVE by the time you have scanned one unit — and "Mark shipped", which
 * only exists in PREPARING, is gone. A hardcoded ship button would sit there
 * disabled forever, blaming the outstanding count for something the first scan
 * did. Reading the stage map means the surface always offers what the order can
 * actually accept, and says so when that is only "complete".
 */

const LOG_CAP = 200;

type Step = "pick" | "confirm" | "scanning";

function dayMonth(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CheckoutMode() {
  const [step, setStep] = useState<Step>("pick");
  const [queue, setQueue] = useState<ScanOrderRow[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ScanOrderRow[] | null>(null);
  const [brief, setBrief] = useState<ScanOrderBrief | null>(null);
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [conflict, setConflict] = useState<OverScanConflict | null>(null);
  const [stray, setStray] = useState<{ assetName: string; barcode: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);
  const heldCode = useRef("");

  useEffect(() => {
    void scanOrderQueue().then(setQueue);
  }, []);

  // Search is a server round trip per keystroke otherwise; two characters is
  // the floor the action itself enforces. Clearing happens inside the timer
  // too, so nothing sets state straight out of the effect body.
  useEffect(() => {
    const term = search.trim();
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setResults(null);
        return;
      }
      void scanOrderSearch(term).then(setResults);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  const refreshBrief = useCallback(async (id: string) => {
    const next = await scanOrderBrief(id);
    if (next) setBrief(next);
  }, []);

  async function pick(id: string) {
    setBusy(true);
    const next = await scanOrderBrief(id);
    setBusy(false);
    if (!next) {
      setNotice({ tone: "error", message: "That order could not be opened." });
      return;
    }
    setBrief(next);
    setStep("confirm");
  }

  function log(code: string) {
    const key = `out-${seq.current++}`;
    setEntries((current) =>
      [{ key, code, state: "pending" as const }, ...current].slice(0, LOG_CAP),
    );
    setPending((count) => count + 1);
    return key;
  }

  function settle(key: string, tone: Tone, message: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key
          ? { ...entry, state: "done" as const, tone, message }
          : entry,
      ),
    );
    setPending((count) => Math.max(0, count - 1));
    return tone;
  }

  const commit = useCallback(
    async (code: string): Promise<Tone> => {
      if (!brief) return "error";
      const key = log(code);

      // allowNewAssetLine: false is what makes this surface safe for bulk work.
      const outcome = await scanUnitOut(brief.id, code, undefined, {
        allowNewAssetLine: false,
      });

      if (outcome.status === "conflict") {
        heldCode.current = code;
        setConflict(outcome.conflict);
        return settle(key, "warn", "Waiting on an answer — see above.");
      }
      if (outcome.status === "not-on-order") {
        heldCode.current = code;
        setStray({ assetName: outcome.assetName, barcode: outcome.barcode });
        return settle(key, "warn", `${outcome.assetName} is not on this order.`);
      }
      if (outcome.status === "error") {
        return settle(key, "error", outcome.message);
      }

      void refreshBrief(brief.id);
      return settle(key, "ok", outcome.message);
    },
    [brief, refreshBrief],
  );

  async function resolve(resolution: OverScanResolution) {
    if (!brief) return;
    setBusy(true);
    const outcome = await scanUnitOut(brief.id, heldCode.current, resolution, {
      allowNewAssetLine: false,
    });
    setBusy(false);
    setConflict(null);
    const key = log(heldCode.current);
    if (outcome.status === "ok") {
      void refreshBrief(brief.id);
      settle(key, "ok", outcome.message);
    } else {
      settle(
        key,
        "error",
        outcome.status === "error" ? outcome.message : "Not checked out.",
      );
    }
  }

  async function move(kind: "ship" | "activate" | "complete") {
    if (!brief) return;
    setBusy(true);
    const outcome =
      kind === "ship"
        ? // No notify address from here: emailing the client is a decision with
          // a recipient on it and belongs on the order record, where you can see
          // who it goes to. The stage move itself is the same either way.
          await shipOrder(brief.id, {})
        : kind === "activate"
          ? await activateOrder(brief.id)
          : await completeOrder(brief.id);
    setBusy(false);
    setNotice({
      tone: outcome.status === "ok" ? "ok" : "error",
      message: outcome.message,
    });
    if (outcome.status === "ok") void refreshBrief(brief.id);
  }

  if (step === "pick") {
    const rows = results ?? queue;
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div>
          <h2 className="text-card-title">Which order?</h2>
          <p className="text-detail text-ink-muted">
            {results
              ? `${rows.length} matching open ${rows.length === 1 ? "order" : "orders"}`
              : "Due out by now, with units still to pull"}
          </p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by order number, client or project"
          className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
        />

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-detail text-ink-muted">
              {results
                ? "No open order matches that."
                : "Nothing is due out with units still to pull."}
            </p>
          ) : (
            <ul className="flex flex-col gap-[2px]">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pick(row.id)}
                    className="flex w-full items-center gap-3 rounded-row px-2 py-2 text-left transition-colors hover:bg-row-hover disabled:opacity-60"
                  >
                    <span className="w-[132px] flex-none truncate text-detail font-bold tabular-nums">
                      {row.number}
                    </span>
                    <span className="flex-1 truncate text-detail">
                      {row.clientName}
                      {row.projectName ? (
                        <span className="text-ink-faint"> · {row.projectName}</span>
                      ) : null}
                    </span>
                    <span className="flex-none text-detail text-ink-muted">
                      {row.unitsOutstanding || "—"}
                    </span>
                    {row.daysLate > 0 ? (
                      <span className="flex-none rounded-pill bg-accent-tint px-2 text-micro text-accent-on-tint">
                        {row.daysLate}d late
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  if (!brief) return null;

  if (step === "confirm") {
    return (
      <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div>
          <h2 className="text-card-title">{brief.number}</h2>
          <p className="text-detail text-ink-muted">
            {brief.clientName}
            {brief.projectName ? ` · ${brief.projectName}` : ""}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">Out</span>
            <span className="text-body">{dayMonth(brief.start)}</span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">Back</span>
            <span className="text-body">{dayMonth(brief.end)}</span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">Stage</span>
            <span className="text-body">{STATUS_LABEL[brief.status]}</span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">To scan</span>
            <span className="text-body">
              {brief.outstanding} of {brief.ordered}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setStep("scanning")}
            className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
          >
            Yes — start scanning
          </button>
          <button
            type="button"
            onClick={() => {
              setBrief(null);
              setStep("pick");
            }}
            className="rounded-pill bg-sunken px-4 py-2 text-pill text-ink transition-colors hover:bg-row-hover"
          >
            Choose another
          </button>
          <Link
            href={`/dashboard/orders/${brief.id}`}
            className="self-center text-detail text-accent-text hover:underline"
          >
            Open the order
          </Link>
        </div>
      </section>
    );
  }

  // Only the moves that follow from scanning. Cancelling, revising or losing an
  // order are decisions made looking at its money, not standing at a shelf, and
  // they stay on the record.
  const moves = movesFor(brief.status, brief.type).filter((spec) =>
    ["ship", "activate", "complete"].includes(spec.move),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-card-title">{brief.number}</h2>
          <span className="text-detail text-ink-muted">{brief.clientName}</span>
          <span className="ml-auto text-detail text-ink-muted">
            {brief.outstanding === 0
              ? "Everything is scanned out"
              : `${brief.outstanding} still to scan`}
          </span>
        </div>

        <ScanField
          onCommit={commit}
          pending={pending}
          blocked={!!conflict || !!stray}
          blockedReason="Answer the question above before scanning again."
          placeholder={`Scan a unit onto ${brief.number}`}
        />

        {conflict ? (
          <OverScanPrompt
            conflict={conflict}
            busy={busy}
            onResolve={resolve}
            onDismiss={() => setConflict(null)}
          />
        ) : null}

        {stray ? (
          <div
            role="alertdialog"
            aria-label="Not on this order"
            className="rounded-bubble bg-accent-tint p-3"
          >
            <p className="text-card-title text-accent-on-tint">
              {stray.assetName} is not on {brief.number}
            </p>
            <p className="mt-1 text-detail text-accent-on-tint">
              Nothing was written. Put it back, or add the line on the order
              first — a rate for something the client never ordered is a
              decision, not a lookup.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStray(null)}
                className="rounded-well bg-panel px-3 py-2 text-detail transition-colors hover:bg-row-hover"
              >
                Put it back
              </button>
              <Link
                href={`/dashboard/orders/${brief.id}`}
                className="rounded-well bg-panel px-3 py-2 text-detail transition-colors hover:bg-row-hover"
              >
                Open the order
              </Link>
            </div>
          </div>
        ) : null}

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="flex flex-wrap items-center gap-2">
          {moves.map((spec) => {
            const held = spec.move === "ship" && brief.outstanding > 0;
            return (
              <button
                key={spec.move}
                type="button"
                disabled={busy || held}
                onClick={() => move(spec.move as "ship" | "activate" | "complete")}
                title={
                  held
                    ? `${brief.outstanding} ${brief.outstanding === 1 ? "unit is" : "units are"} still to scan out`
                    : spec.detail
                }
                className={
                  spec.primary
                    ? "rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid disabled:opacity-40"
                    : "rounded-pill bg-sunken px-4 py-2 text-pill text-ink transition-colors hover:bg-row-hover disabled:opacity-40"
                }
              >
                {spec.label}
              </button>
            );
          })}
          {moves.length === 0 ? (
            <span className="text-detail text-ink-muted">
              Nothing to move — this order is {STATUS_LABEL[brief.status].toLowerCase()}.
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setBrief(null);
              setEntries([]);
              setNotice(null);
              setStep("pick");
            }}
            className="ml-auto text-detail text-ink-muted hover:text-ink"
          >
            Finish this order
          </button>
        </div>
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
