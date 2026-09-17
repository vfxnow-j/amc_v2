"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FundingRequestStatus } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { PlaceholderLeasePrompt } from "@/components/procurement/placeholder-lease-prompt";
import {
  approveFunding,
  cancelFunding,
  declineFunding,
  fulfilFunding,
  fundFunding,
  reviseFunding,
  submitFunding,
  type FundingOutcome,
} from "@/lib/procurement/funding";

/**
 * Moving a request through its lifecycle, from the record.
 *
 * `DRAFT → SUBMITTED → APPROVED | DECLINED → FUNDED → FULFILLED`, with cancel
 * from anything not yet fulfilled and revise taking a submission back to draft.
 * Only the steps the ported action will accept from the current state are
 * offered, so a refusal is the exception rather than the way a person finds out.
 *
 * Each step opens its own small panel instead of firing on click, because each
 * one either records something (a reason, a loan) or does something that cannot
 * be quietly undone — submitting files the form, emails accounting and asks for
 * approval; funding against a loan moves purchase orders and their units onto
 * it. The panel says which, before the button is pressed.
 *
 * Which steps are offered is decided on the server (Phase 6): the requester or
 * an admin submits and pulls back, approvers who did not raise it approve or
 * decline, admins fund, fulfil and cancel. Approving records the signed-in
 * approver — v1's three typed sign-off names are gone — and a decision is not
 * reversed from here: a declined request is pulled back to draft and asked
 * again, an approved one is canceled if it should not go ahead.
 *
 * Approving then asks whether to create a placeholder lease for the request
 * (`PlaceholderLeasePrompt`), unless one is already linked. The prompt is held
 * in this component's state and rendered ahead of the steps, so it survives the
 * refresh that follows approval even when the approver has no further steps.
 */

export type Step = "submit" | "revise" | "approve" | "decline" | "fund" | "fulfil" | "cancel";

type LeaseOption = { id: string; leaseNumber: string; leaseName: string; lender: string };

const STEP_LABEL: Record<Step, string> = {
  submit: "Submit to accounting",
  revise: "Pull back to draft",
  approve: "Approve",
  decline: "Decline",
  fund: "Mark funded",
  fulfil: "Mark fulfilled",
  cancel: "Cancel request",
};

export function FundingLifecycle({
  id,
  status,
  steps,
  approvesOwn,
  leases,
  currentLeaseId,
  purchaseOrders,
}: {
  id: string;
  status: FundingRequestStatus;
  /** The steps this viewer may take from this state, in the order to show them. */
  steps: Step[];
  /** The viewer approves funding requests, so their own submit goes straight through. */
  approvesOwn: boolean;
  leases: LeaseOption[];
  currentLeaseId: string | null;
  /** Attached POs, and how many already sit on some loan. */
  purchaseOrders: { id: string; poNumber: string; leaseId: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Step | null>(null);
  const [outcome, setOutcome] = useState<FundingOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  const [reason, setReason] = useState("");
  const [leaseId, setLeaseId] = useState(currentLeaseId ?? "");
  const [leasePrompt, setLeasePrompt] = useState(false);

  function run(action: () => Promise<FundingOutcome>, afterOk?: () => void) {
    setOutcome(null);
    startTransition(async () => {
      const result = await action();
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(null);
        afterOk?.();
        router.refresh();
      }
    });
  }

  const prompt = leasePrompt ? (
    <PlaceholderLeasePrompt fundingRequestId={id} onDone={() => setLeasePrompt(false)} />
  ) : null;

  if (steps.length === 0) {
    if (prompt) {
      return (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {outcome?.status === "ok" && outcome.message ? (
            <Notice tone="ok">{outcome.message}</Notice>
          ) : null}
          {prompt}
        </div>
      );
    }
    return (
      <p className="px-4 pb-4 text-body text-ink-muted">
        {status === "FULFILLED"
          ? "Closed out — the hardware was bought and received. The request stays on file as the trail."
          : status === "CANCELLED"
            ? "Canceled. The request stays on file, and nothing further can be done with it."
            : "Nothing here is yours to move on. The requester submits and pulls back, an approver decides, and an administrator funds it."}
      </p>
    );
  }

  // What marking funded would do to the attached POs, said before it happens.
  // Mirrors `assignPurchaseOrdersToLeaseTx`: a PO already on a different loan
  // is left where it is.
  const moving = leaseId
    ? purchaseOrders.filter((po) => po.leaseId === null || po.leaseId === leaseId)
    : [];
  const staying = leaseId
    ? purchaseOrders.filter((po) => po.leaseId !== null && po.leaseId !== leaseId)
    : [];

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {outcome ? (
        <Notice tone={outcome.status === "error" ? "error" : "ok"}>
          {outcome.status === "error" ? outcome.message : outcome.message ?? "Saved."}
        </Notice>
      ) : null}

      {prompt}

      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => {
              setOutcome(null);
              setOpen(open === step ? null : step);
            }}
            aria-expanded={open === step}
            className={`h-8 rounded-pill px-3 text-pill ${
              open === step
                ? "bg-accent-solid text-accent-on-solid"
                : step === steps[0]
                  ? "bg-accent-solid text-accent-on-solid hover:bg-accent-800"
                  : "bg-sunken text-ink hover:bg-row-hover"
            }`}
          >
            {step === "fund" && status === "FUNDED" ? "Change loan" : STEP_LABEL[step]}
          </button>
        ))}
      </div>

      {open === "submit" ? (
        <Panel
          note={`Files the request form against this record and emails the notification recipients who have funding requests switched on. ${
            approvesOwn
              ? "You approve funding requests, so it is approved as it is submitted, recorded as cleared by you."
              : "It then waits on an approver, who is told in the app and by email. Outbound email is off on this instance, so the result says who would have been emailed."
          }`}
          confirm="Submit"
          busy={busy}
          onConfirm={() => run(() => submitFunding(id))}
        />
      ) : null}

      {open === "revise" ? (
        <Panel
          note="Takes the request back so it can be edited, and withdraws any open ask for approval. Submitting again asks again."
          confirm="Pull back to draft"
          busy={busy}
          onConfirm={() => run(() => reviseFunding(id))}
        />
      ) : null}

      {open === "approve" ? (
        <Panel
          note="Records you as the approver, today, at the amount requested. The requester is told. A decision is not changed afterwards."
          confirm="Approve"
          busy={busy}
          onConfirm={() =>
            run(
              () => approveFunding(id),
              // Only worth asking when nothing is linked yet.
              currentLeaseId ? undefined : () => setLeasePrompt(true),
            )
          }
        />
      ) : null}

      {open === "decline" ? (
        <Panel
          note="The reason goes back to the requester. The request stays on file as declined; they pull it back to draft to change it and ask again."
          confirm="Decline"
          busy={busy}
          disabled={!reason.trim()}
          onConfirm={() => run(() => declineFunding(id, reason))}
        >
          <Labeled label="Reason">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={`${INPUT} h-auto resize-none py-2`}
            />
          </Labeled>
        </Panel>
      ) : null}

      {open === "fund" ? (
        <Panel
          note="Records the draw date and the loan the money came from."
          confirm={status === "FUNDED" ? "Save loan" : "Mark funded"}
          busy={busy}
          onConfirm={() => run(() => fundFunding(id, leaseId))}
        >
          <Labeled label="Funded by">
            <select value={leaseId} onChange={(e) => setLeaseId(e.target.value)} className={INPUT}>
              <option value="">Not linked yet</option>
              {leases.map((lease) => (
                <option key={lease.id} value={lease.id}>
                  {lease.leaseNumber} — {lease.leaseName} ({lease.lender})
                </option>
              ))}
            </select>
          </Labeled>
          {leaseId && moving.length > 0 ? (
            <p className="text-detail text-accent-text">
              This also puts {moving.map((po) => po.poNumber).join(", ")} on that loan — each
              becomes a loan purchase, and every unit already received against{" "}
              {moving.length === 1 ? "it" : "them"} is re-marked as loan-owned.
            </p>
          ) : null}
          {leaseId && staying.length > 0 ? (
            <p className="text-detail text-ink-muted">
              {staying.map((po) => po.poNumber).join(", ")}{" "}
              {staying.length === 1 ? "is" : "are"} already on a different loan and will be left
              there — move {staying.length === 1 ? "it" : "them"} from the purchase order.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {open === "fulfil" ? (
        <Panel
          note="Use once the hardware has been bought and received. The request closes and can no longer be edited."
          confirm="Mark fulfilled"
          busy={busy}
          onConfirm={() => run(() => fulfilFunding(id))}
        />
      ) : null}

      {open === "cancel" ? (
        <Panel
          note="Withdraws the request. It stays on file, closed to edits. Attached purchase orders are not touched."
          confirm="Cancel request"
          busy={busy}
          onConfirm={() => run(() => cancelFunding(id))}
        />
      ) : null}
    </div>
  );
}

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint";

function Panel({
  note,
  confirm,
  busy,
  disabled,
  onConfirm,
  children,
}: {
  note: string;
  confirm: string;
  busy: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-well bg-row-alt p-3">
      <p className="text-detail text-ink-muted">{note}</p>
      {children}
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || disabled}
        className="h-8 self-start rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
      >
        {busy ? "Working…" : confirm}
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
