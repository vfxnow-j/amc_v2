"use client";

import { useState, useTransition } from "react";
import {
  setClientEmailApproved,
  setContactEmailApproved,
} from "@/lib/actions/email-approval";

/**
 * "Approved for email" on the account address or one contact. Mail to an
 * address is refused until this is on (lib/email/approval). Admins change it;
 * everyone else sees where it stands.
 */
export function EmailApprovalToggle({
  kind,
  id,
  approved,
  canEdit,
  hasEmail,
}: {
  kind: "client" | "contact";
  id: string;
  approved: boolean;
  canEdit: boolean;
  hasEmail: boolean;
}) {
  const [value, setValue] = useState(approved);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!hasEmail) return null;

  function change(next: boolean) {
    setError(null);
    start(async () => {
      try {
        await (kind === "client" ? setClientEmailApproved : setContactEmailApproved)(id, next);
        setValue(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not change it.");
      }
    });
  }

  return (
    <label
      className={`mt-1 flex items-center gap-2 text-micro ${
        value ? "text-accent-text" : "text-ink-faint"
      }`}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={!canEdit || busy}
        onChange={(event) => change(event.target.checked)}
        aria-label="Approved for email"
      />
      {value ? "Approved for email" : canEdit ? "Not approved for email" : "Not approved for email — ask an admin"}
      {error ? <span className="text-destructive">{error}</span> : null}
    </label>
  );
}
