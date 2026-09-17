"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { LEASE_STATUS_LABEL } from "@/lib/accounting/labels";
import { businessToday, parseDateInput, toDateInput } from "@/lib/billing/calendar";
import { dayYear } from "@/lib/format";
import { createLeaseEntry, suggestLeaseNumber } from "@/lib/actions/lease-create";

/**
 * "New lease", on Accounting → Leases.
 *
 * A dialog rather than a `/leases/new` page: a lease is eleven plain fields and
 * no line items, and the record it lands on is where everything else about it —
 * units, documents, the funding trail — is added. Creating goes straight there.
 *
 * The term is typed and the end date shown, derived, beneath it (see
 * `createLeaseEntry`); the server works it out again rather than trusting this
 * preview. The number is prefilled from Settings → Business → Numbering and can
 * be overwritten with the lender's own.
 */

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="mb-[6px] block text-micro uppercase text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-micro text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function blank() {
  return {
    leaseName: "",
    leaseNumber: "",
    lender: "",
    totalAmount: "",
    monthlyPayment: "",
    interestPercent: "",
    startDate: toDateInput(businessToday()),
    termMonths: "",
    status: "ACTIVE",
    notes: "",
  };
}

/** The end date the server will derive, for the hint. Same clamping rule. */
function endPreview(start: string, term: string): string | null {
  const day = parseDateInput(start);
  const months = Number(term);
  if (!day || !Number.isInteger(months) || months < 1) return null;
  const month = day.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(day.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return dayYear(
    new Date(Date.UTC(day.getUTCFullYear(), month, Math.min(day.getUTCDate(), lastDay), 12)),
  );
}

export function NewLeaseButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 flex-none rounded-pill bg-accent-solid px-4 text-pill leading-9 text-accent-on-solid transition-colors hover:bg-accent-800"
      >
        New lease
      </button>
      {open ? <NewLeaseDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewLeaseDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    suggestLeaseNumber().then((number) => {
      if (live && number) {
        setForm((current) => (current.leaseNumber ? current : { ...current, leaseNumber: number }));
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const set = (patch: Partial<ReturnType<typeof blank>>) => setForm((current) => ({ ...current, ...patch }));
  const ends = endPreview(form.startDate, form.termMonths);
  const ready =
    form.leaseName.trim() &&
    form.leaseNumber.trim() &&
    form.lender.trim() &&
    form.totalAmount.trim() &&
    form.monthlyPayment.trim() &&
    form.interestPercent.trim() &&
    ends !== null;

  function confirm() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const outcome = await createLeaseEntry(form);
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      router.push(`/dashboard/leases/${outcome.id}`);
    });
  }

  return (
    <Modal
      open
      wide
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="New lease"
      blurb="Money borrowed to buy hardware. Units join it later, through the purchase orders it funds."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm disabled={busy || !ready} onClick={confirm}>
            {busy ? "Creating…" : "Create lease"}
          </ModalConfirm>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <Field label="Name" className="sm:col-span-2">
          <input
            autoFocus
            value={form.leaseName}
            onChange={(event) => set({ leaseName: event.target.value })}
            placeholder="RTX 5090 build-out, Q4"
            className={INPUT}
          />
        </Field>
        <Field label="Lease number">
          <input
            value={form.leaseNumber}
            onChange={(event) => set({ leaseNumber: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Lender">
          <input
            value={form.lender}
            onChange={(event) => set({ lender: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Amount financed">
          <input
            value={form.totalAmount}
            inputMode="decimal"
            onChange={(event) => set({ totalAmount: event.target.value })}
            placeholder="0.00"
            className={INPUT}
          />
        </Field>
        <Field label="Monthly payment">
          <input
            value={form.monthlyPayment}
            inputMode="decimal"
            onChange={(event) => set({ monthlyPayment: event.target.value })}
            placeholder="0.00"
            className={INPUT}
          />
        </Field>
        <Field label="Interest rate" hint="A percentage, e.g. 7.25.">
          <input
            value={form.interestPercent}
            inputMode="decimal"
            onChange={(event) => set({ interestPercent: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="State">
          <select
            value={form.status}
            onChange={(event) => set({ status: event.target.value })}
            className={INPUT}
          >
            {Object.entries(LEASE_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts">
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => set({ startDate: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Term, months" hint={ends ? `Ends ${ends}.` : "The end date follows from the term."}>
          <input
            value={form.termMonths}
            inputMode="numeric"
            onChange={(event) => set({ termMonths: event.target.value })}
            placeholder="36"
            className={INPUT}
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input
            value={form.notes}
            onChange={(event) => set({ notes: event.target.value })}
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
  );
}
