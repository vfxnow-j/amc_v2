"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { updateFamily } from "@/lib/actions/families";

const FIELD =
  "h-8 w-full rounded-well border-0 bg-sunken px-2 text-body text-ink outline-none placeholder:text-ink-faint";
const LABEL = "mb-1 block text-micro uppercase text-ink-muted";

/**
 * The four things an asset owns, and the only things on its record that can be
 * edited here.
 *
 * Everything else — fleet, availability, rates — is summed from the models and
 * has nowhere to be typed, which is the property that makes grouping safe to
 * change your mind about.
 *
 * Manufacturer sits at this level because it describes the product rather than
 * the purchase: an RTX 5090 is NVIDIA's whichever board partner assembled the
 * card. The partner and part number stay on the model, where they vary between
 * batches bought at different times, and the model table shows them.
 */
export function FamilyDetails({
  id,
  name,
  manufacturer,
  description,
  notes,
}: {
  id: string;
  name: string;
  manufacturer: string | null;
  description: string | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [form, setForm] = useState({
    name,
    manufacturer: manufacturer ?? "",
    description: description ?? "",
    notes: notes ?? "",
  });
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const dirty =
    form.name !== name ||
    form.manufacturer !== (manufacturer ?? "") ||
    form.description !== (description ?? "") ||
    form.notes !== (notes ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setDone("");
    startTransition(async () => {
      const result = await updateFamily(id, form);
      if (result.status === "error") setError(result.message);
      else {
        setDone(result.message);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {done && !dirty ? <Notice tone="ok">{done}</Notice> : null}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL} htmlFor="family-name">
            Name
          </label>
          <input
            id="family-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="family-maker">
            Manufacturer
          </label>
          <input
            id="family-maker"
            value={form.manufacturer}
            onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
            placeholder="Not recorded"
            className={FIELD}
          />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="family-desc">
          Description
        </label>
        <input
          id="family-desc"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Optional"
          className={FIELD}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="family-notes">
          Notes
        </label>
        <textarea
          id="family-notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Optional"
          className={`${FIELD} h-auto py-2`}
        />
      </div>

      <button
        type="submit"
        disabled={busy || !dirty}
        className="h-8 self-start rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
