"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  addClientContact,
  deleteClientContact,
  updateClientContact,
} from "@/lib/actions/clients";

/**
 * Add, edit and delete a contact: a person at an account. Used on the Contacts
 * page (pick the account) and on the account record (the account is fixed).
 *
 * Changing a contact's email clears its email approval on the server, so a
 * corrected address has to be approved again.
 */

export type AccountOption = { id: string; label: string };

export type ContactValues = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
};

const ROLES = ["Primary", "Billing", "Technical", "Associated", "Other"];

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-micro uppercase text-ink-muted">{children}</span>;
}

function ContactDialog({
  contact,
  clientId,
  accounts,
  onClose,
}: {
  contact?: ContactValues;
  clientId?: string;
  accounts?: AccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [account, setAccount] = useState(clientId ?? "");
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [role, setRole] = useState(contact?.role ?? "Primary");
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    if (!account) return setError("Choose the account this person belongs to.");
    if (!name.trim()) return setError("A contact needs a name.");
    if (email.trim() && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      return setError("That does not look like an email address.");
    }
    setError(null);
    start(async () => {
      try {
        const data = {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
          isPrimary,
        };
        if (contact) await updateClientContact(contact.id, data);
        else await addClientContact(account, data);
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={contact ? "Edit contact" : "Add contact"}
      blurb="A person at an account. Mail to their address is held until an admin approves it."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </ModalConfirm>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {contact ? null : (
          <div>
            <Label>Account</Label>
            {clientId ? null : (
              <select
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                aria-label="Account"
                className={FIELD}
              >
                <option value="">Choose an account…</option>
                {(accounts ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            {clientId ? <p className="text-detail text-ink-muted">This account</p> : null}
          </div>
        )}
        <div>
          <Label>Name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" className={FIELD} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Email</Label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" className={FIELD} />
          </div>
          <div>
            <Label>Phone</Label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" className={FIELD} />
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <Label>Role</Label>
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className={FIELD}>
              {[...new Set([role, ...ROLES])].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-9 items-center gap-2 text-detail">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

const BUTTON = "rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover";

export function AddContactButton({
  clientId,
  accounts,
  solid = false,
}: {
  /** Fixed account (on the account record). Omit on the Contacts page. */
  clientId?: string;
  accounts?: AccountOption[];
  solid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={solid ? "rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid" : BUTTON}
      >
        Add contact
      </button>
      {open ? <ContactDialog clientId={clientId} accounts={accounts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ContactRowActions({
  contact,
  afterDeleteGoTo,
}: {
  contact: ContactValues;
  /** On the profile page, where to go once the contact it shows is gone. */
  afterDeleteGoTo?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function remove() {
    start(async () => {
      try {
        await deleteClientContact(contact.id);
        setDeleting(false);
        if (afterDeleteGoTo) router.push(afterDeleteGoTo);
        else router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete.");
      }
    });
  }

  return (
    <span className="flex gap-1">
      <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
        Edit
      </button>
      <button type="button" onClick={() => setDeleting(true)} className={BUTTON}>
        Delete
      </button>
      {editing ? <ContactDialog contact={contact} onClose={() => setEditing(false)} /> : null}
      {deleting ? (
        <Modal
          open
          onOpenChange={(next) => !next && setDeleting(false)}
          title={`Delete ${contact.name}?`}
          blurb="The contact is removed from the account. Their email approval goes with them."
          footer={
            <>
              <ModalCancel />
              <ModalConfirm tone="danger" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete"}
              </ModalConfirm>
            </>
          }
        >
          {error ? <Notice tone="error">{error}</Notice> : null}
        </Modal>
      ) : null}
    </span>
  );
}
