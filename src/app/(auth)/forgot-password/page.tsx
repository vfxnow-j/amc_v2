"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AuthShell,
  FIELD_CLASS,
  LABEL_CLASS,
  Notice,
  PRIMARY_CLASS,
  SECONDARY_CLASS,
} from "@/components/auth/auth-shell";
import { requestPasswordReset } from "@/lib/actions/password-reset";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset(email);
    } finally {
      // The action never says whether the address exists, and neither does the
      // screen — a different outcome here would enumerate accounts.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      blurb="We’ll email you a link to set a new one."
    >
      {sent ? (
        <>
          <Notice tone="ok">
            If an account uses {email || "that address"}, a reset link is on its
            way. It’s good for one hour.
          </Notice>
          <Link href="/login" className={SECONDARY_CLASS}>
            Back to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="email" className={LABEL_CLASS}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            disabled={busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@vfxnow.com"
            className={FIELD_CLASS}
          />
          <button type="submit" className={`${PRIMARY_CLASS} mt-5`} disabled={busy}>
            {busy ? "Sending…" : "Send the link"}
          </button>
          <p className="mt-3 text-center text-detail">
            <Link href="/login" className="text-ink-muted hover:text-ink">
              ← Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
