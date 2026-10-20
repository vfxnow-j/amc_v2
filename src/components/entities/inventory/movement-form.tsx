"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { moveStock, moveUnit } from "@/lib/actions/entity-inventory";
import { businessToday, toDateInput } from "@/lib/billing/calendar";
import { AREA, FIELD, Label } from "./fields";

export type MovementType = "MOVE" | "RELEASE" | "RETURN";
export type LocationChoice = { id: string; name: string; path: string };

/** What is being moved: one serialized unit, or some counted stock at a place. */
export type MovementTarget =
  | { kind: "unit"; type: MovementType; unitId: string; itemName: string; label: string; fromName: string | null }
  | { kind: "stock"; type: MovementType; itemId: string; itemName: string; fromLocationId: string; fromName: string; available: number };

const NEW_SITE = "__new__";
const COPY: Record<MovementType, { title: string; verb: string; where: string }> = {
  MOVE: { title: "Move", verb: "Move", where: "Move to" },
  RELEASE: { title: "Release", verb: "Release", where: "Destination site" },
  RETURN: { title: "Return", verb: "Return", where: "Store at" },
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One dialog for move, release and return, of a unit or of stock. The page-level
 * table owns it (so it survives the refresh a save causes). Nothing is validated
 * here beyond what the form needs to build the input: the action refuses bad
 * input and its message is shown as is.
 */
export function MovementForm({
  slug, target, locations, onClose,
}: {
  slug: string; target: MovementTarget; locations: LocationChoice[]; onClose: () => void;
}) {
  const router = useRouter();
  const t = target.type;
  const [dest, setDest] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [quantity, setQuantity] = useState(target.kind === "stock" ? String(target.available) : "1");
  const [recipient, setRecipient] = useState("");
  const [destination, setDestination] = useState("");
  const [reference, setReference] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [final, setFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedSite, setUsedSite] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const finalHandBack = t === "RELEASE" && final;
  const typedSite = dest === NEW_SITE ? siteName.trim() : "";
  const matched = typedSite ? (locations.find((l) => sameName(l.name, typedSite)) ?? null) : null;
  const done = usedSite !== null;

  function submit() {
    setError(null);
    const common = {
      reference, notes, occurredAt: date || undefined,
      ...(t === "RELEASE" ? { recipient, destination, carrier, tracking, finalToOwner: final } : {}),
      ...(finalHandBack ? {} : dest === NEW_SITE ? { newSiteName: siteName, newSiteAddress: siteAddress } : { toLocationId: dest }),
    };
    start(async () => {
      const result =
        target.kind === "unit"
          ? await moveUnit(slug, { ...common, unitId: target.unitId, type: t })
          : await moveStock(slug, { ...common, itemId: target.itemId, type: t, fromLocationId: target.fromLocationId, quantity: Number(quantity) });
      if (result.status === "error") return setError(result.message);
      router.refresh();
      // The action says which existing site a typed name matched; the client's own name match is only the fallback.
      const used = result.usedSite ?? (matched ? matched.path : null);
      if (used) setUsedSite(used);
      else onClose();
    });
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`${COPY[t].title} ${target.itemName}`}
      blurb={target.kind === "unit" ? `${target.label}${target.fromName ? ` · now at ${target.fromName}` : ""}` : `${target.available} at ${target.fromName}`}
      footer={
        done ? <ModalCancel>Close</ModalCancel> : (
          <>
            <ModalCancel />
            <ModalConfirm onClick={submit} disabled={busy}>{busy ? "Saving…" : COPY[t].verb}</ModalConfirm>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? <Notice tone="ok">Saved. The site name matched an existing site, so {usedSite} was used and no new site was created.</Notice> : null}
        <fieldset disabled={busy || done} className="flex flex-col gap-3 border-0 p-0">
          {target.kind === "stock" ? (
            <Label text="Quantity">
              <input value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.target.value)} className={`${FIELD} tabular-nums`} />
            </Label>
          ) : null}

          {t === "RELEASE" ? (
            <>
              <Label text="Released to (recipient)">
                <input value={recipient} maxLength={200} onChange={(e) => setRecipient(e.target.value)} className={FIELD} />
              </Label>
              <label className="flex items-center gap-2 text-detail text-ink">
                <input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} />
                Final hand-back to the owner (leaves our custody)
              </label>
            </>
          ) : null}

          {finalHandBack ? null : (
            <>
              <Label text={COPY[t].where}>
                <select value={dest} onChange={(e) => setDest(e.target.value)} className={FIELD}>
                  <option value="">Choose a location…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
                  <option value={NEW_SITE}>Add a new site…</option>
                </select>
              </Label>
              {dest === NEW_SITE ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Label text="New site name">
                    <input value={siteName} maxLength={120} onChange={(e) => setSiteName(e.target.value)} className={FIELD} />
                  </Label>
                  <Label text="Address — optional">
                    <input value={siteAddress} maxLength={300} onChange={(e) => setSiteAddress(e.target.value)} className={FIELD} />
                  </Label>
                  {matched ? (
                    <p className="text-micro text-ink-muted sm:col-span-2">A site called “{matched.name}” already exists ({matched.path}); it will be used instead of creating another.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {t === "RELEASE" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Label text="Destination notes — optional"><input value={destination} maxLength={200} onChange={(e) => setDestination(e.target.value)} className={FIELD} /></Label>
              <Label text="Reference — optional"><input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className={FIELD} /></Label>
              <Label text="Carrier — optional"><input value={carrier} maxLength={200} onChange={(e) => setCarrier(e.target.value)} className={FIELD} /></Label>
              <Label text="Tracking number — optional"><input value={tracking} maxLength={200} onChange={(e) => setTracking(e.target.value)} className={`${FIELD} tabular-nums`} /></Label>
            </div>
          ) : (
            <Label text="Reference — optional"><input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className={FIELD} /></Label>
          )}

          <Label text="Date — optional, defaults to now">
            <input type="date" value={date} max={toDateInput(businessToday())} onChange={(e) => setDate(e.target.value)} className={`${FIELD} tabular-nums`} />
          </Label>
          <Label text="Notes — optional">
            <textarea value={notes} rows={2} maxLength={2000} onChange={(e) => setNotes(e.target.value)} className={AREA} />
          </Label>
        </fieldset>
      </div>
    </Modal>
  );
}
