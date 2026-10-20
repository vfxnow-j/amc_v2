"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { createEntity, setEntityActive, updateEntity } from "@/lib/actions/entities-registry";
import { slugPreview, type EntityFormInput } from "@/lib/entities/entity-input";
import { MODULES } from "@/lib/entities/modules";

/**
 * Settings → Entities: create an owner (which also creates its database) or change one.
 *
 * The slug becomes the database name, so it is shown read-only on edit and previewed live on
 * create. Client component: nothing here may import anything that reaches `lib/prisma`.
 */

const FIELD =
  "h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props =
  | { mode: "create" }
  | { mode: "edit"; id: string; slug: string; initial: EntityFormInput; active: boolean };

function TextField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength: number;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
    </label>
  );
}

export function EntityForm(props: Props) {
  const router = useRouter();
  const edit = props.mode === "edit" ? props : null;
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState(edit?.initial.name ?? "");
  const [contactName, setContactName] = useState(edit?.initial.contactName ?? "");
  const [email, setEmail] = useState(edit?.initial.email ?? "");
  const [phone, setPhone] = useState(edit?.initial.phone ?? "");
  const [address, setAddress] = useState(edit?.initial.address ?? "");
  const [notes, setNotes] = useState(edit?.initial.notes ?? "");
  const [modules] = useState<string[]>(edit?.initial.modules ?? ["INVENTORY"]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [confirm, setConfirm] = useState(false);

  const input = (): EntityFormInput => ({ name, contactName, email, phone, address, notes, modules });
  const slug = edit ? edit.slug : slugPreview(name);
  const canSubmit = !busy && name.trim() !== "" && slug !== "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSaved("");
    startTransition(async () => {
      if (edit) {
        const result = await updateEntity(edit.id, input());
        if (result.status === "error") setError(result.message);
        else {
          setSaved(result.message);
          router.refresh();
        }
      } else {
        const result = await createEntity(input());
        if (result.status === "error") setError(result.message);
        else router.push("/dashboard/settings/entities");
      }
    });
  }

  function toggleActive() {
    if (!edit) return;
    setError("");
    setSaved("");
    startTransition(async () => {
      const result = await setEntityActive(edit.id, !edit.active);
      setConfirm(false);
      if (result.status === "error") setError(result.message);
      else {
        setSaved(result.message);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="ok">{saved}</Notice> : null}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} maxLength={120} />

        <div className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Slug</span>
          <span className="text-detail text-ink">{slug || <span className="text-ink-faint">—</span>}</span>
          <span className="text-detail text-ink-faint">
            Locked once created — it becomes the database name.
          </span>
        </div>

        <TextField label="Contact name" value={contactName} onChange={setContactName} maxLength={120} />
        <TextField label="Email" value={email} onChange={setEmail} type="email" maxLength={200} />
        <TextField label="Phone" value={phone} onChange={setPhone} type="tel" maxLength={40} />
        <TextField label="Address" value={address} onChange={setAddress} maxLength={300} />
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Notes</span>
          <textarea
            value={notes}
            maxLength={2000}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-micro uppercase text-ink-muted">Workspaces</legend>
          {MODULES.map((module) => (
            <label key={module.key} className="flex items-start gap-2 text-detail">
              <input
                type="checkbox"
                checked={module.available && modules.includes(module.key)}
                disabled
                className="mt-[3px]"
              />
              <span className={module.available ? "text-ink" : "text-ink-faint"}>
                {module.label}
                <span className="text-ink-muted"> · {module.blurb}</span>
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-detail">
            <input type="checkbox" checked={false} disabled className="mt-[3px]" />
            <span className="text-ink-faint">
              Complete — every module<span className="text-ink-muted"> · Coming soon.</span>
            </span>
          </label>
        </fieldset>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
          >
            {edit ? (busy ? "Saving…" : "Save changes") : busy ? "Creating database…" : "Create entity"}
          </button>
          <Link
            href="/dashboard/settings/entities"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
          >
            Back to entities
          </Link>
        </div>
      </form>

      {edit ? (
        <div className="rounded-well bg-sunken p-3">
          <p className="mb-2 text-detail text-ink-muted">
            {edit.active
              ? "Deactivating takes the entity off the switch. Its database and everything in it are kept; entities are never deleted."
              : "This entity is deactivated: nobody can open its workspace. Its data is kept."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => (edit.active ? setConfirm(true) : toggleActive())}
            className={`rounded-pill bg-panel px-3 py-1 text-pill hover:bg-row-hover disabled:opacity-50 ${
              edit.active ? "text-destructive" : "text-ink"
            }`}
          >
            {edit.active ? "Deactivate entity" : "Reactivate"}
          </button>
          <Modal
            open={confirm}
            onOpenChange={setConfirm}
            title={`Deactivate ${edit.initial.name}?`}
            blurb="Its data is kept. The entity leaves the switch, and nobody can open its workspace until you reactivate it."
            footer={
              <>
                <ModalCancel>Keep it active</ModalCancel>
                <ModalConfirm tone="danger" disabled={busy} onClick={toggleActive}>
                  {busy ? "Deactivating…" : "Deactivate"}
                </ModalConfirm>
              </>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
