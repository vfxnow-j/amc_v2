"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QcResult, WorkOrderStatus } from "@/generated/prisma/client";
import { recordTestRun, setWorkOrderStatus } from "@/lib/actions/service";
import { Notice } from "@/components/feedback/notice";

const MOVES: { status: WorkOrderStatus; label: string; detail: string }[] = [
  { status: "IN_TEST", label: "On the bench", detail: "Being tested now" },
  { status: "AWAITING_PARTS", label: "Awaiting parts", detail: "Blocked on a part" },
  { status: "RMA", label: "Sent for RMA", detail: "With the vendor" },
];

const CLOSERS: { status: WorkOrderStatus; label: string; detail: string }[] = [
  {
    status: "CLOSED_PASS",
    label: "Close — passed",
    detail: "Unit returns to available stock",
  },
  {
    status: "CLOSED_SCRAP",
    label: "Close — scrapped",
    detail: "Unit is retired and leaves the fleet",
  },
];

const RESULTS: QcResult[] = ["PASS", "FAIL", "RUNNING", "QUEUED"];

/**
 * The bench's controls: move the work order along, file a test run, close it.
 *
 * Closing is separated from the other moves and states its consequence, because
 * the two closers send the unit to opposite places — back into stock, or out of
 * the fleet for good.
 */
export function WorkOrderActions({
  workOrderId,
  status,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [testName, setTestName] = useState("");
  const [result, setResult] = useState<QcResult>("PASS");
  const [output, setOutput] = useState("");

  const closed = status === "CLOSED_PASS" || status === "CLOSED_SCRAP";

  function move(next: WorkOrderStatus) {
    setError("");
    startTransition(async () => {
      const outcome = await setWorkOrderStatus(workOrderId, next);
      if (outcome.status === "error") setError(outcome.message);
      else router.refresh();
    });
  }

  function file(event: React.FormEvent) {
    event.preventDefault();
    if (!testName.trim()) return;
    setError("");
    startTransition(async () => {
      const outcome = await recordTestRun({
        workOrderId,
        testName,
        result,
        output: output || undefined,
      });
      if (outcome.status === "error") setError(outcome.message);
      else {
        setTestName("");
        setOutput("");
        router.refresh();
      }
    });
  }

  if (closed) {
    return (
      <p className="px-4 pb-4 text-body text-ink-muted">
        This work order is closed. If the fault came back, raise a new one — the
        history stays on the unit either way.
      </p>
    );
  }

  return (
    <div className="px-4 pb-4">
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}

      <form onSubmit={file} className="mb-4">
        <p className="mb-[6px] text-micro uppercase text-ink-muted">
          File a test run
        </p>
        <div className="flex gap-2">
          <input
            value={testName}
            onChange={(event) => setTestName(event.target.value)}
            placeholder="Test name — e.g. memtest86 · 2 passes"
            aria-label="Test name"
            className="h-9 min-w-0 flex-1 rounded-well border-0 bg-sunken px-3 text-detail outline-none placeholder:text-ink-faint"
          />
          <select
            value={result}
            onChange={(event) => setResult(event.target.value as QcResult)}
            aria-label="Result"
            className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
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
          value={output}
          onChange={(event) => setOutput(event.target.value)}
          placeholder="What it said — optional"
          aria-label="Output"
          className="mt-2 h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail outline-none placeholder:text-ink-faint"
        />
      </form>

      <p className="mb-[6px] text-micro uppercase text-ink-muted">Move it on</p>
      <div className="flex flex-wrap gap-2">
        {MOVES.filter((move) => move.status !== status).map((option) => (
          <button
            key={option.status}
            type="button"
            disabled={busy}
            onClick={() => move(option.status)}
            title={option.detail}
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="mt-4 mb-[6px] text-micro uppercase text-ink-muted">
        Close it
      </p>
      <div className="flex flex-col gap-2">
        {CLOSERS.map((option) => (
          <button
            key={option.status}
            type="button"
            disabled={busy}
            onClick={() => move(option.status)}
            className="rounded-well bg-sunken px-3 py-2 text-left hover:bg-row-hover disabled:opacity-50"
          >
            <span className="block text-body font-bold">{option.label}</span>
            <span className="block text-detail text-ink-muted">
              {option.detail}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
