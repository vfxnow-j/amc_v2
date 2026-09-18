"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { CoverageEnrollmentStatus } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import {
  addCoverageEnrollment,
  removeCoverageEnrollment,
  updateCoverageEnrollment,
} from "@/lib/actions/coverage-enrollments";
import { ENROLLMENT_STATUS_LABEL, ENROLLMENT_STATUSES, providerCheckUrl } from "@/lib/coverage/labels";

const FIELD =
  "h-8 rounded-well border border-hairline bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });

/** A Date as the "YYYY-MM-DD" a date input holds; dates are stored at noon UTC. */
const isoDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

export type PlanRow = {
  id: string;
  name: string;
  provider: string | null;
  status: CoverageEnrollmentStatus;
  startDate: Date | null;
  endDate: Date | null;
  agreementNumber: string | null;
  cost: number | null;
  source: string | null;
  notes: string | null;
  checkedAt: Date | null;
  covers: boolean;
  serialNumber: string | null;
  purchaseOrder: { id: string; poNumber: string; vendor: { name: string } } | null;
};

/**
 * The unit's own plans — AppleCare+ bought on its PO, say — each with where it
 * stands. The status is the point: "bought, unconfirmed" until somebody has
 * seen it on the provider's record, and the end date stays unknown until then
 * rather than being worked out from a term the PO never stated.
 */
export function UnitPlans({ unitId, rows }: { unitId: string; rows: PlanRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-2 pb-3">
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-px">
          {rows.map((row) => (
            <PlanItem key={row.id} row={row} />
          ))}
        </ul>
      ) : null}
      {adding ? (
        <AddPlan unitId={unitId} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mx-2 flex w-fit items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          <Plus className="size-[13px]" aria-hidden /> Add a plan
        </button>
      )}
    </div>
  );
}

function PlanItem({ row }: { row: PlanRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [start, setStart] = useState(isoDay(row.startDate));
  const [end, setEnd] = useState(isoDay(row.endDate));
  const [agreement, setAgreement] = useState(row.agreementNumber ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const check = providerCheckUrl(row.provider);

  function save(next: Partial<{ status: CoverageEnrollmentStatus }> = {}) {
    setError("");
    startTransition(async () => {
      const result = await updateCoverageEnrollment(row.id, {
        status: next.status ?? status,
        startDate: start,
        endDate: end,
        agreementNumber: agreement,
        notes,
      });
      if (result.status === "error") setError(result.message);
      else {
        if (!next.status) setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <li className="flex flex-col gap-1 rounded-row px-2 py-[6px] text-detail odd:bg-row-alt">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="min-w-0 truncate">
          <span className="font-bold">{row.name}</span>
          {row.provider ? <span className="text-ink-faint"> · {row.provider}</span> : null}
        </span>
        <select
          aria-label={`${row.name} status`}
          value={status}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value as CoverageEnrollmentStatus;
            setStatus(value);
            save({ status: value });
          }}
          className={`${FIELD} h-7 ${row.status === "PURCHASED" ? "text-accent-text" : row.status === "NOT_ENROLLED" ? "text-destructive" : ""}`}
        >
          {ENROLLMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ENROLLMENT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-ink-muted">
        {row.endDate ? (
          <span className={row.covers ? "" : "text-ink-faint"}>
            {row.covers ? "Runs to " : "Ended "}
            {DAY.format(row.endDate)}
          </span>
        ) : (
          <span>End date unknown</span>
        )}
        {row.purchaseOrder ? (
          <>
            {" · "}
            <Link href={`/dashboard/purchase-orders/${row.purchaseOrder.id}`} className="text-accent-text hover:underline">
              {row.purchaseOrder.poNumber}
            </Link>
            {` · ${row.purchaseOrder.vendor.name}`}
          </>
        ) : null}
        {row.cost !== null ? ` · $${row.cost.toFixed(2)}` : ""}
        {row.checkedAt ? ` · checked ${DAY.format(row.checkedAt)}` : ""}
        {" · "}
        <button type="button" onClick={() => setOpen((value) => !value)} className="text-accent-text hover:underline">
          {open ? "Close" : "Details"}
        </button>
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {open ? (
        <div className="flex flex-col gap-2 pt-1">
          {check ? (
            <p className="text-ink-muted">
              Confirm it on{" "}
              <a href={check} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                Apple&rsquo;s coverage check
              </a>
              {row.serialNumber ? ` with serial ${row.serialNumber}` : " — this unit has no serial on file"}, then set the
              status and the dates it shows.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-ink-muted">
              From
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start date" className={FIELD} />
            </label>
            <label className="flex items-center gap-1 text-ink-muted">
              to
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End date" className={FIELD} />
            </label>
            <input
              value={agreement}
              onChange={(e) => setAgreement(e.target.value)}
              placeholder="Agreement number"
              aria-label="Agreement number"
              className={`${FIELD} w-40`}
            />
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" className={FIELD} />
          {row.source ? <p className="text-ink-faint">Where this came from: {row.source}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save()}
              className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  if (!window.confirm(`Remove ${row.name} from this unit?`)) return;
                  const result = await removeCoverageEnrollment(row.id);
                  if (result.status === "error") setError(result.message);
                  else router.refresh();
                })
              }
              className="ml-auto flex items-center gap-1 text-ink-faint hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden /> Remove
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AddPlan({ unitId, onDone }: { unitId: string; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState<CoverageEnrollmentStatus>("PURCHASED");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function add() {
    setError("");
    startTransition(async () => {
      const result = await addCoverageEnrollment(unitId, { name, provider, status, endDate: end });
      if (result.status === "error") setError(result.message);
      else {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-2">
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AppleCare+" aria-label="Plan" className={`${FIELD} min-w-0 flex-1`} />
        <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider" aria-label="Provider" className={`${FIELD} w-28`} />
        <select value={status} onChange={(e) => setStatus(e.target.value as CoverageEnrollmentStatus)} aria-label="Status" className={FIELD}>
          {ENROLLMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ENROLLMENT_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-detail text-ink-muted">
          ends
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End date, if known" className={FIELD} />
        </label>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={add} className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50">
          Add
        </button>
        <button type="button" onClick={onDone} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
