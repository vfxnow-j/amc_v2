"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FIELD_CLASS,
  LABEL_CLASS,
  Notice,
  PRIMARY_CLASS,
  SECONDARY_CLASS,
} from "@/components/auth/auth-shell";
import { resetPassword } from "@/lib/actions/password-reset";

/** Matches `validatePassword` in lib/auth.ts — say the rule before it's broken. */
const RULE =
  "At least 8 characters, with an uppercase and a lowercase letter, a number and a symbol.";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <>
        <Notice tone="error">
          This link is missing its token, so it can’t be used. Reset links are
          single-use and expire after an hour — request a fresh one.
        </Notice>
        <Link href="/forgot-password" className={SECONDARY_CLASS}>
          Request a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <Notice tone="ok">
          Your password is set. Sign in with it now.
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
      const result = await resetPassword(token!, password);
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
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form onSubmit={submit}>
        <label htmlFor="password" className={LABEL_CLASS}>
          New password
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

        <button type="submit" className={`${PRIMARY_CLASS} mt-4`} disabled={busy}>
          {busy ? "Saving…" : "Save the password"}
        </button>
      </form>
    </>
  );
}
