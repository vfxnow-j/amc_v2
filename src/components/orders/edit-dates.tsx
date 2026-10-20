"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { saveOrderDates, type StageOutcome } from "@/lib/actions/order-stage";

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Change when a draft rental goes out and comes back.
 *
 * A dialog with a Save, like shipping, because saving reprices every line for
 * the new term. Only offered while the order is a draft or in revision; the
 * action enforces the same, so a stale page cannot move a sent quote's dates.
 */
export function EditDates({
  id,
  start,
  end,
}: {
  id: string;
  /** `YYYY-MM-DD`. */
  start: string;
  end: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function save() {
    setOutcome(null);
    startTransition(async () => {
      const result = await saveOrderDates(id, from, to);
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
          setFrom(start);
          setTo(end);
          setOutcome(null);
          setOpen(true);
        }}
        className="inline-flex items-center rounded-pill bg-sunken px-3 py-1 text-pill text-ink transition-colors hover:bg-row-hover"
      >
        Edit dates
      </button>

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Order dates"
          blurb="Saving reprices every line for the new term."
          footer={
            <>
              <ModalCancel />
              <ModalConfirm onClick={save} disabled={busy || !from || !to}>
                {busy ? "Saving…" : "Save dates"}
              </ModalConfirm>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {outcome && outcome.status === "error" ? (
              <Notice tone="error">{outcome.message}</Notice>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-[3px]">
                <span className="text-micro uppercase text-ink-muted">Starts</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-[3px]">
                <span className="text-micro uppercase text-ink-muted">Ends</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} />
              </label>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
