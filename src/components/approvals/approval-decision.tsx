"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { usePlaceholderLeaseOffer } from "@/components/procurement/placeholder-lease-prompt";
import { decideApproval } from "@/lib/approvals/actions";
import type { DecisionOutcome } from "@/lib/approvals/core";

/**
 * Approve or deny one pending request.
 *
 * Only rendered for someone the server has already said may decide it, and the
 * server checks again: the scope, that they did not raise it, that it is still
 * pending, and that the figure has not moved since it was asked.
 *
 * Deny opens a reason box rather than firing, because the reason is the whole
 * of what the requester gets back — "denied" alone tells them nothing to fix.
 *
 * Approving a funding request also asks whether to create a placeholder lease
 * for it, when the caller passes `placeholderLeaseFor` and a
 * `PlaceholderLeaseHost` is mounted above. The question is handed to the host
 * rather than asked here, because the decision re-renders the queue and this
 * row leaves it (see the host).
 */
export function ApprovalDecision({
  requestId,
  label,
  amount,
  requestedBy,
  compact = false,
  placeholderLeaseFor,
}: {
  requestId: string;
  label: string;
  /** Pre-formatted — said on the buttons so nobody approves a figure they did not read. */
  amount: string;
  requestedBy: string;
  compact?: boolean;
  /** A funding request's id, with no lease linked: offer a placeholder lease on approve. */
  placeholderLeaseFor?: string;
}) {
  const router = useRouter();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const offerLease = usePlaceholderLeaseOffer();

  function run(approve: boolean) {
    setOutcome(null);
    startTransition(async () => {
      const result = await decideApproval(requestId, approve, approve ? undefined : reason);
      setOutcome(result);
      if (approve && result.status === "ok" && placeholderLeaseFor) {
        offerLease?.({ fundingRequestId: placeholderLeaseFor, label });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
      ) : null}
      {outcome?.status === "ok" ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(true)}
              className="h-8 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid hover:bg-accent-800 disabled:opacity-50"
            >
              {busy && !denying ? "Approving…" : compact ? `Approve ${amount}` : `Approve ${label} at ${amount}`}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={denying}
              onClick={() => setDenying(!denying)}
              className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              Deny…
            </button>
          </div>
          {denying ? (
            <div className="flex flex-col gap-2 rounded-well bg-row-alt p-3">
              <label className="flex flex-col gap-[2px]">
                <span className="text-micro uppercase text-ink-muted">
                  Why — this goes back to {requestedBy}
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  className="w-full min-w-0 resize-none rounded-well border-0 bg-sunken px-2 py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
                  placeholder="What would need to change for a yes"
                />
              </label>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => run(false)}
                className="h-8 self-start rounded-pill bg-destructive px-4 text-pill text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "Denying…" : `Deny ${label}`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
