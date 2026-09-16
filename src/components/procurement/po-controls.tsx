"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import {
  cancelPO,
  revisePO,
  submitPO,
  type POOutcome,
} from "@/lib/procurement/po-actions";

type Move = "submit" | "revise" | "cancel";

/**
 * The controls that move a purchase order along, on its record.
 *
 * `DRAFT → SUBMITTED → PARTIAL → RECEIVED`, or `CANCELLED`, and `SUBMITTED →
 * DRAFT` on revise. What is offered follows the ported action's own guards, so
 * nothing is shown that the server would refuse; where they ever disagree, the
 * server's refusal is shown verbatim.
 *
 * No delete. The data is real, and whether v2 offers destructive controls at
 * all is the owner's call (docs/procurement.md). Canceling is how a PO that
 * will never arrive leaves the open list.
 */
export function POControls({
  id,
  poNumber,
  status,
  outstanding,
  unitsReceived,
}: {
  id: string;
  poNumber: string;
  status: string;
  /** Items still to come — said in the cancel dialog. */
  outstanding: number;
  unitsReceived: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Move | null>(null);
  const [outcome, setOutcome] = useState<POOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function run(work: () => Promise<POOutcome>) {
    startTransition(async () => {
      const result = await work();
      setOutcome(result);
      setOpen(null);
      if (result.status === "ok") router.refresh();
    });
  }

  const moves: { move: Move; label: string; primary?: boolean }[] = [];
  if (status === "DRAFT") moves.push({ move: "submit", label: "Submit", primary: true });
  if (status === "SUBMITTED") moves.push({ move: "revise", label: "Revise" });
  if (status !== "RECEIVED" && status !== "CANCELLED") {
    moves.push({ move: "cancel", label: "Cancel PO" });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status !== "CANCELLED" ? (
          <Link
            href={`/dashboard/purchase-orders/${id}/edit`}
            className="h-9 rounded-pill bg-sunken px-3 text-pill leading-9 text-ink hover:bg-row-hover"
          >
            Edit
          </Link>
        ) : null}
        {moves.map((spec) => (
          <button
            key={spec.move}
            type="button"
            disabled={busy}
            onClick={() => {
              setOutcome(null);
              setOpen(spec.move);
            }}
            className={
              spec.primary
                ? "h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
                : "h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            }
          >
            {spec.label}
          </button>
        ))}
      </div>

      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
      ) : null}

      <Modal
        open={open === "submit"}
        onOpenChange={(next) => !next && setOpen(null)}
        title={`Submit ${poNumber}`}
        blurb="Marks it as sent to the vendor, so hardware can be received against it. Edits stay possible afterwards, but the vendor will be working from this version."
        footer={
          <>
            <ModalCancel />
            <ModalConfirm disabled={busy} onClick={() => run(() => submitPO(id))}>
              {busy ? "Submitting…" : "Submit"}
            </ModalConfirm>
          </>
        }
      >
        <p className="text-detail text-ink-muted">
          v1 emails the PDF to the purchase-order recipients at this point.
          Outbound email is switched off in this instance, so nobody is emailed —
          send the PDF to the vendor yourself.
        </p>
      </Modal>

      <Modal
        open={open === "revise"}
        onOpenChange={(next) => !next && setOpen(null)}
        title={`Revise ${poNumber}`}
        blurb="Takes it back to draft. Nothing can be received against it until it is submitted again."
        footer={
          <>
            <ModalCancel>Never mind</ModalCancel>
            <ModalConfirm disabled={busy} onClick={() => run(() => revisePO(id))}>
              {busy ? "Working…" : "Back to draft"}
            </ModalConfirm>
          </>
        }
      />

      <Modal
        open={open === "cancel"}
        onOpenChange={(next) => !next && setOpen(null)}
        title={`Cancel ${poNumber}`}
        blurb={
          unitsReceived > 0
            ? `The ${unitsReceived} ${unitsReceived === 1 ? "unit" : "units"} already received stay in the fleet. ${outstanding} still to come will be recorded as never arriving.`
            : "Nothing further can be received against it, and it cannot be edited or reopened."
        }
        footer={
          <>
            <ModalCancel>Keep it</ModalCancel>
            <ModalConfirm tone="danger" disabled={busy} onClick={() => run(() => cancelPO(id))}>
              {busy ? "Canceling…" : "Cancel the PO"}
            </ModalConfirm>
          </>
        }
      />
    </div>
  );
}
