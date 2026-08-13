"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStatus } from "@/generated/prisma/client";
import { addLeadActivity, assignLead, updateLeadStatus } from "@/lib/actions/leads";
import { Notice } from "@/components/feedback/notice";

/**
 * Working a lead: who owns it, where it is, and what just happened on it.
 *
 * All three write through `lib/actions/leads`, which records a `LeadActivity`
 * row for every one of them — so the timeline beside this panel is the audit
 * trail, not a separate optional log. That is also why nothing here writes
 * `Lead` directly.
 *
 * The ported actions throw rather than returning a result object, so every call
 * is wrapped: an unhandled rejection inside a transition would leave the panel
 * stuck busy with nothing on screen explaining why.
 */

const STATUS_MOVES: { status: LeadStatus; label: string; detail: string }[] = [
  { status: "CONTACTED", label: "Contacted", detail: "Someone has replied to them" },
  { status: "QUALIFIED", label: "Qualified", detail: "Real budget, real dates" },
  { status: "UNQUALIFIED", label: "Unqualified", detail: "Not business we can take" },
  { status: "LOST", label: "Lost", detail: "They went elsewhere" },
];

const ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;
const ACTIVITY_LABEL: Record<(typeof ACTIVITY_KINDS)[number], string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
};

export function LeadDesk({
  leadId,
  status,
  ownerId,
  owners,
  resolved,
}: {
  leadId: string;
  status: LeadStatus;
  ownerId: string | null;
  owners: { id: string; name: string | null }[];
  /** WON, BOUND, LOST and UNQUALIFIED are outcomes; the pipeline moves stop. */
  resolved: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>("NOTE");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

  function run(work: () => Promise<unknown>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        await work();
        after?.();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That didn't save.");
      }
    });
  }

  return (
    <div className="px-4 pb-4">
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}

      <label
        htmlFor="lead-owner"
        className="mb-[6px] block text-micro uppercase text-ink-muted"
      >
        Owner
      </label>
      <select
        id="lead-owner"
        value={ownerId ?? ""}
        disabled={busy}
        onChange={(event) =>
          run(() => assignLead(leadId, event.target.value || null))
        }
        className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.name ?? owner.id}
          </option>
        ))}
      </select>

      {resolved ? null : (
        <>
          <p className="mt-4 mb-[6px] text-micro uppercase text-ink-muted">
            Move it on
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUS_MOVES.filter((move) => move.status !== status).map((move) => (
              <button
                key={move.status}
                type="button"
                disabled={busy}
                title={move.detail}
                onClick={() => run(() => updateLeadStatus(leadId, move.status))}
                className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
              >
                {move.label}
              </button>
            ))}
          </div>
          {/* Won is deliberately absent. A lead becomes business by being
              converted into an order or bound to one, which is what the card
              below does — marking it Won by hand would claim revenue with no
              order behind it. */}
          <p className="mt-2 text-detail text-ink-muted">
            Won isn&rsquo;t a button. A lead becomes business by being turned
            into an order, or bound to one that already exists.
          </p>
        </>
      )}

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          run(
            () =>
              addLeadActivity(leadId, kind, title.trim(), detail.trim() || undefined),
            () => {
              setTitle("");
              setDetail("");
            },
          );
        }}
      >
        <p className="mb-[6px] text-micro uppercase text-ink-muted">
          Log what happened
        </p>
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as (typeof ACTIVITY_KINDS)[number])
            }
            aria-label="Kind of activity"
            className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
          >
            {ACTIVITY_KINDS.map((value) => (
              <option key={value} value={value}>
                {ACTIVITY_LABEL[value]}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Left a voicemail"
            aria-label="What happened"
            className="h-9 min-w-0 flex-1 rounded-well border-0 bg-sunken px-3 text-detail outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            Log
          </button>
        </div>
        <input
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="Anything worth remembering — optional"
          aria-label="Detail"
          className="mt-2 h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail outline-none placeholder:text-ink-faint"
        />
      </form>
    </div>
  );
}
