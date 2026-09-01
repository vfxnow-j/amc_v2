"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { createAccount, type AccountOutcome } from "@/lib/actions/accounts";

/**
 * Creating an account.
 *
 * Only the name is required, and that is the point: an account is created in
 * the middle of doing something else — a call, a quote, a test order — and a
 * form that demands a billing address before it will accept a customer's name
 * gets filled with placeholder text that never gets corrected. Everything else
 * can be added on the record.
 *
 * A duplicate name is a question, not a refusal. Two genuinely distinct clients
 * do share a name, but far more often it means somebody already made this
 * account — so it offers the existing one and lets the person insist.
 */
export function AccountForm({ initialName = "" }: { initialName?: string }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initialName,
    companyName: "",
    email: "",
    phone: "",
    address: "",
    billingAddress: "",
    paymentTerms: "30",
    taxExempt: false,
    notes: "",
  });
  const [outcome, setOutcome] = useState<AccountOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit(allowDuplicateName = false) {
    startTransition(async () => {
      const result = await createAccount({
        ...form,
        paymentTerms: form.paymentTerms === "" ? undefined : Number(form.paymentTerms),
        allowDuplicateName,
      });
      setOutcome(result);
      if (result.status === "ok") router.push(`/dashboard/clients/${result.id}`);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
      className="flex max-w-2xl flex-col gap-3 rounded-card bg-panel p-4 shadow-sm"
    >
      {outcome && outcome.status === "error" ? (
        <Notice tone="error">{outcome.message}</Notice>
      ) : null}

      {outcome && outcome.status === "duplicate" ? (
        <Notice tone="error">
          {outcome.message}{" "}
          <Link
            href={`/dashboard/clients/${outcome.existing.id}`}
            className="underline"
          >
            Open it
          </Link>
          , or{" "}
          <button
            type="button"
            onClick={() => submit(true)}
            className="underline"
          >
            create a second one anyway
          </button>
          .
        </Notice>
      ) : null}

      <Field label="Name" hint="What you call them. The only thing required.">
        <input
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          autoFocus
          required
          placeholder="Jane Doe, or the studio's name"
          className={INPUT}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company">
          <input
            value={form.companyName}
            onChange={(event) => set({ companyName: event.target.value })}
            placeholder="If it differs from the name"
            className={INPUT}
          />
        </Field>
        <Field label="Email" hint="Where quotes and invoices go.">
          <input
            type="email"
            value={form.email}
            onChange={(event) => set({ email: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Phone">
          <input
            value={form.phone}
            onChange={(event) => set({ phone: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field
          label="Payment terms, days"
          hint="Inherited by every order unless the order overrides it."
        >
          <input
            type="number"
            min={0}
            max={365}
            value={form.paymentTerms}
            onChange={(event) => set({ paymentTerms: event.target.value })}
            className={`${INPUT} tabular-nums`}
          />
        </Field>
      </div>

      <Field label="Address">
        <textarea
          value={form.address}
          onChange={(event) => set({ address: event.target.value })}
          rows={2}
          className={`${INPUT} resize-none py-2`}
        />
      </Field>

      <Field label="Billing address" hint="Leave blank to bill to the address above.">
        <textarea
          value={form.billingAddress}
          onChange={(event) => set({ billingAddress: event.target.value })}
          rows={2}
          className={`${INPUT} resize-none py-2`}
        />
      </Field>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={form.taxExempt}
          onChange={(event) => set({ taxExempt: event.target.checked })}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Tax exempt
          <span className="block text-micro text-ink-faint">
            Orders for this account are priced without tax.
          </span>
        </span>
      </label>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
          rows={3}
          placeholder="Anything worth knowing before quoting them"
          className={`${INPUT} resize-none py-2`}
        />
      </Field>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
        <Link
          href="/dashboard/clients"
          className="h-9 rounded-pill bg-sunken px-4 text-pill leading-9 text-ink hover:bg-row-hover"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

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
    <div>
      <p className="mb-[6px] text-micro uppercase text-ink-muted">{label}</p>
      {children}
      {hint ? <p className="mt-1 text-micro text-ink-faint">{hint}</p> : null}
    </div>
  );
}
