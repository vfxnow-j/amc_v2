"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { updateAccount, type AccountOutcome } from "@/lib/actions/accounts";

export type AccountValues = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billingAddress: string | null;
  paymentTerms: number;
  taxExempt: boolean;
  notes: string | null;
  /** People at the account, for the primary and billing pickers. */
  contacts: { id: string; name: string; email: string | null; role: string | null; isPrimary: boolean }[];
};

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-micro uppercase text-ink-muted">{children}</span>;
}

/**
 * Edit the account itself: the business or individual, and what is managed on
 * it (terms, addresses, tax status). People at it are contacts, edited on the
 * Contacts card.
 */
export function EditAccountButton({ account }: { account: AccountValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    company: account.companyName?.trim() || account.name,
    primaryContactId: account.contacts.find((c) => c.isPrimary)?.id ?? "",
    billingContactId: account.contacts.find((c) => c.role === "Billing")?.id ?? "",
    email: account.email ?? "",
    phone: account.phone ?? "",
    address: account.address ?? "",
    billingAddress: account.billingAddress ?? "",
    paymentTerms: String(account.paymentTerms),
    taxExempt: account.taxExempt,
    notes: account.notes ?? "",
  });
  const [outcome, setOutcome] = useState<AccountOutcome | null>(null);
  const [busy, start] = useTransition();
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function save(allowDuplicateName = false) {
    start(async () => {
      const { company, primaryContactId, billingContactId, ...rest } = form;
      const result = await updateAccount(account.id, {
        ...rest,
        name: company,
        companyName: company,
        primaryContactId: primaryContactId || null,
        billingContactId: billingContactId || null,
        paymentTerms: form.paymentTerms === "" ? undefined : Number(form.paymentTerms),
        allowDuplicateName,
      });
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Always from what is saved now, never from an earlier open.
          setForm({
            company: account.companyName?.trim() || account.name,
            primaryContactId: account.contacts.find((c) => c.isPrimary)?.id ?? "",
            billingContactId: account.contacts.find((c) => c.role === "Billing")?.id ?? "",
            email: account.email ?? "",
            phone: account.phone ?? "",
            address: account.address ?? "",
            billingAddress: account.billingAddress ?? "",
            paymentTerms: String(account.paymentTerms),
            taxExempt: account.taxExempt,
            notes: account.notes ?? "",
          });
          setOutcome(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover"
      >
        Edit account
      </button>
      {open ? (
        <Modal
          open
          wide
          onOpenChange={(next) => !next && setOpen(false)}
          title="Edit account"
          blurb="The business or individual: its name, terms and addresses. People at it are contacts."
          footer={
            <>
              <ModalCancel />
              <ModalConfirm disabled={busy} onClick={() => save()}>
                {busy ? "Saving…" : "Save"}
              </ModalConfirm>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {outcome?.status === "error" ? <Notice tone="error">{outcome.message}</Notice> : null}
            {outcome?.status === "duplicate" ? (
              <Notice tone="error">
                {outcome.message}{" "}
                <Link href={`/dashboard/clients/${outcome.existing.id}`} className="underline">
                  Open it
                </Link>
                , or{" "}
                <button type="button" onClick={() => save(true)} className="underline">
                  save with this name anyway
                </button>
                .
              </Notice>
            ) : null}
            <div>
              <Label>Company</Label>
              <input
                value={form.company}
                onChange={(e) => set({ company: e.target.value })}
                aria-label="Company"
                placeholder="The business — or the individual's own name"
                className={FIELD}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Primary contact</Label>
                <select value={form.primaryContactId} onChange={(e) => set({ primaryContactId: e.target.value })} aria-label="Primary contact" className={FIELD}>
                  <option value="">None</option>
                  {account.contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Billing contact</Label>
                <select value={form.billingContactId} onChange={(e) => set({ billingContactId: e.target.value })} aria-label="Billing contact" className={FIELD}>
                  <option value="">Account email</option>
                  {account.contacts.filter((c) => c.email).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.email}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <p className="-mt-1 text-micro text-ink-faint">
                  People are contacts, added on the Contacts card. Invoices and reminders go to the billing contact, or the account email when none is chosen.
                </p>
              </div>
              <div>
                <Label>Account email</Label>
                <input value={form.email} onChange={(e) => set({ email: e.target.value })} aria-label="Account email" className={FIELD} />
              </div>
              <div>
                <Label>Phone</Label>
                <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} aria-label="Phone" className={FIELD} />
              </div>
              <div>
                <Label>Payment terms, days</Label>
                <input type="number" min={0} max={365} value={form.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} aria-label="Payment terms" className={`${FIELD} tabular-nums`} />
              </div>
              <label className="flex h-9 items-center gap-2 self-end text-detail">
                <input type="checkbox" checked={form.taxExempt} onChange={(e) => set({ taxExempt: e.target.checked })} />
                Tax exempt
              </label>
            </div>
            <div>
              <Label>Address</Label>
              <textarea value={form.address} onChange={(e) => set({ address: e.target.value })} rows={2} aria-label="Address" className={`${FIELD} h-auto resize-none py-2`} />
            </div>
            <div>
              <Label>Billing address</Label>
              <textarea value={form.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} rows={2} aria-label="Billing address" className={`${FIELD} h-auto resize-none py-2`} />
            </div>
            <div>
              <Label>Notes</Label>
              <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} aria-label="Notes" className={`${FIELD} h-auto resize-none py-2`} />
            </div>
            {form.email.trim().toLowerCase() !== (account.email ?? "").toLowerCase() ? (
              <p className="text-micro text-ink-faint">
                Changing the account email clears its email approval; an admin has to approve the new address.
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
