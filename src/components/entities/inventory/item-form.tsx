"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { createItem } from "@/lib/actions/entity-inventory";
import { AREA, FIELD, Label, NETWORK_ERROR, PRIMARY } from "./fields";

export type ItemValues = { name: string; manufacturer: string; model: string; category: string; description: string; notes: string };
export const EMPTY_ITEM: ItemValues = { name: "", manufacturer: "", model: "", category: "", description: "", notes: "" };

/** The item fields. Used by the New item page (with the tracking choice) and, via useItemFields, the edit dialog. */
export function ItemFields({ value, onChange }: { value: ItemValues; onChange: (next: ItemValues) => void }) {
  const set = (key: keyof ItemValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Label text="Name"><input value={value.name} maxLength={200} onChange={set("name")} className={FIELD} /></Label></div>
      <Label text="Manufacturer — optional"><input value={value.manufacturer} maxLength={200} onChange={set("manufacturer")} className={FIELD} /></Label>
      <Label text="Model — optional"><input value={value.model} maxLength={200} onChange={set("model")} className={FIELD} /></Label>
      <Label text="Category — optional"><input value={value.category} maxLength={100} onChange={set("category")} className={FIELD} /></Label>
      <div className="sm:col-span-2"><Label text="Description — optional"><textarea value={value.description} rows={2} maxLength={2000} onChange={set("description")} className={AREA} /></Label></div>
      <div className="sm:col-span-2"><Label text="Notes — optional"><textarea value={value.notes} rows={2} maxLength={2000} onChange={set("notes")} className={AREA} /></Label></div>
    </div>
  );
}

/** Create an item, then go to it. */
export function ItemForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [value, setValue] = useState<ItemValues>(EMPTY_ITEM);
  const [mode, setMode] = useState<"SERIALIZED" | "QUANTITY">("SERIALIZED");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      let result;
      try {
        result = await createItem(slug, { ...value, trackingMode: mode });
      } catch (e) {
        console.error(e);
        return setError(NETWORK_ERROR);
      }
      if (result.status === "error") return setError(result.message);
      router.push(result.id ? `/entity/${slug}/inventory/${result.id}` : `/entity/${slug}/inventory`);
    });
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-card bg-panel p-4 shadow-sm">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <fieldset disabled={busy} className="flex flex-col gap-4 border-0 p-0">
        <ItemFields value={value} onChange={setValue} />
        <Label text="How it is tracked">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={FIELD}>
            <option value="SERIALIZED">By unit (each has a serial or tag)</option>
            <option value="QUANTITY">By quantity (counted, like cable)</option>
          </select>
          <span className="text-micro text-ink-faint">This cannot be changed later.</span>
        </Label>
      </fieldset>
      <div><button type="button" onClick={save} disabled={busy} className={PRIMARY}>{busy ? "Saving…" : "Add item"}</button></div>
    </section>
  );
}
