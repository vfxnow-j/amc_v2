"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/generated/prisma/client";
import {
  createApiKey,
  deleteApiKey,
  revokeApiKey,
} from "@/lib/actions/api-keys";
import { API_KEY_ROLES, ROLE_OPTIONS } from "@/lib/settings/roles";
import { Notice } from "@/components/feedback/notice";

/**
 * Issuing and withdrawing API keys.
 *
 * The rule the whole component is built around: a key is readable once, at the
 * moment it is created, and never again. The database holds a SHA-256 hash and
 * a twelve-character prefix, so there is no "show key" to offer later even if
 * somebody asks — losing it means issuing a new one. The panel says that before
 * the key appears rather than after it has scrolled away.
 *
 * Revoke and delete are kept apart. Revoking leaves the row, so the audit trail
 * still explains what that key did; deleting removes it, and the calls it made
 * lose their name. Revoke is the default and delete is the second click.
 */
export function ApiKeyConsole({ canDelete }: { canDelete: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("VIEWER");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(
    null,
  );

  function issue(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        const created = await createApiKey({
          name: name.trim(),
          role,
          expiresAt: expires || undefined,
        });
        setIssued({ name: name.trim(), key: created.rawKey });
        setName("");
        setExpires("");
        router.refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not issue the key.",
        );
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

      {issued ? (
        <div className="mb-3 rounded-well bg-accent-tint p-3 text-detail text-accent-on-tint">
          <p className="mb-1 font-bold">
            {issued.name} — copy this now, it is not shown again.
          </p>
          <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
            {issued.key}
          </code>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-2 rounded-pill bg-panel/60 px-3 py-1 text-pill"
          >
            I&rsquo;ve copied it
          </button>
        </div>
      ) : null}

      <form onSubmit={issue} className="flex flex-col gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">
            What it is for
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Bench rig — QC results"
            className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-[3px]">
            <span className="text-micro uppercase text-ink-muted">Access</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ROLE_OPTIONS.filter((option) =>
                API_KEY_ROLES.includes(option.value),
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-[3px]">
            <span className="text-micro uppercase text-ink-muted">
              Expires — optional
            </span>
            <input
              type="date"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
              className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        <p className="text-detail text-ink-muted">
          A key with no expiry stays valid until somebody revokes it. Give it one
          if it is for a one-off job.
        </p>

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Issuing…" : "Issue key"}
        </button>
      </form>

      {canDelete ? null : (
        <p className="mt-3 text-detail text-ink-faint">
          Deleting a key outright needs super admin. Revoking is enough to stop
          it working.
        </p>
      )}
    </div>
  );
}

/** Revoke or delete, rendered per row by the key table. */
export function ApiKeyRowActions({
  id,
  name,
  isActive,
  canDelete,
}: {
  id: string;
  name: string;
  isActive: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run(work: () => Promise<unknown>) {
    startTransition(async () => {
      await work();
      setConfirming(false);
      router.refresh();
    });
  }

  if (isActive) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => revokeApiKey(id))}
        className="text-accent-text hover:underline disabled:opacity-50"
      >
        Revoke
      </button>
    );
  }

  if (!canDelete) return <span className="text-ink-faint">Revoked</span>;

  return confirming ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => run(() => deleteApiKey(id))}
      className="text-destructive hover:underline disabled:opacity-50"
      title={`Delete ${name} and lose its name from the audit trail`}
    >
      Really delete
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-ink-muted hover:underline"
    >
      Delete
    </button>
  );
}
