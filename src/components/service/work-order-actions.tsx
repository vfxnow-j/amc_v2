"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QcResult, WorkOrderStatus } from "@/generated/prisma/client";
import {
  flagRma,
  recordTestRun,
  rmaReturned,
  saveWorkOrderNotes,
  setWorkOrderStatus,
} from "@/lib/actions/service";
import { Notice } from "@/components/feedback/notice";

const MOVES: { status: WorkOrderStatus; label: string; detail: string }[] = [
  { status: "IN_TEST", label: "On the bench", detail: "Being evaluated and tested now" },
  { status: "AWAITING_PARTS", label: "Awaiting parts", detail: "Blocked on a part" },
];

const RESULTS: QcResult[] = ["PASS", "FAIL", "RUNNING", "QUEUED"];

const FIELD =
  "h-9 rounded-well border border-hairline bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The bench: evaluate, test, then decide.
 *
 * A unit arrives here because it hit service (a work order is raised for every
 * unit in MAINTENANCE). The tech notes what they find, files test runs, can send
 * it out for RMA when someone else is on the hook, and ends it one of three ways
 * — each stated with where the unit goes, because they send it to very
 * different places:
 *
 * - **Release to inventory** — qualified; back to available stock. Needs a
 *   passing test on file.
 * - **Part it out** — stripped for usable parts, then retired.
 * - **Retire** — damaged beyond use; leaves the fleet.
 */
export function WorkOrderActions({
  workOrderId,
  status,
  notes,
  passedTests,
  rma,
  suggestedProvider,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  notes: string | null;
  /** Passing test runs on file — release needs at least one. */
  passedTests: number;
  rma: { provider: string | null; number: string | null; sentAt: string | null; returnedAt: string | null };
  /** From the unit's active coverage, to prefill an RMA. */
  suggestedProvider: string | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [testName, setTestName] = useState("");
  const [result, setResult] = useState<QcResult>("PASS");
  const [output, setOutput] = useState("");
  const [rmaOpen, setRmaOpen] = useState(false);
  const [provider, setProvider] = useState(suggestedProvider ?? "");
  const [rmaNumber, setRmaNumber] = useState("");
  const [closing, setClosing] = useState<null | "CLOSED_PARTED" | "CLOSED_SCRAP">(null);
  const [closingNote, setClosingNote] = useState("");

  const closed = status === "CLOSED_PASS" || status === "CLOSED_SCRAP" || status === "CLOSED_PARTED";

  function run(action: () => Promise<{ status: string; message?: string; number?: string }>, ok: string) {
    setMessage(null);
    startTransition(async () => {
      const outcome = await action();
      if (outcome.status === "error") setMessage({ tone: "error", text: outcome.message ?? "That didn't work." });
      else {
        setMessage({ tone: "ok", text: outcome.message ?? ok });
        router.refresh();
      }
    });
  }

  if (closed) {
    return (
      <div className="px-4 pb-4">
        <p className="text-body text-ink-muted">
          This work order is closed. If the fault came back, raise a new one — the history stays on the unit either way.
        </p>
        {notes ? (
          <p className="mt-2 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">{notes}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {/* Evaluation */}
      <div>
        <label htmlFor="wo-notes" className="mb-[6px] block text-micro uppercase text-ink-muted">
          Evaluation notes
        </label>
        <textarea
          id="wo-notes"
          value={draftNotes}
          onChange={(event) => setDraftNotes(event.target.value)}
          rows={4}
          placeholder="What you found, what you did, what it still needs."
          className="w-full resize-y rounded-well border border-hairline bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          disabled={busy || draftNotes.trim() === (notes ?? "").trim()}
          onClick={() => run(() => saveWorkOrderNotes(workOrderId, draftNotes), "Notes saved.")}
          className="mt-1 h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
        >
          Save notes
        </button>
      </div>

      {/* Tests */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!testName.trim()) return;
          run(async () => {
            const outcome = await recordTestRun({ workOrderId, testName, result, output: output || undefined });
            if (outcome.status === "ok") {
              setTestName("");
              setOutput("");
              return { status: "ok", message: `Test filed: ${result.toLowerCase()}.` };
            }
            return outcome;
          }, "Test filed.");
        }}
      >
        <p className="mb-[6px] text-micro uppercase text-ink-muted">File a test</p>
        <div className="flex gap-2">
          <input
            id="wo-test-name"
            value={testName}
            onChange={(event) => setTestName(event.target.value)}
            placeholder="e.g. memtest86 · 2 passes"
            aria-label="Test name"
            className={`${FIELD} min-w-0 flex-1`}
          />
          <select
            id="wo-test-result"
            value={result}
            onChange={(event) => setResult(event.target.value as QcResult)}
            aria-label="Result"
            className={FIELD}
          >
            {RESULTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !testName.trim()}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            File
          </button>
        </div>
        <input
          id="wo-test-output"
          value={output}
          onChange={(event) => setOutput(event.target.value)}
          placeholder="What it said — optional"
          aria-label="Output"
          className={`${FIELD} mt-2 w-full`}
        />
      </form>

      {/* Where it is */}
      <div>
        <p className="mb-[6px] text-micro uppercase text-ink-muted">Status</p>
        <div className="flex flex-wrap gap-2">
          {MOVES.filter((move) => move.status !== status).map((option) => (
            <button
              key={option.status}
              type="button"
              disabled={busy || status === "RMA"}
              onClick={() => run(() => setWorkOrderStatus(workOrderId, option.status), option.detail)}
              title={option.detail}
              className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* RMA */}
      <div className="rounded-well border border-hairline p-3">
        <p className="mb-1 text-micro uppercase text-ink-muted">RMA</p>
        {status === "RMA" ? (
          <>
            <p className="text-detail">
              Out with <span className="font-bold">{rma.provider}</span>
              {rma.number ? ` · RMA ${rma.number}` : ""}
              {rma.sentAt ? ` · since ${new Date(rma.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRmaOpen(false);
                run(() => rmaReturned(workOrderId), "Back from RMA.");
              }}
              className="mt-2 h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
            >
              Back from RMA — re-test it
            </button>
          </>
        ) : rmaOpen ? (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                id="wo-rma-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="Provider — e.g. Apple, Lenovo"
                aria-label="RMA provider"
                className={FIELD}
              />
              <input
                id="wo-rma-number"
                value={rmaNumber}
                onChange={(event) => setRmaNumber(event.target.value)}
                placeholder="RMA / case number (optional)"
                aria-label="RMA number"
                className={FIELD}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !provider.trim()}
                onClick={() => {
                  setRmaOpen(false);
                  run(() => flagRma(workOrderId, { provider, rmaNumber }), "Sent for RMA.");
                }}
                className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
              >
                Send for RMA
              </button>
              <button type="button" onClick={() => setRmaOpen(false)} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-detail text-ink-muted">
              {rma.returnedAt
                ? `Back from ${rma.provider ?? "RMA"} ${new Date(rma.returnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
                : suggestedProvider
                  ? `Covered by ${suggestedProvider} — flag it if the fault is theirs to fix.`
                  : "Flag it when the maker or warrantor is on the hook."}
            </p>
            <button
              type="button"
              onClick={() => setRmaOpen(true)}
              className="mt-2 h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
            >
              Flag for RMA
            </button>
          </>
        )}
      </div>

      {/* Decide */}
      <div>
        <p className="mb-[6px] text-micro uppercase text-ink-muted">Decide</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || status === "RMA" || passedTests === 0}
            onClick={() => run(() => setWorkOrderStatus(workOrderId, "CLOSED_PASS", draftNotes || undefined), "Released to inventory.")}
            className="rounded-well bg-sunken px-3 py-2 text-left hover:bg-row-hover disabled:opacity-50"
          >
            <span className="block text-body font-bold">Release to inventory</span>
            <span className="block text-detail text-ink-muted">
              {passedTests > 0
                ? "Qualified — back to available stock."
                : "File a passing test first — a unit goes back into stock qualified."}
            </span>
          </button>

          {(["CLOSED_PARTED", "CLOSED_SCRAP"] as const).map((outcome) => (
            <div key={outcome} className="rounded-well bg-sunken">
              <button
                type="button"
                disabled={busy || status === "RMA"}
                onClick={() => setClosing(closing === outcome ? null : outcome)}
                className="w-full px-3 py-2 text-left hover:bg-row-hover disabled:opacity-50"
              >
                <span className="block text-body font-bold">
                  {outcome === "CLOSED_PARTED" ? "Part it out" : "Retire"}
                </span>
                <span className="block text-detail text-ink-muted">
                  {outcome === "CLOSED_PARTED"
                    ? "Strip usable parts, then retire the machine."
                    : "Damaged beyond use — the unit leaves the fleet."}
                </span>
              </button>
              {closing === outcome ? (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  <textarea
                    id={`wo-close-${outcome}`}
                    value={closingNote}
                    onChange={(event) => setClosingNote(event.target.value)}
                    rows={2}
                    placeholder={
                      outcome === "CLOSED_PARTED"
                        ? "Parts kept — e.g. 2× 32GB DDR4, RTX 3090, 1TB NVMe"
                        : "Why it's being retired"
                    }
                    className="w-full rounded-well border border-hairline bg-panel px-3 py-2 text-detail outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !closingNote.trim()}
                    onClick={() =>
                      run(
                        () =>
                          setWorkOrderStatus(
                            workOrderId,
                            outcome,
                            [draftNotes.trim(), `${outcome === "CLOSED_PARTED" ? "Parted out" : "Retired"}: ${closingNote.trim()}`]
                              .filter(Boolean)
                              .join("\n\n"),
                          ),
                        outcome === "CLOSED_PARTED" ? "Parted out." : "Retired.",
                      )
                    }
                    className="h-8 w-fit rounded-pill bg-destructive px-3 text-pill text-destructive-foreground disabled:opacity-50"
                  >
                    {outcome === "CLOSED_PARTED" ? "Part out and retire" : "Retire the unit"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
