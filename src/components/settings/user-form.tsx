"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/generated/prisma/client";
import { deleteUser, updateUser } from "@/lib/actions/users";
import { inviteUser, reissueInvite, type InviteResult } from "@/lib/settings/invites";
import { ROLE_OPTIONS, isAdminLevel } from "@/lib/settings/roles";

/**
 * The two forms behind Settings → Users: invite somebody, and change somebody.
 *
 * They share the role picker, which is the part worth getting right — the
 * options carry what each role can actually do, because "Staff" and "Viewer"
 * mean nothing to whoever is filling this in. Admin-level roles are disabled
 * rather than hidden for a non-super-admin, so the limit is visible instead of
 * being discovered as a rejected save.
 *
 * Client components, so nothing here may import anything that reaches
 * `lib/prisma`. The actions do the real gating; these only avoid offering moves
 * that will be refused.
 */

function RolePicker({
  value,
  onChange,
  canSetAdmin,
  disabled,
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
  canSetAdmin: boolean;
  disabled?: boolean;
}) {
  const chosen = ROLE_OPTIONS.find((option) => option.value === value);

  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">Access</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as UserRole)}
        className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {ROLE_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={!canSetAdmin && isAdminLevel(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
      <span className="text-detail text-ink-muted">{chosen?.detail}</span>
      {!canSetAdmin ? (
        <span className="text-detail text-ink-faint">
          Only a super admin can grant or remove admin access.
        </span>
      ) : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

/**
 * What to show once an invite has been created.
 *
 * When outbound email is off — which is the standing state of this instance —
 * the setup link is the only thing that makes the new account usable, so it is
 * shown here and nowhere else. It is a one-time credential: the account is
 * still unusable until it is handed over, and the link stops working as soon as
 * it is used or 72 hours pass, whichever comes first.
 */
function InviteOutcome({ result }: { result: Extract<InviteResult, { status: "ok" }> }) {
  if (result.delivered) {
    return (
      <p className="rounded-well bg-accent-tint px-3 py-2 text-detail text-accent-on-tint">
        Invited {result.email}. They have 72 hours to set a password from the
        link in their inbox.
      </p>
    );
  }

  return (
    <div className="rounded-well bg-accent-tint px-3 py-2 text-detail text-accent-on-tint">
      <p className="mb-1">
        Account created for {result.email}, but{" "}
        <span className="font-bold">no email was sent</span> — outbound email is
        switched off on this instance. Send them this link yourself; it expires
        in 72 hours and stops working once used.
      </p>
      {result.setupUrl ? (
        <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
          {result.setupUrl}
        </code>
      ) : (
        <p>
          The setup link could not be read back. Open the account and reissue the
          invite.
        </p>
      )}
    </div>
  );
}

export function InviteForm({ canSetAdmin }: { canSetAdmin: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("STAFF");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Extract<InviteResult, { status: "ok" }> | null>(
    null,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.includes("@")) return;
    setError("");
    startTransition(async () => {
      const result = await inviteUser({ name, email, role });
      if (result.status === "error") setError(result.message);
      else {
        setDone(result);
        setName("");
        setEmail("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}
      {done ? <InviteOutcome result={done} /> : null}

      <TextField label="Name" value={name} onChange={setName} />
      <TextField
        label="Email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="off"
      />
      <RolePicker value={role} onChange={setRole} canSetAdmin={canSetAdmin} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim() || !email.includes("@")}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
        <Link
          href="/dashboard/settings/users"
          className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
        >
          Back to users
        </Link>
      </div>
    </form>
  );
}

export function UserEditor({
  user,
  canSetAdmin,
  isSelf,
}: {
  user: { id: string; name: string; email: string; role: string; active: boolean };
  canSetAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<UserRole>(user.role as UserRole);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [invite, setInvite] = useState<Extract<InviteResult, { status: "ok" }> | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A non-super-admin may not touch an admin-level account at all, in either
  // direction — `updateUser` refuses both, so the form doesn't pretend.
  const lockedRole = !canSetAdmin && isAdminLevel(user.role);

  const dirty =
    name !== user.name || email !== user.email || role !== user.role;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        await updateUser(user.id, { name, email, role });
        setSaved(true);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function reissue() {
    setError("");
    startTransition(async () => {
      const result = await reissueInvite(user.id);
      if (result.status === "error") setError(result.message);
      else setInvite(result);
    });
  }

  function remove() {
    setError("");
    startTransition(async () => {
      try {
        await deleteUser(user.id);
        router.push("/dashboard/settings/users");
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not delete the account.",
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          role="status"
          className="rounded-well bg-accent-tint px-3 py-2 text-detail text-accent-on-tint"
        >
          Saved.
        </p>
      ) : null}
      {invite ? <InviteOutcome result={invite} /> : null}

      <form onSubmit={save} className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Email" value={email} onChange={setEmail} type="email" />
        <RolePicker
          value={role}
          onChange={setRole}
          canSetAdmin={canSetAdmin}
          disabled={lockedRole}
        />
        <button
          type="submit"
          disabled={busy || !dirty}
          className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>

      {!user.active ? (
        <div className="rounded-well bg-sunken p-3">
          <p className="mb-2 text-detail text-ink-muted">
            This invite was never completed, so the account cannot sign in.
            Reissuing mints a fresh 72-hour link and cancels the old one.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={reissue}
            className="rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
          >
            Reissue invite
          </button>
        </div>
      ) : null}

      {isSelf ? (
        <p className="text-detail text-ink-faint">
          This is your own account. Change your password under My profile;
          deleting yourself is refused.
        </p>
      ) : (
        <div className="rounded-well bg-sunken p-3">
          <p className="mb-2 text-detail text-ink-muted">
            Deleting removes the account. What they did stays — audit entries,
            orders they prepared and check-outs they signed keep their name.
          </p>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
              >
                Yes, delete {user.name}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-pill bg-panel px-3 py-1 text-pill text-ink-muted hover:text-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-pill bg-panel px-3 py-1 text-pill text-destructive hover:bg-row-hover"
            >
              Delete account
            </button>
          )}
        </div>
      )}
    </div>
  );
}
