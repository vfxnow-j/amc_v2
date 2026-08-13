"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FIELD_CLASS,
  LABEL_CLASS,
  PRIMARY_CLASS,
  SECONDARY_CLASS,
} from "@/components/auth/auth-shell";
import { Notice } from "@/components/feedback/notice";
import { setupAccount, validateSetupToken } from "@/lib/actions/users";

const RULE =
  "At least 8 characters, with an uppercase and a lowercase letter, a number and a symbol.";

/** The invited user's first sign-in: claim the account, set a password. */
export function SetupAccountForm() {
  const token = useSearchParams().get("token");

  // No token means nothing to check — start settled rather than flipping the
  // flag from inside the effect, which would cascade a second render.
  const [checking, setChecking] = useState(!!token);
  const [invited, setInvited] = useState<{ name: string; email: string } | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [enableMfa, setEnableMfa] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    validateSetupToken(token)
      .then((result) => {
        if (!live) return;
        if (result.valid) {
          setInvited({ name: result.name ?? "", email: result.email ?? "" });
        }
      })
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [token]);

  if (checking) {
    return (
      <div className="animate-pulse">
        <div className="h-10 rounded-well bg-sunken" />
        <div className="mt-4 h-10 rounded-well bg-sunken" />
      </div>
    );
  }

  if (!token || !invited) {
    return (
      <>
        <Notice tone="error" className="mb-4">
          This invitation has expired or has already been used. Ask an
          administrator to send a fresh one.
        </Notice>
        <Link href="/login" className={SECONDARY_CLASS}>
          Go to sign in
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <Notice tone="ok" className="mb-4">
          Your account is ready.
          {enableMfa
            ? " You’ll be asked for an emailed code the first time you sign in."
            : ""}
        </Notice>
        <Link href="/login" className={SECONDARY_CLASS}>
          Go to sign in
        </Link>
      </>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Those two don’t match — retype the confirmation.");
      return;
    }

    setBusy(true);
    try {
      const result = await setupAccount(token!, password, enableMfa);
      if (result.success) setDone(true);
      else setError(result.error || "That didn’t go through. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}

      <p className="mb-4 rounded-well bg-sunken px-3 py-2 text-detail">
        <span className="font-bold">{invited.name || invited.email}</span>
        <span className="block text-ink-muted">{invited.email}</span>
      </p>

      <form onSubmit={submit}>
        <label htmlFor="password" className={LABEL_CLASS}>
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD_CLASS}
        />

        <label htmlFor="confirm" className={`${LABEL_CLASS} mt-4`}>
          Type it again
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={busy}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={FIELD_CLASS}
        />

        <p className="mt-2 text-detail text-ink-muted">{RULE}</p>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-well bg-sunken px-3 py-[10px]">
          <input
            type="checkbox"
            checked={enableMfa}
            disabled={busy}
            onChange={(event) => setEnableMfa(event.target.checked)}
            className="mt-[3px] accent-[var(--color-accent-500)]"
          />
          <span className="text-detail">
            Ask for a code at sign-in
            <span className="block text-ink-muted">
              Emailed each time, unless you trust the browser for 30 days.
            </span>
          </span>
        </label>

        <button type="submit" className={`${PRIMARY_CLASS} mt-4`} disabled={busy}>
          {busy ? "Setting up…" : "Finish setup"}
        </button>
      </form>
    </>
  );
}
