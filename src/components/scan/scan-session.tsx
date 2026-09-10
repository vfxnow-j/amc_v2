"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckoutMode } from "@/components/scan/checkout-mode";
import { ReturnMode } from "@/components/scan/return-mode";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import type { Tone } from "@/lib/scan/audio";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import type { AssetStatus } from "@/generated/prisma/client";

/**
 * One scanning session.
 *
 * Client state rather than a route or `FilterTabs`, because a session is
 * genuinely long-lived: a person opens this, scans for ten minutes, and a link
 * navigation part-way through would remount the surface and throw away the
 * receipt — and, once writes land, whatever is still in the queue.
 *
 * Three modes so far. **Check asset** identifies a unit and writes nothing — the
 * behaviour the retired Mobile scan screen had, rebuilt on the queueing field.
 * **Check out** scans units onto one order, picked and confirmed first.
 * **Return** goes the other way and needs no order at all: the first item
 * scanned says which job it belongs to. Scan lists follow; the picker shows
 * only what exists, because a disabled tab promising a feature is worse than an
 * honest short list.
 *
 * Switching mode is client state, not a link. `FilterTabs` navigates, and a
 * navigation part-way through a session would remount the surface and throw
 * away both the receipt and whatever is still in the queue.
 */

type Unit = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  status: AssetStatus;
  condition: string | null;
  assetName: string;
  maker: string | null;
  locationName: string | null;
  holder: string | null;
  orderId: string | null;
  orderNumber: string | null;
  dueBack: string | null;
  workOrder: { id: string; number: string; fault: string } | null;
};

const LOG_CAP = 200;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-body">{children}</span>
    </div>
  );
}

function CheckAssetMode({ initialCode }: { initialCode?: string }) {
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [pending, setPending] = useState(0);
  const seq = useRef(0);
  // Last-scan-wins: a fast operator gets the card for the code they just
  // scanned, not a backlog of stale ones resolving in the order they were sent.
  const inFlight = useRef<AbortController | null>(null);

  const commit = useCallback(async (code: string): Promise<Tone> => {
    const key = `scan-${seq.current++}`;
    setEntries((current) =>
      [{ key, code, state: "pending" as const }, ...current].slice(0, LOG_CAP),
    );
    setPending((count) => count + 1);

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    function settle(tone: Tone, message: string, href?: string) {
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

    try {
      const response = await fetch(
        `/api/scan/lookup?code=${encodeURIComponent(code)}`,
        { signal: controller.signal, cache: "no-store" },
      );

      if (response.status === 401) {
        return settle("error", "Signed out — reload and sign in again.");
      }
      if (!response.ok) {
        return settle("error", "The lookup failed. Scan it again.");
      }

      const body = (await response.json()) as { unit: Unit | null };
      if (!body.unit) {
        setUnit(null);
        return settle("warn", "No unit carries that barcode or serial.");
      }

      setUnit(body.unit);
      return settle(
        "ok",
        `${body.unit.assetName} · ${UNIT_STATUS_LABEL[body.unit.status]}`,
        `/dashboard/units/${body.unit.id}`,
      );
    } catch (cause) {
      // An abort is this code being superseded by a newer scan, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setEntries((current) => current.filter((entry) => entry.key !== key));
        setPending((count) => Math.max(0, count - 1));
        return "ok";
      }
      return settle("error", "No answer from the server — check the network.");
    }
  }, []);

  // The retired screen answered ?code= inline, and links to it exist. Scanning
  // it once on mount keeps those working without the page needing to know
  // anything about lookups. Ref-guarded because StrictMode mounts twice in dev
  // and a double lookup would put the same code in the log twice.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initialCode) return;
    seeded.current = true;
    void commit(initialCode);
  }, [initialCode, commit]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="rounded-card bg-panel p-4 shadow-sm">
        <ScanField onCommit={commit} pending={pending} />
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-card bg-panel p-4 shadow-sm">
          {unit ? (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-card-title">{unit.assetName}</h2>
                <p className="text-detail text-ink-muted">
                  {unit.maker ? `${unit.maker} · ` : ""}
                  {unit.barcode}
                  {unit.serialNumber ? ` · ${unit.serialNumber}` : ""}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">{UNIT_STATUS_LABEL[unit.status]}</Field>
                <Field label="Where">
                  {unit.locationName ?? <span className="text-ink-faint">—</span>}
                </Field>
                <Field label="With">
                  {unit.holder ?? <span className="text-ink-faint">On the shelf</span>}
                </Field>
                <Field label="Due back">
                  {unit.dueBack ? (
                    new Date(unit.dueBack).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Field>
              </div>

              {unit.workOrder ? (
                <p className="rounded-well bg-accent-tint p-3 text-detail text-accent-on-tint">
                  Open work order {unit.workOrder.number} — {unit.workOrder.fault}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/units/${unit.id}`}
                  className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
                >
                  Open the unit
                </Link>
                {unit.orderId ? (
                  <Link
                    href={`/dashboard/orders/${unit.orderId}`}
                    className="rounded-pill bg-sunken px-4 py-2 text-pill text-ink transition-colors hover:bg-row-hover"
                  >
                    Its order · {unit.orderNumber}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="max-w-sm text-body text-balance text-ink-muted">
              Point a scanner at any unit barcode, or type a serial number. This
              tells you what it is, whose it is and when it&rsquo;s due back —
              and keeps a list of everything scanned this session.
            </p>
          )}
        </section>

        <section className="flex min-h-0 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
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
    </div>
  );
}

const MODES = [
  { id: "check", label: "Check asset", blurb: "What is it, whose is it, when is it due back" },
  { id: "out", label: "Check out", blurb: "Scan units onto an order" },
  { id: "in", label: "Return", blurb: "Scan kit back — the first item finds the order" },
] as const;

type Mode = (typeof MODES)[number]["id"];

export function ScanSession({ initialCode }: { initialCode?: string }) {
  // A deep link carries a code, and a code is a lookup — so a ?code= link opens
  // on the mode that answers it.
  const [mode, setMode] = useState<Mode>("check");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <nav
        aria-label="Scan modes"
        className="flex flex-wrap items-center gap-1 self-start rounded-pill bg-segmented-track p-1"
      >
        {MODES.map((option) => {
          const active = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-current={active ? "true" : undefined}
              title={option.blurb}
              className={`rounded-pill px-3 py-1 text-pill transition-colors duration-[160ms] ${
                active
                  ? "bg-segmented-thumb font-bold text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </nav>

      {/* Both are mounted-on-demand rather than hidden: an unmounted mode
          cannot hold a stale order, and a mode that is not on screen must not
          be listening for scans. */}
      {mode === "check" ? (
        <CheckAssetMode initialCode={initialCode} />
      ) : mode === "out" ? (
        <CheckoutMode />
      ) : (
        <ReturnMode />
      )}
    </div>
  );
}
