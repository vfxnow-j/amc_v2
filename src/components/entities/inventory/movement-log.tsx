"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { correctMovement } from "@/lib/actions/entity-inventory";
import { AREA, Label, PILL } from "./fields";
import type { LogRow } from "./log-rows";

/**
 * The ledger as a list. A correction is a zero-quantity MOVE row that points at
 * the one it fixes; it is labelled as such and cannot itself be corrected. The
 * dialog lives here, not in each row, so it survives the refresh a save causes.
 */
export function MovementLog({ slug, rows, canWrite, empty = "No movements yet." }: { slug: string; rows: LogRow[]; canWrite: boolean; empty?: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<LogRow | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    if (!target) return;
    setError(null);
    start(async () => {
      const result = await correctMovement(slug, target.id, note);
      if (result.status === "error") return setError(result.message);
      setSent(result.message);
      setTarget(null);
      router.refresh();
    });
  }

  if (rows.length === 0) return <p className="px-4 pb-4 text-body text-ink-muted">{empty}</p>;

  return (
    <>
      {sent ? <div className="px-4 pb-2"><Notice tone="ok">{sent}</Notice></div> : null}
      <ul className="divide-y divide-hairline px-4 pb-2">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-body">
            <span className="rounded-tile bg-sunken px-2 py-px text-detail font-bold text-ink">{m.label}</span>
            <span className="font-bold">
              {m.item}
              {m.unit ? <span className="font-normal text-ink-muted"> · {m.unit}</span> : null}
              {m.quantity !== null ? <span className="font-normal text-ink-muted"> × {m.quantity}</span> : null}
            </span>
            {m.from || m.to ? <span className="text-ink-muted">{m.from ?? "—"} → {m.to ?? "—"}</span> : null}
            {m.recipient ? <span className="text-ink-muted">to {m.recipient}</span> : null}
            {m.destination ? <span className="text-ink-muted">({m.destination})</span> : null}
            {m.reference ? <span className="text-ink-muted">ref {m.reference}</span> : null}
            {m.shipping ? <span className="text-ink-muted">{m.shipping}</span> : null}
            {m.notes ? <span className="w-full text-detail text-ink-muted">{m.correction ? <em>{m.notes}</em> : m.notes}</span> : null}
            <span className="ml-auto flex items-center gap-3 text-detail text-ink-faint">
              {m.who} · {m.when}
              {canWrite && !m.correction ? (
                <button type="button" className={PILL} aria-label={`Correct ${m.label} of ${m.item}${m.unit ? ` ${m.unit}` : ""}, ${m.when}`} onClick={() => { setTarget(m); setNote(""); setError(null); setSent(null); }}>
                  Correct
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {target ? (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setTarget(null); }}
          title="Log a correction"
          blurb="The ledger is never edited. This adds a note that points at the entry; it does not move any gear."
          footer={<><ModalCancel /><ModalConfirm onClick={save} disabled={busy || !note.trim()}>{busy ? "Saving…" : "Log correction"}</ModalConfirm></>}
        >
          <div className="flex flex-col gap-3">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <p className="text-detail text-ink-muted">{target.label}: {target.item}{target.unit ? ` · ${target.unit}` : ""}, {target.when}</p>
            <Label text="What is wrong with it"><textarea value={note} rows={3} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={AREA} /></Label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
