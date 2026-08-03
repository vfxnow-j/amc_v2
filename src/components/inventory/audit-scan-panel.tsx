"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import {
  completeInventoryAudit,
  verifyAuditItemByBarcode,
} from "@/lib/actions/inventory-audits";

type Entry = { id: number; tone: "ok" | "warn" | "error"; message: string };

/**
 * The scan session. The build plan's "scan session UI", built on the ported
 * `verifyAuditItemByBarcode`.
 *
 * The well keeps focus because the barcode gun types and presses Enter, the same
 * as the order's check-out panel. This one is safer than that one by design: the
 * action mutates audit tables only, never a unit, a checkout or an order — so
 * counting the shelf can never change what a client was promised. A scan of
 * something outside the scope is captured and flagged rather than refused,
 * because "this was here and shouldn't be" is the finding the count exists to
 * produce.
 *
 * `verifyAuditItemByBarcode` doesn't call `revalidatePath`, so the panel
 * refreshes the route itself after a scan that changed something — otherwise the
 * item table beside it would sit stale while the log filled up.
 */
export function AuditScanPanel({
  auditId,
  pending,
}: {
  auditId: string;
  pending: number;
}) {
  const [barcode, setBarcode] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const router = useRouter();

  function record(tone: Entry["tone"], message: string) {
    setLog((entries) =>
      [{ id: nextId.current++, tone, message }, ...entries].slice(0, 8),
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const scanned = barcode.trim();
    if (!scanned || busy) return;
    setBarcode("");
    startTransition(async () => {
      const result = await verifyAuditItemByBarcode(auditId, scanned);
      if (!result.success) {
        record("error", "error" in result ? result.error : "Scan refused");
      } else if (result.warning) {
        record("warn", result.warning);
        router.refresh();
      } else {
        record("ok", `${scanned} verified`);
        router.refresh();
      }
      inputRef.current?.focus();
    });
  }

  function close() {
    setConfirmClose(false);
    startTransition(async () => {
      try {
        await completeInventoryAudit(auditId);
        router.refresh();
      } catch (error) {
        record(
          "error",
          error instanceof Error ? error.message : "Could not close the audit",
        );
      }
    });
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Count</h2>
        <span className="text-detail text-ink-muted">
          Scan what is in front of you
        </span>
      </header>

      <form onSubmit={submit} className="px-4">
        <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
          <ScanLine className="size-4 flex-none text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            // The gun types straight into whatever has focus.
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan or type a barcode"
            aria-label="Unit barcode"
            className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
          />
          {busy ? (
            <span className="flex-none text-detail text-ink-faint">
              Working…
            </span>
          ) : null}
        </label>
      </form>

      {log.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-px px-2">
          {log.map((entry) => (
            <li
              key={entry.id}
              className={`rounded-row px-2 py-[5px] text-detail ${
                entry.tone === "ok"
                  ? "text-ink-muted"
                  : entry.tone === "warn"
                    ? "text-accent-text"
                    : "text-destructive"
              }`}
            >
              {entry.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-3 text-detail text-balance text-ink-muted">
          Nothing scanned yet. Anything outside this audit&rsquo;s scope is
          captured and flagged rather than rejected — that is the finding, not an
          error. Nothing here touches a unit, a check-out or an order.
        </p>
      )}

      {confirmClose ? (
        <div
          role="alertdialog"
          aria-label="Close this audit"
          className="mx-4 mt-3 mb-4 rounded-bubble bg-accent-tint p-3"
        >
          <p className="text-card-title text-accent-on-tint">
            Close the count with {pending} un-scanned?
          </p>
          <p className="mt-1 text-detail text-accent-on-tint">
            {/* completeInventoryAudit rewrites every PENDING item to MISSING.
                That is a finding about real hardware, so it is stated before it
                happens rather than reported after. */}
            Closing marks {pending === 1 ? "it" : "all of them"} missing. That is
            a claim that {pending === 1 ? "one unit is" : `${pending} units are`}{" "}
            not where the record says — it is not a way to tidy the list up.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="rounded-well bg-panel px-3 py-2 text-left text-body font-bold transition-colors hover:bg-row-hover disabled:opacity-60"
            >
              Close it — they really are missing
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmClose(false);
                inputRef.current?.focus();
              }}
              className="rounded-well bg-panel px-3 py-2 text-left text-body transition-colors hover:bg-row-hover disabled:opacity-60"
            >
              Keep counting
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 pt-3 pb-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmClose(true)}
            className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover disabled:opacity-60"
          >
            Close the count
          </button>
          <span className="text-detail text-ink-muted">
            {pending === 0
              ? "Everything in scope has been scanned"
              : `${pending} still to scan`}
          </span>
        </div>
      )}
    </section>
  );
}
