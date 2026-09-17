"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import { Notice } from "@/components/feedback/notice";
import {
  scanReceiveBrief,
  scanReceiveQueue,
  scanSerialInFleet,
  type ReceiveBrief,
  type ReceiveQueueRow,
} from "@/lib/actions/scan-receive";
import { saveReceiveHandoff } from "@/lib/scan/receive-handoff";
import type { Tone } from "@/lib/scan/audio";

/**
 * Scanning a delivery in against a purchase order.
 *
 * The receive screen's scan box, on the scanner: pick the PO, then scan serials
 * one at a time. Each scan lands on the next unit of the line being worked, and
 * when that line has as many serials as it has outstanding, the next scan moves
 * on to the next line with room — so a pallet sorted by line is scanned without
 * touching the screen.
 *
 * It writes nothing. "Receive" carries the serials to the PO's receive screen,
 * where the model a line becomes, locations and barcodes are set and the receipt
 * is written — one write path, with its checks and the approval gate, rather
 * than a second one here. Blank barcodes are generated on receipt, and the units
 * are labelled from there.
 *
 * Two refusals happen on the scan rather than at the end, while the box is still
 * in the person's hands: a serial already scanned this session (ignoring case —
 * scanners and labels disagree about it more often than serials do), and a
 * serial already on a unit in the fleet, which the receipt would refuse anyway.
 *
 * The scanned serials live in refs as well as state. `ScanField` drains its
 * queue one commit at a time and each commit awaits the fleet check, so a
 * closure over state would place two fast scans on the same slot.
 */

const LOG_CAP = 200;

type Step = "pick" | "scanning";
type Scan = { lineId: string; serial: string };

function dayMonth(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ReceiveMode() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [queue, setQueue] = useState<ReceiveQueueRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ReceiveQueueRow[] | null>(null);
  const [brief, setBrief] = useState<ReceiveBrief | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);
  const scansRef = useRef<Scan[]>([]);
  const activeRef = useRef<string | null>(null);

  useEffect(() => {
    void scanReceiveQueue().then(setQueue);
  }, []);

  useEffect(() => {
    const term = search.trim();
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setResults(null);
        return;
      }
      void scanReceiveQueue(term).then(setResults);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  function setScansBoth(next: Scan[]) {
    scansRef.current = next;
    setScans(next);
  }

  function setActiveBoth(id: string | null) {
    activeRef.current = id;
    setActiveLine(id);
  }

  async function pick(id: string) {
    setBusy(true);
    const next = await scanReceiveBrief(id);
    setBusy(false);
    if (next && "refusal" in next) {
      setNotice({ tone: "error", message: next.refusal });
      return;
    }
    if (!next || next.lines.length === 0) {
      setNotice({
        tone: "error",
        message: next
          ? `${next.poNumber} has nothing outstanding to scan — receive it from the PO.`
          : "That purchase order could not be opened for receiving.",
      });
      return;
    }
    setNotice(null);
    setBrief(next);
    setScansBoth([]);
    setEntries([]);
    setActiveBoth(next.lines[0].id);
    setStep("scanning");
  }

  function settle(key: string, tone: Tone, message: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.key === key ? { ...entry, state: "done" as const, tone, message } : entry,
      ),
    );
    setPending((count) => Math.max(0, count - 1));
    return tone;
  }

  const commit = useCallback(
    async (raw: string): Promise<Tone> => {
      if (!brief) return "error";
      const serial = raw.trim();
      const key = `in-${seq.current++}`;
      setEntries((current) =>
        [{ key, code: serial, state: "pending" as const }, ...current].slice(0, LOG_CAP),
      );
      setPending((count) => count + 1);

      const needle = serial.toLowerCase();
      const earlier = scansRef.current.find((scan) => scan.serial.toLowerCase() === needle);
      if (earlier) {
        const line = brief.lines.find((l) => l.id === earlier.lineId);
        return settle(key, "error", `Already scanned this session${line ? ` on ${line.description}` : ""}.`);
      }

      const inFleet = await scanSerialInFleet(serial);
      if (inFleet) {
        return settle(
          key,
          "error",
          `Already in the fleet — ${inFleet.assetName}, barcode ${inFleet.barcode}. Set this box aside.`,
        );
      }

      // Re-check after the await: another scan may have landed meanwhile.
      if (scansRef.current.some((scan) => scan.serial.toLowerCase() === needle)) {
        return settle(key, "error", "Already scanned this session.");
      }

      const count = (lineId: string) =>
        scansRef.current.filter((scan) => scan.lineId === lineId).length;
      const start = Math.max(
        0,
        brief.lines.findIndex((line) => line.id === activeRef.current),
      );
      const ordered = [...brief.lines.slice(start), ...brief.lines.slice(0, start)];
      const target = ordered.find((line) => count(line.id) < line.remaining);
      if (!target) {
        return settle(key, "error", `Everything outstanding on ${brief.poNumber} is scanned — that one was not recorded.`);
      }

      const moved = target.id !== activeRef.current;
      setActiveBoth(target.id);
      setScansBoth([...scansRef.current, { lineId: target.id, serial }]);
      const n = count(target.id);
      return settle(
        key,
        "ok",
        `${moved ? "Next line — " : ""}${target.description} · ${n} of ${target.remaining}`,
      );
    },
    [brief],
  );

  function undo() {
    const last = scansRef.current.at(-1);
    if (!last) return;
    setScansBoth(scansRef.current.slice(0, -1));
    setActiveBoth(last.lineId);
    setNotice({ tone: "ok", message: `Took back ${last.serial}.` });
  }

  function handOff() {
    if (!brief || scans.length === 0) return;
    const lines: Record<string, string[]> = {};
    for (const scan of scans) (lines[scan.lineId] ??= []).push(scan.serial);
    if (!saveReceiveHandoff(brief.id, lines)) {
      setNotice({
        tone: "error",
        message:
          "This browser would not hold the scans for the receive screen (private window or blocked site data). Scan them on the receive screen instead.",
      });
      return;
    }
    router.push(`/dashboard/purchase-orders/${brief.id}/receive`);
  }

  if (step === "pick" || !brief) {
    const rows = results ?? queue ?? [];
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div>
          <h2 className="text-card-title">Which purchase order?</h2>
          <p className="text-detail text-ink-muted">
            {results
              ? `${rows.length} matching ${rows.length === 1 ? "PO" : "POs"} with units still to come`
              : "Submitted or part-received, cleared to receive, with units or serials still to come — earliest expected first"}
          </p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by PO number or vendor"
          className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
        />

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {queue === null && !results ? (
            <p className="py-6 text-detail text-ink-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-detail text-ink-muted">
              {results ? (
                "No open purchase order matches that."
              ) : (
                <>
                  Nothing is cleared and waiting to be received — a PO held for approval
                  appears here once it is approved.{" "}
                  <Link href="/dashboard/purchase-orders" className="text-accent-text hover:underline">
                    Purchase orders
                  </Link>{" "}
                  — a PO has to be submitted before hardware can come in against it.
                </>
              )}
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
                      {row.poNumber}
                    </span>
                    <span className="flex-1 truncate text-detail">
                      {row.vendorName}
                      {row.expectedDate ? (
                        <span className="text-ink-faint"> · expected {dayMonth(row.expectedDate)}</span>
                      ) : null}
                    </span>
                    <span className="flex-none text-detail tabular-nums text-ink-muted">
                      {row.scannable} to come
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

  const total = brief.lines.reduce((sum, line) => sum + line.remaining, 0);

  return (
    <>
      <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-card-title">Receiving {brief.poNumber}</h2>
            <p className="text-detail text-ink-muted">
              {brief.vendorName} · {scans.length} of {total} scanned
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setStep("pick");
              setBrief(null);
              setScansBoth([]);
              setEntries([]);
              setNotice(null);
            }}
            className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
          >
            Change PO
          </button>
        </div>

        <ul className="flex flex-col gap-[2px]" aria-label="Lines on this purchase order">
          {brief.lines.map((line) => {
            const done = scans.filter((scan) => scan.lineId === line.id).length;
            const active = line.id === activeLine;
            return (
              <li key={line.id}>
                <button
                  type="button"
                  onClick={() => setActiveBoth(line.id)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-row px-2 py-2 text-left transition-colors ${
                    active ? "bg-accent-tint text-accent-on-tint" : "hover:bg-row-hover"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-detail">
                    {line.description}
                    <span className={active ? "" : "text-ink-faint"}>
                      {" · "}
                      {line.mode === "serials"
                        ? "resale, serials only"
                        : line.assetName ?? "no model yet — set on receipt"}
                    </span>
                  </span>
                  <span className="flex-none text-detail tabular-nums">
                    {done} of {line.remaining}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {brief.uncounted > 0 ? (
          <p className="text-detail text-ink-muted">
            {brief.uncounted} consumable {brief.uncounted === 1 ? "line has" : "lines have"} nothing
            to scan — count {brief.uncounted === 1 ? "it" : "them"} on the receive screen.
          </p>
        ) : null}

        <ScanField
          onCommit={commit}
          placeholder="Scan a serial"
          pending={pending}
        />

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scans.length === 0 || pending > 0}
            onClick={handOff}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {scans.length === 0
              ? "Receive"
              : `Receive ${scans.length} scanned`}
          </button>
          <button
            type="button"
            disabled={scans.length === 0}
            onClick={undo}
            className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
          >
            Undo last scan
          </button>
          <span className="text-detail text-ink-muted">
            Receive opens the PO&apos;s receive screen with these serials filled in — set the
            model, location and barcodes there.
          </span>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
        <div className="px-4 pb-2">
          <h2 className="text-card-title">This session</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ScanLog entries={entries} />
        </div>
      </section>
    </>
  );
}
