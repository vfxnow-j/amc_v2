"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/lib/actions/users";
import { validatePassword } from "@/lib/utils/password";

/**
 * Change your own password.
 *
 * The rules are checked here and again in `changePassword` — the client copy
 * exists so the five requirements are visible while you type rather than
 * arriving as a paragraph of errors after a round trip. `lib/utils/password` is
 * a pure module for exactly this reason; nothing in this file may reach
 * `lib/prisma`, which would drag the pg driver into the browser bundle.
 *
 * A successful change revokes every MFA trust token on the account, so the
 * form says so before you submit rather than after.
 */
export function PasswordForm() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const rules = validatePassword(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && rules.valid && !mismatch && confirm === next;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError("");
    setDone(false);
    startTransition(async () => {
      try {
        await changePassword(current, next);
        setCurrent("");
        setNext("");
        setConfirm("");
        setDone(true);
        router.refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not change password.",
        );
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p
          role="status"
          className="rounded-well bg-accent-tint px-3 py-2 text-detail text-accent-on-tint"
        >
          Password changed. Any device that was skipping the second factor will
          be asked again.
        </p>
      ) : null}

      <Field
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <Field
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
      />
      <Field
        label="New password again"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />

      {next.length > 0 && !rules.valid ? (
        <ul className="text-detail text-ink-muted">
          {rules.errors.map((rule) => (
            <li key={rule}>· {rule.replace("Password must ", "Must ")}</li>
          ))}
        </ul>
      ) : null}
      {mismatch ? (
        <p className="text-detail text-destructive">
          The two new passwords don&rsquo;t match.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !ready}
        className="mt-1 self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
      >
        {busy ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}
