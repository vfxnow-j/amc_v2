"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  createAndStartAudit,
  getAuditScopeOptions,
  newScanList,
  type AuditScope,
} from "@/lib/actions/audit-create";

/**
 * "New audit" and "New scan list", on Inventory → Audits & scan lists.
 *
 * Each is a dialog that creates the record and then goes straight to it, because
 * the record is where the work happens: an audit's page runs the count, and a
 * scan list's page takes scans. Nothing is reported back on this screen — the
 * page you land on is the confirmation.
 *
 * The audit dialog states how many units the chosen scope will snapshot before
 * it is confirmed. A full audit writes a line for every unit in the fleet, and
 * the record page's own note says a scope that wide "needs confirming before it
 * writes thousands of lines"; the number on the button is that confirmation.
 */

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-[6px] block text-micro uppercase text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-micro text-ink-faint">{hint}</span> : null}
    </label>
  );
}

type Option = { id: string; name: string; units: number };
type ScopeOptions = { full: number; categories: Option[]; locations: Option[] };

const SCOPES: { value: AuditScope; label: string }[] = [
  { value: "LOCATION", label: "One location" },
  { value: "CATEGORY", label: "One category" },
  { value: "FULL", label: "Everything" },
];

export function NewAuditButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 flex-none rounded-pill bg-accent-solid px-4 text-pill leading-9 text-accent-on-solid transition-colors hover:bg-accent-800"
      >
        New audit
      </button>
      {open ? <NewAuditDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewAuditDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [scope, setScope] = useState<AuditScope>("LOCATION");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getAuditScopeOptions().then((result) => {
      if (!live) return;
      if (result.status === "error") setError(result.message);
      else setOptions(result);
    });
    return () => {
      live = false;
    };
  }, []);

  // How many lines starting it would write, or null until a choice is made.
  const units = !options
    ? null
    : scope === "FULL"
      ? options.full
      : scope === "CATEGORY"
        ? (options.categories.find((option) => option.id === categoryId)?.units ?? null)
        : (options.locations.find((option) => option.id === locationId)?.units ?? null);

  const ready = Boolean(name.trim()) && units !== null && units > 0;

  function confirm() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const outcome = await createAndStartAudit({
        name,
        notes,
        scope,
        categoryId: scope === "CATEGORY" ? categoryId : undefined,
        locationId: scope === "LOCATION" ? locationId : undefined,
      });
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      router.push(`/dashboard/audits/${outcome.id}`);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="New audit"
      blurb="Snapshots the units in scope and opens the count. Scanning checks the shelf against that snapshot and never changes a unit."
      footer={
        <>
          <span className="mr-auto text-detail text-ink-muted">
            {!options
              ? "Counting units…"
              : units === null
                ? "Choose what it covers."
                : units === 0
                  ? "No units in that scope."
                  : `${units} ${units === 1 ? "unit" : "units"} to count.`}
          </span>
          <ModalCancel />
          <ModalConfirm disabled={busy || !ready} onClick={confirm}>
            {busy ? "Starting…" : "Start audit"}
          </ModalConfirm>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="LA Office count, September"
            className={INPUT}
          />
        </Field>

        <div>
          <span className="mb-[6px] block text-micro uppercase text-ink-muted">Covers</span>
          <div
            role="radiogroup"
            aria-label="What the audit covers"
            className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
          >
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scope === option.value}
                onClick={() => setScope(option.value)}
                className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
                  scope === option.value
                    ? "bg-segmented-thumb text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {scope === "LOCATION" ? (
          <Field label="Location">
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={!options}
              className={INPUT}
            >
              <option value="">Choose a location…</option>
              {options?.locations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.units}
                </option>
              ))}
            </select>
          </Field>
        ) : scope === "CATEGORY" ? (
          <Field label="Category">
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              disabled={!options}
              className={INPUT}
            >
              <option value="">Choose a category…</option>
              {options?.categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.units}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Notes" hint="Optional.">
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={INPUT}
          />
        </Field>

        <p className="text-detail text-balance text-ink-faint">
          Counts every unit not retired, including sold ones still on the books —
          the same set the audit snapshots. Audits of chosen assets or of what a
          client holds need a picker that isn&rsquo;t built yet.
        </p>

        <button type="submit" hidden />
      </form>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </Modal>
  );
}

export function NewScanListButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function close(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setName("");
      setDescription("");
      setError(null);
    }
  }

  function confirm() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const outcome = await newScanList({ name, description });
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      router.push(`/dashboard/audits/scan-lists/${outcome.id}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 flex-none rounded-pill bg-sunken px-4 text-pill leading-9 text-ink transition-colors hover:bg-row-hover"
      >
        New scan list
      </button>
      <Modal
        open={open}
        onOpenChange={close}
        title="New scan list"
        blurb="A free-form gather: scan whatever is in front of you and work out what it was afterwards."
        footer={
          <>
            <ModalCancel />
            <ModalConfirm disabled={busy || !name.trim()} onClick={confirm}>
              {busy ? "Creating…" : "Create and scan"}
            </ModalConfirm>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Shelf 4, returns bench"
              className={INPUT}
            />
          </Field>
          <Field label="Note" hint="Optional.">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={INPUT}
            />
          </Field>
          <button type="submit" hidden />
        </form>
        {error ? (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        ) : null}
      </Modal>
    </>
  );
}
