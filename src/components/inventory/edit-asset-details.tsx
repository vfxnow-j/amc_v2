"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAsset } from "@/lib/actions/assets";

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

/**
 * Rename an asset and fix its maker, model and description, in place. The name
 * is read live everywhere (orders, quotes, scan lists), so one edit corrects it
 * on all of them.
 */
export function EditAssetDetails({
  id,
  name,
  manufacturer,
  model,
  description,
}: {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name,
    manufacturer: manufacturer ?? "",
    model: model ?? "",
    description: description ?? "",
  });
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function save() {
    if (!form.name.trim()) {
      setError("An asset needs a name.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await updateAsset(id, {
          name: form.name.trim(),
          manufacturer: form.manufacturer.trim(),
          model: form.model.trim(),
          description: form.description.trim(),
        });
        setOpen(false);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover"
      >
        Edit details
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Edit asset details"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-card bg-panel p-4 shadow-lg">
        <h2 className="text-body font-bold">Edit asset details</h2>
        <label className="flex flex-col gap-1 text-micro uppercase text-ink-muted">
          Name
          <input
            autoFocus
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className={FIELD}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-micro uppercase text-ink-muted">
            Manufacturer
            <input
              value={form.manufacturer}
              onChange={(event) => setForm({ ...form, manufacturer: event.target.value })}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1 text-micro uppercase text-ink-muted">
            Model
            <input
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              className={FIELD}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-micro uppercase text-ink-muted">
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            className={`${FIELD} h-auto py-2`}
          />
        </label>
        {error ? <p role="alert" className="text-detail text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
