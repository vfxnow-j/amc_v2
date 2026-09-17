"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalRecordType } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { setApprovalScopes, type ScopeOutcome } from "@/lib/approvals/actions";
import {
  APPROVAL_TYPES,
  APPROVAL_TYPE_LABEL,
  APPROVAL_TYPE_RELEASES,
} from "@/lib/approvals/labels";

/**
 * Which record types this person approves (docs/procurement.md, Phase 6).
 *
 * The owner names the approvers — "say in accounting" — so only a super admin
 * can change this; everyone else who can open the account sees it read-only.
 * One approval is enough, so ticking a box makes this person a sufficient
 * answer on their own for that type, and their own records of that type stop
 * waiting for anyone. The detail under each box says what that releases.
 *
 * Client component: imports the labels module, never anything reaching Prisma.
 */
export function ApproverScopes({
  userId,
  name,
  role,
  scopes,
  canEdit,
}: {
  userId: string;
  name: string;
  role: string;
  scopes: ApprovalRecordType[];
  /** The viewer is a super admin. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ApprovalRecordType[]>(scopes);
  const [outcome, setOutcome] = useState<ScopeOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  if (role === "SUPER_ADMIN") {
    return (
      <p className="px-4 pb-4 text-body text-balance">
        <strong>Always an approver.</strong>{" "}
        <span className="text-ink-muted">
          A super admin decides purchase orders, funding requests and quotes without being
          tagged, and their own go straight through.
        </span>
      </p>
    );
  }

  if (role !== "ADMIN" && role !== "STAFF") {
    return (
      <p className="px-4 pb-4 text-body text-balance text-ink-muted">
        {role === "VIEWER" ? "Read-only accounts" : "Flow accounts"} cannot approve anything.
        Give {name} staff or admin access first if they should.
      </p>
    );
  }

  const dirty =
    chosen.length !== scopes.length || chosen.some((type) => !scopes.includes(type));

  function toggle(type: ApprovalRecordType) {
    setOutcome(null);
    setChosen((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-detail text-balance text-ink-muted">
        {canEdit
          ? `Tick what ${name} may approve. One approval is enough, nobody decides a request they raised, and anything of these types ${name} raises goes straight through.`
          : scopes.length === 0
            ? `${name} approves nothing, so their purchase orders, funding requests and quotes wait for an approver. Only a super admin can change this.`
            : `Only a super admin can change what ${name} approves.`}
      </p>
      <ul className="flex flex-col gap-2">
        {APPROVAL_TYPES.map((type) => (
          <li key={type}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(type)}
                disabled={!canEdit || busy}
                onChange={() => toggle(type)}
                className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)] disabled:opacity-60"
              />
              <span className="text-detail text-ink">
                {APPROVAL_TYPE_LABEL[type]}
                <span className="block text-micro text-ink-faint">
                  {APPROVAL_TYPE_RELEASES[type]}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() =>
            startTransition(async () => {
              const result = await setApprovalScopes(userId, chosen);
              setOutcome(result);
              if (result.status === "ok") router.refresh();
            })
          }
          className="h-8 self-start rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save approvals"}
        </button>
      ) : null}
    </div>
  );
}
