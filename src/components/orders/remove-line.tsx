"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { removeOrderLine, type StageOutcome } from "@/lib/actions/order-stage";

/**
 * Taking a line off an order.
 *
 * It asks first, and the question names the consequence rather than the action.
 * Removing a line does not only delete a row: every unit still out against it
 * is returned to stock, its checkout canceled and its revenue recomputed. Doing
 * that to three units sitting in a client's studio is worth a sentence before
 * rather than a surprise after — so the count is in the dialog, and it is
 * phrased as something to go and check.
 *
 * Offered wherever the order can still be edited. The ported action refuses on
 * completed, canceled and lost orders, and the record does not render the
 * control on those, so the two agree.
 */
export function RemoveLine({
  reservationId,
  itemId,
  label,
  unitsOut,
}: {
  reservationId: string;
  itemId: string;
  label: string;
  /** Units checked out against this line and not yet back. */
  unitsOut: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
        aria-label={`Remove ${label} from this order`}
        title="Remove this line"
        className="flex size-5 items-center justify-center rounded-well text-ink-faint hover:bg-row-hover hover:text-destructive"
      >
        <X className="size-[13px]" aria-hidden />
      </button>

      {outcome && outcome.status === "error" ? (
        <Notice tone="error" className="mt-1">
          {outcome.message}
        </Notice>
      ) : null}

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Remove this line"
          blurb={`${label} comes off the order, and the order is repriced from what is left.`}
          footer={
            <>
              <ModalCancel>Keep it</ModalCancel>
              <ModalConfirm
                tone="danger"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await removeOrderLine(reservationId, itemId);
                    setOutcome(result);
                    if (result.status === "ok") {
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {busy ? "Removing…" : "Remove line"}
              </ModalConfirm>
            </>
          }
        >
          {unitsOut > 0 ? (
            <Notice tone="error">
              {unitsOut} {unitsOut === 1 ? "unit is" : "units are"} still checked
              out against this line. Removing it returns{" "}
              {unitsOut === 1 ? "it" : "them"} to available stock and cancels the
              checkout — but that does not bring{" "}
              {unitsOut === 1 ? "it" : "them"} back from the client. Check in{" "}
              {unitsOut === 1 ? "the unit" : "the units"} first unless you know{" "}
              {unitsOut === 1 ? "it is" : "they are"} physically here.
            </Notice>
          ) : (
            <p className="text-detail text-ink-muted">
              Nothing is checked out against it, so there is nothing to bring
              back.
            </p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
