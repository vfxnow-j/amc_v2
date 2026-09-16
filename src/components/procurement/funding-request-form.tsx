"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { moneyExact } from "@/lib/format";
import { computeFundingMetrics } from "@/lib/utils/funding";
import {
  CUSTOMER_COMMITMENT_LABEL,
  FUNDING_PURCHASE_TYPE_LABEL,
} from "@/lib/procurement/funding-labels";
import {
  createFunding,
  updateFunding,
  type FundingItemInput,
  type FundingRequestInput,
} from "@/lib/procurement/funding";
import { FundingMarkers } from "@/components/procurement/funding-markers";

/**
 * Creating and editing an equipment funding request — v1's paper form, in its
 * five numbered sections.
 *
 * Everything but who, when, how much and what for is optional, and that is
 * v1's design rather than laxity: the requester fills the business case, and
 * accounting fills the financing half later — often in the PDF. A blank is sent
 * as a blank and stays one.
 *
 * The payback markers preview live from the same `computeFundingMetrics` the
 * record, the PDF and the email use, so the requester sees what accounting will
 * see. They are labelled as estimates here too: every input is a guess typed
 * into this form.
 *
 * Attached purchase orders and client orders are not on this form. They are
 * attached and detached on the record, one at a time, so saving an edit can
 * never undo an attachment made from the PO side in the meantime. The one
 * exception is the PO a request is started from, which arrives already attached.
 *
 * Takes plain data only. It is a client component, and anything that reaches
 * `lib/prisma` would drag the pg driver into the browser.
 */

type Option = { id: string; name: string };
type LeaseOption = { id: string; leaseNumber: string; leaseName: string; lender: string };

export function FundingRequestForm({
  requestId,
  initial,
  clients,
  leases,
  cancelHref,
}: {
  /** Present when editing. */
  requestId?: string;
  initial: FundingRequestInput;
  clients: Option[];
  leases: LeaseOption[];
  cancelHref: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FundingRequestInput>(initial);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const set = (patch: Partial<FundingRequestInput>) => setForm((f) => ({ ...f, ...patch }));
  const bind = (key: keyof FundingRequestInput) => ({
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set({ [key]: event.target.value } as Partial<FundingRequestInput>),
  });

  const setItem = (index: number, patch: Partial<FundingItemInput>) =>
    set({ items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const equipmentTotal = useMemo(
    () =>
      Math.round(
        form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0) *
          100,
      ) / 100,
    [form.items],
  );
  const itemQuantity = form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const metrics = useMemo(() => {
    const num = (value: string) => {
      const raw = value.trim().replace(/[$,%\s]/g, "");
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return computeFundingMetrics({
      totalEquipmentCost: equipmentTotal,
      amountRequested: num(form.amountRequested),
      amountBorrowed: num(form.amountBorrowed),
      financingFees: num(form.financingFees),
      estimatedTotalInterest: num(form.estimatedTotalInterest),
      monthlyPayment: num(form.monthlyPayment),
      customerRentalRate: num(form.customerRentalRate),
      billableUnits: num(form.billableUnits),
      customerRentalCharge: num(form.customerRentalCharge),
      expectedInitialRevenue: num(form.expectedInitialRevenue),
      expectedGrossProfit: num(form.expectedGrossProfit),
      expectedAnnualRevenue: num(form.expectedAnnualRevenue),
      estimatedResaleValue: num(form.estimatedResaleValue),
      estimatedPaybackMonths: num(form.estimatedPaybackMonths),
      expectedHoldMonths: num(form.expectedHoldMonths),
    });
  }, [form, equipmentTotal]);

  const rateAndUnits = Boolean(form.customerRentalRate.trim() && form.billableUnits.trim());

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    startTransition(async () => {
      const outcome = requestId ? await updateFunding(requestId, form) : await createFunding(form);
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      router.push(`/dashboard/funding/${outcome.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-3">
      <Section
        number={1}
        title="Request & purpose"
        note="Complete before committing to financing, drawing on a line of credit, or buying financed rental equipment."
      >
        <Field label="Purchase type" hint="Rental earns every month, resale once, cloud backs hosted services — it frames how the return is read.">
          <select {...bind("purchaseType")} required className={INPUT}>
            <option value="">What is this hardware for?</option>
            {Object.entries(FUNDING_PURCHASE_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Requested by">
            <input {...bind("requestedBy")} required className={INPUT} />
          </Field>
          <Field label="Request date">
            <input type="date" {...bind("requestDate")} required className={INPUT} />
          </Field>
          <Field label="Funding needed by">
            <input type="date" {...bind("neededByDate")} className={INPUT} />
          </Field>
          <Field label="Amount requested, $">
            <input {...bind("amountRequested")} inputMode="decimal" required className={NUMBER} />
          </Field>
        </div>
        <Field label="Business purpose — why the funds are needed">
          <textarea {...bind("businessPurpose")} rows={3} className={AREA} />
        </Field>
      </Section>

      <Section number={2} title="Equipment & customer">
        <div>
          <p className="mb-[6px] text-micro uppercase text-ink-muted">Equipment being purchased</p>
          {form.items.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_72px_120px_110px_28px] gap-2 text-colhead uppercase text-ink-muted">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit cost, $</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {form.items.map((item, index) => (
                <div key={index} className="grid grid-cols-[1fr_72px_120px_110px_28px] items-center gap-2">
                  <input
                    value={item.description}
                    onChange={(event) => setItem(index, { description: event.target.value })}
                    aria-label={`Line ${index + 1} description`}
                    className={INPUT}
                  />
                  <input
                    value={item.quantity}
                    onChange={(event) => setItem(index, { quantity: event.target.value })}
                    inputMode="numeric"
                    aria-label={`Line ${index + 1} quantity`}
                    className={NUMBER}
                  />
                  <input
                    value={item.unitCost}
                    onChange={(event) => setItem(index, { unitCost: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Line ${index + 1} unit cost`}
                    className={NUMBER}
                  />
                  <span className="text-right text-detail tabular-nums text-ink-muted">
                    {moneyExact((Number(item.quantity) || 0) * (Number(item.unitCost) || 0))}
                  </span>
                  <button
                    type="button"
                    onClick={() => set({ items: form.items.filter((_, i) => i !== index) })}
                    aria-label={`Remove line ${index + 1}`}
                    className="h-7 rounded-pill text-detail text-ink-muted hover:bg-row-hover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-detail text-ink-muted">
              No lines yet. Itemise the hardware, or describe it in the notes below
              if it isn&rsquo;t priced out.
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => set({ items: [...form.items, { description: "", quantity: "1", unitCost: "" }] })}
              className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
            >
              Add a line
            </button>
            <span className="ml-auto text-detail text-ink-muted">
              Equipment total{" "}
              <span className="font-bold tabular-nums text-ink">{moneyExact(equipmentTotal)}</span>
            </span>
          </div>
        </div>
        <Field label="Equipment notes">
          <textarea {...bind("equipmentSummary")} rows={2} className={AREA} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Customer">
            <select {...bind("clientId")} className={INPUT}>
              <option value="">No named customer</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <input {...bind("projectName")} className={INPUT} />
          </Field>
          <Field label="Customer commitment">
            <select {...bind("customerCommitment")} className={INPUT}>
              <option value="">Not stated</option>
              {Object.entries(CUSTOMER_COMMITMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Rental rate, $/mo per unit">
            <input {...bind("customerRentalRate")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field
            label="Billable units"
            hint={itemQuantity > 0 && !form.billableUnits.trim() ? `${itemQuantity} on the equipment list` : undefined}
          >
            <input {...bind("billableUnits")} inputMode="numeric" className={NUMBER} />
          </Field>
          {/* Derived whenever rate and units are both given: the markers divide
              the whole request's cost by this total, and a per-unit figure
              typed here reads as a payback several times too long. */}
          <Field label="Total monthly charge, $" hint={rateAndUnits ? "Rate × units" : "Or enter a total"}>
            {rateAndUnits ? (
              <span className={`${NUMBER} flex items-center justify-end text-ink-muted`}>
                {metrics.monthlyRentalCharge !== null ? moneyExact(metrics.monthlyRentalCharge) : "—"}
              </span>
            ) : (
              <input {...bind("customerRentalCharge")} inputMode="decimal" className={NUMBER} />
            )}
          </Field>
          <Field label="Expected initial revenue, $">
            <input {...bind("expectedInitialRevenue")} inputMode="decimal" className={NUMBER} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rental period">
            <input {...bind("rentalPeriod")} placeholder="e.g. 6 months from Mar 1" className={INPUT} />
          </Field>
          <Field label="Payment terms">
            <input {...bind("paymentTerms")} className={INPUT} />
          </Field>
        </div>
      </Section>

      <Section number={3} title="Financing terms" note="Leave blank if accounting will fill these in.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Lender or source">
            <input {...bind("lender")} className={INPUT} />
          </Field>
          <Field label="Amount borrowed, $">
            <input {...bind("amountBorrowed")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Interest rate, %">
            <input {...bind("interestRatePercent")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Term, months">
            <input {...bind("termMonths")} inputMode="numeric" className={NUMBER} />
          </Field>
          <Field label="Monthly payment, $">
            <input {...bind("monthlyPayment")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Origination & fees, $">
            <input {...bind("financingFees")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Estimated total interest, $">
            <input {...bind("estimatedTotalInterest")} inputMode="decimal" className={NUMBER} />
          </Field>
          <span />
          <Field label="First payment">
            <input type="date" {...bind("firstPaymentDate")} className={INPUT} />
          </Field>
          <Field label="Expected payoff">
            <input type="date" {...bind("expectedPayoffDate")} className={INPUT} />
          </Field>
        </div>
      </Section>

      <Section number={4} title="Payback & asset plan" note="The return case. These feed the markers below.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Expected gross profit, initial rental, $">
            <input {...bind("expectedGrossProfit")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Estimated payback, months">
            <input {...bind("estimatedPaybackMonths")} inputMode="numeric" className={NUMBER} />
          </Field>
          <Field label="Expected annual utilization, %">
            <input {...bind("expectedAnnualUtilization")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Expected hold period, months">
            <input {...bind("expectedHoldMonths")} inputMode="numeric" className={NUMBER} />
          </Field>
          <Field label="Ongoing annual rental revenue, $">
            <input {...bind("expectedAnnualRevenue")} inputMode="decimal" className={NUMBER} />
          </Field>
          <Field label="Estimated resale value, $">
            <input {...bind("estimatedResaleValue")} inputMode="decimal" className={NUMBER} />
          </Field>
        </div>
        <Field label="Exit plan">
          <input
            {...bind("exitPlan")}
            placeholder="e.g. resell to the client at end of term, or redeploy to the rental pool"
            className={INPUT}
          />
        </Field>
        <FundingMarkers metrics={metrics} />
      </Section>

      <Section number={5} title="Key risk & approval rationale">
        <Field label="If the initial customer cancels, what is the alternate use for this equipment?">
          <textarea {...bind("alternateUsePlan")} rows={2} className={AREA} />
        </Field>
        <Field label="Why borrow, rather than rent, lease or use existing inventory?">
          <textarea {...bind("borrowRationale")} rows={2} className={AREA} />
        </Field>
      </Section>

      <Section title="Loan & notes">
        <Field
          label="Funded by"
          hint="Usually set when the request is marked funded. Setting it here links the loan without moving any purchase order onto it."
        >
          <select {...bind("leaseId")} className={INPUT}>
            <option value="">Not linked yet</option>
            {leases.map((lease) => (
              <option key={lease.id} value={lease.id}>
                {lease.leaseNumber} — {lease.leaseName} ({lease.lender})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea {...bind("notes")} rows={3} className={AREA} />
        </Field>
      </Section>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          {busy ? "Saving…" : requestId ? "Save changes" : "Create draft request"}
        </button>
        <Link
          href={cancelHref}
          className="h-9 rounded-pill bg-sunken px-4 text-pill leading-9 text-ink hover:bg-row-hover"
        >
          Cancel
        </Link>
        {!requestId ? (
          <span className="text-detail text-ink-muted">
            It starts as a draft. Nothing goes to accounting until it is submitted.
          </span>
        ) : null}
      </div>
    </form>
  );
}

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";
const NUMBER = `${INPUT} text-right tabular-nums`;
const AREA =
  "w-full resize-none rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint";

function Section({
  number,
  title,
  note,
  children,
}: {
  number?: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
      <header>
        <h2 className="text-card-title">
          {number ? <span className="text-ink-muted">{number}. </span> : null}
          {title}
        </h2>
        {note ? <p className="text-detail text-ink-muted">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-[6px] block text-micro uppercase text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-micro text-ink-faint">{hint}</span> : null}
    </label>
  );
}
