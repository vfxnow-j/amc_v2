"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { receiveStock, receiveUnits } from "@/lib/actions/entity-inventory";
import { businessToday, toDateInput } from "@/lib/billing/calendar";
import { duplicateIdentity, matchesQuery, MAX_RECEIVE_UNITS, splitSerials, unitsToSend, type DraftUnit } from "@/lib/entities/screens";
import { AREA, FIELD, Label, PILL, PRIMARY } from "./fields";
import type { LocationChoice } from "./movement-form";

export type ReceiveItem = { id: string; name: string; make: string; trackingMode: "SERIALIZED" | "QUANTITY" };

type Row = DraftUnit & { key: number };
let nextKey = 1;
const blankRow = (serial = ""): Row => ({ key: nextKey++, serial, ownerTag: "", scanTag: "", condition: "" });

/** Receive gear into one of our locations: serials/tags for tracked-by-unit items, a count for the rest. */
export function ReceiveForm({ slug, items, locations, initialItemId }: { slug: string; items: ReceiveItem[]; locations: LocationChoice[]; initialItemId?: string }) {
  const router = useRouter();
  const [itemId, setItemId] = useState(items.some((i) => i.id === initialItemId) ? (initialItemId as string) : "");
  const [filter, setFilter] = useState("");
  const [locationId, setLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow()]);
  const [paste, setPaste] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ message: string; itemId: string; itemName: string } | null>(null);
  const [busy, start] = useTransition();

  const item = items.find((i) => i.id === itemId) ?? null;
  const shown = useMemo(() => items.filter((i) => i.id === itemId || matchesQuery(filter, i.name, i.make)), [items, filter, itemId]);
  const serialized = item?.trackingMode === "SERIALIZED";
  const patch = (key: number, p: Partial<DraftUnit>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function addPasted() {
    const isBlank = (r: Row) => !r.serial.trim() && !r.ownerTag.trim() && !r.scanTag.trim() && !r.condition.trim();
    const existing = rows.map((r) => r.serial.trim()).filter(Boolean);
    const kept = rows.filter((r) => !isBlank(r)).length;
    // Room is what is left once every row that stays is counted; empty rows are reused first.
    const { serials, duplicates, overCap } = splitSerials(paste, existing, MAX_RECEIVE_UNITS - kept + existing.length);
    if (serials.length) {
      setRows((rs) => {
        const queue = [...serials];
        const filled = rs.map((r) => (isBlank(r) && queue.length ? { ...r, serial: queue.shift() as string } : r));
        return [...filled, ...queue.map((s) => blankRow(s))];
      });
    }
    setPaste("");
    setPasteNote(
      [`Added ${serials.length}.`, duplicates ? `${duplicates} repeated, skipped.` : "", overCap ? `${overCap} over the ${MAX_RECEIVE_UNITS}-unit limit, not added.` : ""].filter(Boolean).join(" "),
    );
  }

  function submit() {
    setError(null);
    setSaved(null);
    if (!item) return setError("Choose an item.");
    if (!locationId) return setError("Choose where it is being stored.");
    const common = { reference, notes, occurredAt: date || undefined, toLocationId: locationId };
    if (serialized) {
      const units = unitsToSend(rows);
      if (units.length === 0) return setError("Add at least one unit (a serial or a tag).");
      const dup = duplicateIdentity(rows);
      if (dup) return setError(dup);
      start(async () => {
        const result = await receiveUnits(slug, { ...common, itemId: item.id, units });
        if (result.status === "error") return setError(result.message);
        setSaved({ message: result.message, itemId: item.id, itemName: item.name });
        setRows([blankRow()]);
        setReference(""); setNotes(""); setPasteNote(null);
        router.refresh();
      });
    } else {
      start(async () => {
        const result = await receiveStock(slug, { ...common, itemId: item.id, quantity: Number(quantity) });
        if (result.status === "error") return setError(result.message);
        setSaved({ message: result.message === "Recorded." ? `${quantity} received.` : result.message, itemId: item.id, itemName: item.name });
        setQuantity(""); setReference(""); setNotes("");
        router.refresh();
      });
    }
  }

  const counted = unitsToSend(rows).length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4 rounded-card bg-panel p-4 shadow-sm">
      {saved ? (
        <Notice tone="ok">
          {saved.message} <Link href={`/entity/${slug}/inventory/${saved.itemId}`} className="font-bold underline">Open {saved.itemName}</Link>
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <fieldset disabled={busy} className="flex flex-col gap-4 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label text="Find an item">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type to narrow the list" className={FIELD} />
            </Label>
            <Label text="Item">
              <select value={itemId} onChange={(e) => { setItemId(e.target.value); setSaved(null); }} className={FIELD}>
                <option value="">{items.length ? "Choose an item…" : "No items yet"}</option>
                {shown.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}{i.make ? ` — ${i.make}` : ""} ({i.trackingMode === "SERIALIZED" ? "by unit" : "by quantity"})</option>
                ))}
              </select>
            </Label>
            <p className="text-micro text-ink-muted">
              Not listed? <Link href={`/entity/${slug}/inventory/new`} className="font-bold text-ink underline">Create the item first</Link>.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label text="Store at">
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={FIELD}>
                <option value="">Choose a location…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
              </select>
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Label text="Reference — optional"><input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className={FIELD} /></Label>
              <Label text="Date — optional, defaults to now">
                <input type="date" value={date} max={toDateInput(businessToday())} onChange={(e) => setDate(e.target.value)} className={`${FIELD} tabular-nums`} />
              </Label>
            </div>
          </div>
        </div>

        {item && !serialized ? (
          <Label text="Quantity received">
            <input value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} className={`${FIELD} max-w-40 tabular-nums`} />
          </Label>
        ) : null}

        {serialized ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-card-title">Units</h2>
              <span className="text-detail text-ink-muted tabular-nums" aria-live="polite">{counted} of {MAX_RECEIVE_UNITS}</span>
            </div>
            <div className="flex flex-col gap-1">
              <Label text="Paste serials — one per line">
                <textarea value={paste} rows={3} onChange={(e) => setPaste(e.target.value)} className={AREA} />
              </Label>
              <div className="flex items-center gap-3">
                <button type="button" className={PILL} disabled={!paste.trim()} onClick={addPasted}>Add pasted serials</button>
                {pasteNote ? <span className="text-detail text-ink-muted">{pasteNote}</span> : null}
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map((r, n) => (
                <li key={r.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <input aria-label={`Serial, unit ${n + 1}`} placeholder="Serial" value={r.serial} maxLength={200} onChange={(e) => patch(r.key, { serial: e.target.value })} className={`${FIELD} tabular-nums`} />
                  <input aria-label={`Owner tag, unit ${n + 1}`} placeholder="Owner tag" value={r.ownerTag} maxLength={200} onChange={(e) => patch(r.key, { ownerTag: e.target.value })} className={`${FIELD} tabular-nums`} />
                  <input aria-label={`Scan tag, unit ${n + 1}`} placeholder="Scan tag" value={r.scanTag} maxLength={200} onChange={(e) => patch(r.key, { scanTag: e.target.value })} className={`${FIELD} tabular-nums`} />
                  <input aria-label={`Condition, unit ${n + 1}`} placeholder="Condition" value={r.condition} maxLength={200} onChange={(e) => patch(r.key, { condition: e.target.value })} className={FIELD} />
                  <button type="button" className={PILL} aria-label={`Remove unit ${n + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
                </li>
              ))}
            </ul>
            <div>
              <button type="button" className={PILL} disabled={rows.length >= MAX_RECEIVE_UNITS} onClick={() => setRows((rs) => [...rs, blankRow()])}>Add a unit</button>
              {rows.length >= MAX_RECEIVE_UNITS ? <span className="ml-3 text-detail text-ink-muted">That is the most one receipt can hold.</span> : null}
            </div>
          </div>
        ) : null}

        <Label text="Notes — optional"><textarea value={notes} rows={2} maxLength={2000} onChange={(e) => setNotes(e.target.value)} className={AREA} /></Label>
        <div>
          <button type="submit" className={PRIMARY} disabled={busy || !item}>{busy ? "Receiving…" : "Receive"}</button>
        </div>
      </fieldset>
    </form>
  );
}
