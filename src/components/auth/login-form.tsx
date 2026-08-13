"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FIELD_CLASS,
  LABEL_CLASS,
  PRIMARY_CLASS,
} from "@/components/auth/auth-shell";
import { Notice } from "@/components/feedback/notice";
import { validateCredentials } from "@/lib/actions/auth";
import { sendMfaOtp } from "@/lib/actions/mfa";
import { createAndSetMfaTrust } from "@/lib/actions/mfa-trust";

type Step = "credentials" | "method" | "code";
type MfaMethod = "email" | "totp";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Credentials, then MFA if the account has it. The flow is v1's — pre-validate
 * with `validateCredentials` so the MFA branch is known before NextAuth is
 * asked to sign in, then hand the code to the same credentials provider.
 *
 * v1's Google and Microsoft buttons are not rebuilt here. Both providers are
 * still registered in `lib/auth.ts`, but v2's OAuth env vars are deliberately
 * blank, so the buttons would render only to fail. Add them back alongside the
 * credentials they need.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [userId, setUserId] = useState("");
  const [methods, setMethods] = useState<MfaMethod[]>([]);
  const [method, setMethod] = useState<MfaMethod>("email");
  const [trustDevice, setTrustDevice] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Only relative paths — an absolute or protocol-relative callbackUrl would
  // let a crafted link bounce a freshly signed-in user off-site.
  const requested = searchParams.get("callbackUrl") ?? "/dashboard";
  const callbackUrl =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";
  const providerError = searchParams.get("error");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await validateCredentials(email, password);

      if (!result.success) {
        setError(result.error || "That email and password don’t match.");
        return;
      }

      if (result.mfaRequired) {
        if (result.userId) setUserId(result.userId);
        const available = (result.mfaMethods as MfaMethod[]) ?? ["email"];
        const preferred = (result.mfaDefault as MfaMethod) ?? "email";
        setMethods(available);
        setMethod(preferred);
        setStep("code");
        // validateCredentials already sent the email code when that's the
        // default, so the cooldown starts here rather than on a second send.
        if (preferred === "email") setCooldown(RESEND_COOLDOWN_SECONDS);
        return;
      }

      const signedIn = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signedIn?.error) {
        setError("That email and password don’t match.");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("Something went wrong signing in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        mfaCode: code,
        mfaMethod: method,
        redirect: false,
      });

      if (result?.error) {
        setError("That code didn’t verify. Check it and try again.");
        return;
      }

      if (trustDevice && userId) {
        await createAndSetMfaTrust(userId).catch(() => {});
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong verifying the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const resend = useCallback(async () => {
    if (cooldown > 0) return;
    try {
      await sendMfaOtp(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setError("");
    } catch {
      setError("Couldn’t send another code. Try again in a moment.");
    }
  }, [cooldown, email]);

  function back() {
    setStep("credentials");
    setCode("");
    setError("");
  }

  if (step === "method") {
    return (
      <>
        {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
        <fieldset className="mb-4">
          <legend className="mb-2 text-detail text-ink-muted">
            How would you like to verify?
          </legend>
          <div className="flex flex-col gap-2">
            {methods.map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-2 rounded-well px-3 py-[10px] text-body transition-colors ${
                  method === option ? "bg-accent-tint" : "bg-sunken"
                }`}
              >
                <input
                  type="radio"
                  name="mfa-method"
                  value={option}
                  checked={method === option}
                  onChange={() => setMethod(option)}
                  className="accent-[var(--color-accent-500)]"
                />
                {option === "totp"
                  ? "A code from your authenticator app"
                  : "A code emailed to you"}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className={PRIMARY_CLASS}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (method === "email") {
                await sendMfaOtp(email);
                setCooldown(RESEND_COOLDOWN_SECONDS);
              }
              setStep("code");
            } catch {
              setError("Couldn’t send the code. Try again in a moment.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Continue"}
        </button>

        <button
          type="button"
          onClick={back}
          className="mt-3 w-full text-detail text-ink-muted hover:text-ink"
        >
          ← Back
        </button>
      </>
    );
  }

  if (step === "code") {
    return (
      <>
        {error ? <Notice tone="error" className="mb-4">{error}</Notice> : null}
        <form onSubmit={submitCode}>
          <label htmlFor="mfa-code" className={LABEL_CLASS}>
            {method === "totp"
              ? "Code from your authenticator app"
              : "Code we emailed you"}
          </label>
          <input
            id="mfa-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            required
            disabled={busy}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, ""))
            }
            placeholder="000000"
            className={`${FIELD_CLASS} h-12 text-center text-[22px] font-bold tracking-[0.4em]`}
          />

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-detail text-ink-muted">
            <input
              type="checkbox"
              checked={trustDevice}
              disabled={busy}
              onChange={(event) => setTrustDevice(event.target.checked)}
              className="accent-[var(--color-accent-500)]"
            />
            Trust this browser for 30 days
          </label>

          <button
            type="submit"
            className={`${PRIMARY_CLASS} mt-4`}
            disabled={busy || code.length !== 6}
          >
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>
        </form>

        <div className="mt-3 flex items-center justify-between text-detail text-ink-muted">
          <button type="button" onClick={back} className="hover:text-ink">
            ← Back
          </button>
          <div className="flex gap-3">
            {method === "email" ? (
              <button
                type="button"
                onClick={resend}
                disabled={cooldown > 0}
                className="hover:text-ink disabled:opacity-60"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            ) : null}
            {methods.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  setStep("method");
                  setCode("");
                  setError("");
                }}
                className="hover:text-ink"
              >
                Use another method
              </button>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {error || providerError ? (
        <Notice tone="error" className="mb-4">
          {error || "That sign-in didn’t complete. Try again."}
        </Notice>
      ) : null}

      <form onSubmit={submitCredentials}>
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

        <div className="mt-4 mb-[6px] flex items-baseline justify-between">
          <label htmlFor="password" className="text-detail font-bold">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-detail text-accent-text hover:underline"
          >
            Forgot it?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD_CLASS}
        />

        <button type="submit" className={`${PRIMARY_CLASS} mt-5`} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </>
  );
}

export function LoginFormSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-[6px] h-3 w-12 rounded-row bg-sunken" />
      <div className="h-10 rounded-well bg-sunken" />
      <div className="mt-4 mb-[6px] h-3 w-20 rounded-row bg-sunken" />
      <div className="h-10 rounded-well bg-sunken" />
      <div className="mt-5 h-10 rounded-pill bg-sunken" />
    </div>
  );
}
