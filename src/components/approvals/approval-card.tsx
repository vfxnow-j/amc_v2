import type { ApprovalRecordType } from "@/generated/prisma/client";
import { Card } from "@/components/record/record-card";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { approvalPanel, type ApprovalRow } from "@/lib/approvals/core";
import { APPROVAL_STATUS_LABEL, APPROVAL_TYPE_NOUN } from "@/lib/approvals/labels";
import { dayYear, moneyExact } from "@/lib/format";
import type { SessionUser } from "@/lib/roles";

/**
 * Where a record stands with approval, on the record itself.
 *
 * Plain sentences, because the question a person opens this card with is "can
 * this go out, and if not, who is it waiting on" — Pending approval by…,
 * Approved by X on date, Denied by X: reason. The decision controls appear only
 * for someone who approves this type and did not raise the request; the server
 * checks both again when they press.
 *
 * Below the headline, every ask and answer this record has had, newest first.
 * Decided rows never change, so this is the trail as it was decided.
 */
export async function ApprovalCard({
  type,
  id,
  viewer,
  act,
  decideHere = true,
  quietWhenUnrecorded = false,
}: {
  type: ApprovalRecordType;
  id: string;
  viewer: SessionUser | null;
  /** What approval releases, as a verb phrase: "submitting it to the vendor". */
  act: string;
  /**
   * False where the record's own controls carry the decision — a funding
   * request's Approve and Decline are lifecycle steps, so they sit there.
   */
  decideHere?: boolean;
  /**
   * Render nothing for a record that went out before approvals and has no
   * history — an order record is shown for years after it was quoted, and a
   * card saying "not recorded" on every one of them is noise.
   */
  quietWhenUnrecorded?: boolean;
}) {
  const panel = await approvalPanel(type, id, viewer);
  if (!panel) return null;
  if (quietWhenUnrecorded && panel.standing === "none" && (panel.released || panel.closed)) {
    return null;
  }

  const noun = APPROVAL_TYPE_NOUN[type];
  const current = panel.current;

  return (
    <Card
      title="Approval"
      meta={
        panel.standing === "none"
          ? panel.released
            ? "not recorded"
            : "not yet asked"
          : panel.standing === "stale"
            ? "needs approving again"
            : APPROVAL_STATUS_LABEL[current!.status].toLowerCase()
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-body text-balance">
          <Headline panel={panel} noun={noun} act={act} viewerId={viewer?.id ?? null} />
        </p>

        {decideHere && panel.standing === "pending" && current && panel.viewerCanDecide ? (
          <ApprovalDecision
            requestId={current.id}
            label={panel.label}
            amount={moneyExact(panel.amount)}
            requestedBy={current.requestedByName}
          />
        ) : null}

        {panel.history.length > 0 ? (
          <ol className="flex flex-col gap-px border-t border-hairline pt-2">
            {panel.history.map((row) => (
              <HistoryRow key={row.id} row={row} />
            ))}
          </ol>
        ) : null}
      </div>
    </Card>
  );
}

function Headline({
  panel,
  noun,
  act,
  viewerId,
}: {
  panel: NonNullable<Awaited<ReturnType<typeof approvalPanel>>>;
  noun: string;
  act: string;
  viewerId: string | null;
}) {
  const current = panel.current;
  const amount = moneyExact(panel.amount);

  switch (panel.standing) {
    case "pending": {
      const askedByViewer = current!.requestedById === viewerId;
      const waitingOn =
        panel.approverNames.length === 0
          ? "nobody yet — a super admin tags approvers in Settings → Users"
          : panel.approverNames.join(", ");
      return (
        <>
          <strong>Pending approval by {waitingOn}.</strong>{" "}
          <span className="text-ink-muted">
            Asked by {askedByViewer ? "you" : current!.requestedByName} on{" "}
            {dayYear(current!.requestedAt)} at {moneyExact(current!.amountAtRequest)}.{" "}
            {sentence(act)} is held until one of them says yes.
            {askedByViewer && panel.viewerApproves
              ? " You approve these too, but not a request you raised."
              : ""}
          </span>
        </>
      );
    }
    case "approved":
      return current!.automatic ? (
        <>
          <strong>
            Cleared by {current!.decidedByName} on {dayYear(current!.decidedAt!)} at{" "}
            {moneyExact(current!.amountAtDecision!)}.
          </strong>{" "}
          <span className="text-ink-muted">
            {current!.decidedByName} approves {noun}s, so their own went straight through — no
            second person was asked.
          </span>
        </>
      ) : (
        <strong>
          Approved by {current!.decidedByName} on {dayYear(current!.decidedAt!)} at{" "}
          {moneyExact(current!.amountAtDecision!)}.
        </strong>
      );
    case "stale":
      return (
        <>
          <strong>
            Approved at {moneyExact(current!.amountAtDecision!)}, and it now comes to {amount}.
          </strong>{" "}
          <span className="text-ink-muted">
            The new figure has not been approved, so {act} is held until it is asked for and
            given.
          </span>
        </>
      );
    case "denied":
      return (
        <>
          <strong>
            Denied by {current!.decidedByName} on {dayYear(current!.decidedAt!)}:
          </strong>{" "}
          “{current!.reason}”{" "}
          <span className="text-ink-muted">Change what it asks for, then ask again.</span>
        </>
      );
    default:
      return panel.released ? (
        <span className="text-ink-muted">
          This {noun} went out before approvals were recorded, so it is not held. Changing its
          money from here on sends it for approval.
        </span>
      ) : (
        <span className="text-ink-muted">
          Nobody has been asked yet. {sentence(act)} asks an approver first — unless whoever
          does it approves {noun}s themselves, in which case it goes straight through.
        </span>
      );
  }
}

function sentence(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function HistoryRow({ row }: { row: ApprovalRow }) {
  const decided = row.status === "APPROVED" || row.status === "DENIED";
  return (
    <li className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-baseline gap-2 rounded-row py-1 text-detail">
      <span className="text-ink-muted">
        {row.automatic ? "Cleared" : APPROVAL_STATUS_LABEL[row.status]}
      </span>
      <span className="min-w-0">
        {decided && !row.automatic ? (
          <>
            {row.decidedByName}
            <span className="text-ink-muted"> · asked by {row.requestedByName}</span>
          </>
        ) : (
          row.requestedByName
        )}
        {row.reason ? <span className="block text-ink-muted">“{row.reason}”</span> : null}
        {row.note ? <span className="block text-ink-faint">{row.note}</span> : null}
      </span>
      <span className="text-right tabular-nums text-ink-muted">
        {moneyExact(row.amountAtDecision ?? row.amountAtRequest)}
        <span className="block text-ink-faint">{dayYear(row.decidedAt ?? row.requestedAt)}</span>
      </span>
    </li>
  );
}
