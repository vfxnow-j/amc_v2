"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { raiseFlag } from "@/lib/actions/order-flags";
import { CATEGORY_LABEL, FLAG_CATEGORIES, reasonByCode, reasonsIn, type FlagCategory } from "@/lib/flags/catalog";
import type { FlagSeverity } from "@/generated/prisma/client";

const FIELD = "h-9 rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none";

/**
 * Raise a flag on an order: category, then reason, then the few fields that
 * reason needs. A reason that tracks units (lost in transit) lists the units
 * currently out, and the ones ticked go to Missing until the case closes.
 */
export function FlagDialog({
  reservationId,
  staff,
  unitsOut,
}: {
  reservationId: string;
  staff: { id: string; name: string }[];
  unitsOut: { id: string; barcode: string; assetName: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FlagCategory>("returns");
  const [code, setCode] = useState(reasonsIn("returns")[0].code);
  const [severity, setSeverity] = useState<FlagSeverity | "">("");
  const [ownerId, setOwnerId] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const reason = reasonByCode(code);

  function chooseCategory(next: FlagCategory) {
    setCategory(next);
    setCode(reasonsIn(next)[0].code);
    setSeverity("");
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await raiseFlag({
        reservationId,
        reason: code,
        note,
        severity: severity || undefined,
        ownerId: ownerId || undefined,
        nextActionDate: next || undefined,
        carrier: carrier || undefined,
        trackingNumber: tracking || undefined,
        unitIds: picked,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setNote("");
      setPicked([]);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink transition-colors hover:bg-row-hover"
      >
        Flag
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        wide
        title="Flag this order"
        blurb="A flag opens a case that stays on the order until it is closed with an outcome."
        footer={
          <>
            {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
            <ModalCancel />
            <ModalConfirm onClick={submit} disabled={busy}>
              {busy ? "Flagging…" : "Raise flag"}
            </ModalConfirm>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Category</span>
            <select className={FIELD} value={category} onChange={(e) => chooseCategory(e.target.value as FlagCategory)}>
              {FLAG_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Reason</span>
            <select className={FIELD} value={code} onChange={(e) => { setCode(e.target.value); setSeverity(""); }}>
              {reasonsIn(category).map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Severity</span>
            <select className={FIELD} value={severity} onChange={(e) => setSeverity(e.target.value as FlagSeverity | "")}>
              <option value="">Default ({reason?.severity.toLowerCase()})</option>
              <option value="INFO">Info</option>
              <option value="ATTENTION">Attention</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Owner</span>
            <select className={FIELD} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Nobody yet</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Next action by</span>
            <input type="date" className={FIELD} value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          {reason?.asksCarrier ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase text-ink-muted">Carrier</span>
                <input className={FIELD} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase text-ink-muted">Tracking number</span>
                <input className={FIELD} value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        {reason?.tracksUnits ? (
          <fieldset className="mt-3">
            <legend className="text-micro uppercase text-ink-muted">Units affected</legend>
            {unitsOut.length === 0 ? (
              <p className="text-detail text-ink-muted">No units are out on this order.</p>
            ) : (
              <ul className="mt-1 flex max-h-40 flex-col gap-px overflow-y-auto">
                {unitsOut.map((u) => (
                  <li key={u.id} className="rounded-row px-2 py-[3px] text-detail odd:bg-row-alt">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.includes(u.id)}
                        onChange={(e) =>
                          setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))
                        }
                      />
                      <span className="font-bold">{u.barcode}</span>
                      <span className="truncate text-ink-muted">{u.assetName}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-micro text-ink-faint">
              Ticked units go to Missing and cannot be booked until the case closes.
            </p>
          </fieldset>
        ) : null}

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Note</span>
          <textarea
            rows={3}
            className="rounded-well border-0 bg-sunken px-3 py-2 text-body text-ink outline-none"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </Modal>
    </>
  );
}
