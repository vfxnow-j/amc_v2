"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  getOnboardingLink,
  requestOnboarding,
  saveOnboardingLink,
  type OnboardOutcome,
  type OnboardingLinkState,
} from "@/lib/actions/leads";

/**
 * Ask somebody to onboard: an email address in, a link out.
 *
 * The address goes through `findMatchingLead` before anything else, so pressing
 * this on a caller who is already on file adds a touchpoint to their record
 * rather than opening a second one — the same dedupe the website form and the
 * JustCall webhook go through.
 *
 * It says **Request onboarding**, and it does not send a quote. The address has
 * not been verified by anyone, and a quote link is the whole rate card in
 * whatever inbox that address turns out to be; onboarding is what earns it.
 *
 * **The link is always shown, not only mailed.** `RESEND_API_KEY` is blank on
 * this instance, so the send reliably fails — `sendEmail` returns
 * `{success:false}` rather than throwing — and a dialog that closed on a green
 * tick would be lying every single time. So the outcome names the address, says
 * whether anything actually left, and puts the URL on screen to be copied.
 *
 * Where that URL points is a `Setting` row rather than an environment variable,
 * because the form is a hosted thing that moves and moving it should not mean a
 * redeploy. An admin can repoint it from inside this dialog: it is the only
 * screen in v2 that reads the row, and a setting nothing can write is how
 * `createLead` ended up unreachable for six months.
 *
 * A client component, so nothing here may import anything reaching
 * `lib/prisma`; the actions do the gating.
 */

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** What happened, once. Both branches name the address and show the link. */
function Outcome({
  result,
  onClose,
}: {
  result: Extract<OnboardOutcome, { status: "ok" }>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="ok">
        {result.delivered ? (
          <p>
            The onboarding form was emailed to {result.email}.
          </p>
        ) : (
          <>
            <p className="mb-1">
              {result.merged
                ? `Recorded against ${result.leadName}, but `
                : `${result.leadName} is on file, but `}
              <span className="font-bold">no email was sent</span> — outbound
              email is switched off on this instance. Send them this link
              yourself, or nothing reaches them.
            </p>
            <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
              {result.url}
            </code>
          </>
        )}
      </Notice>

      <p className="text-detail text-ink-muted">
        {result.merged
          ? "This matched an enquiry that was already here, so it was added to that record rather than opening a second one."
          : "A new lead was opened for them and assigned to you."}{" "}
        <Link
          href={`/dashboard/leads/${result.leadId}`}
          onClick={onClose}
          className="text-accent-text underline"
        >
          Open {result.leadName}
        </Link>
        .
      </p>

      <p className="text-detail text-ink-faint">
        No quote has been sent. The quote goes out once the form comes back —
        pricing does not go to an address nobody has verified.
      </p>
    </div>
  );
}

/** Repointing the form. Admin only, and only offered when it is. */
function LinkEditor({
  current,
  onSaved,
}: {
  current: string | null;
  onSaved: (url: string) => void;
}) {
  const [open, setOpen] = useState(!current);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-micro text-ink-faint underline hover:text-ink"
      >
        Change where the form link points
      </button>
    );
  }

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveOnboardingLink(value);
      if (result.status === "error") setError(result.message);
      else {
        onSaved(result.url);
        setOpen(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-well bg-sunken p-3">
      <p className="text-micro uppercase text-ink-muted">Onboarding form</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://…"
        className={`${INPUT} bg-panel`}
      />
      <p className="text-micro text-ink-faint">
        Wherever the form lives now. Stored as a setting, so moving the form is
        a change here rather than a deploy.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={save}
          className="h-8 rounded-pill bg-panel px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save link"}
        </button>
        {current ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-micro text-ink-faint underline hover:text-ink"
          >
            Leave it
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function OnboardButton({
  label = "Request onboarding",
  className,
}: {
  /** "Onboard" where the dashboard action bar puts it; the full phrase elsewhere. */
  label?: string;
  /** The caller owns how the trigger looks — the bar it sits in decides. */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [config, setConfig] = useState<OnboardingLinkState | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Extract<OnboardOutcome, { status: "ok" }> | null>(
    null,
  );

  function openDialog() {
    setOpen(true);
    setError("");
    setDone(null);
    startTransition(async () => {
      setConfig(await getOnboardingLink());
    });
  }

  function closeDialog(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmail("");
      setName("");
      setCompanyName("");
      setError("");
      setDone(null);
    }
  }

  function send() {
    if (!looksLikeEmail(email)) return;
    setError("");
    startTransition(async () => {
      const result = await requestOnboarding({ email, name, companyName });
      if (result.status === "ok") {
        setDone(result);
        router.refresh();
      } else {
        setError(result.message);
        if (result.status === "unconfigured") {
          setConfig((previous) =>
            previous
              ? { ...previous, url: null, canConfigure: result.canConfigure }
              : { url: null, canConfigure: result.canConfigure, emailConfigured: false },
          );
        }
      }
    });
  }

  const ready = looksLikeEmail(email) && !!config?.url;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={
          className ??
          "rounded-pill bg-panel px-4 py-2 text-pill text-ink shadow-sm transition-colors hover:bg-row-hover"
        }
      >
        {label}
      </button>

      <Modal
        open={open}
        onOpenChange={closeDialog}
        title="Request onboarding"
        blurb={
          done
            ? undefined
            : "They get the onboarding form. They do not get a quote — that follows once the form comes back."
        }
        footer={
          done ? (
            <ModalCancel>Done</ModalCancel>
          ) : (
            <>
              <ModalCancel />
              <ModalConfirm disabled={busy || !ready} onClick={send}>
                {busy ? "Working…" : "Send the form"}
              </ModalConfirm>
            </>
          )
        }
      >
        {done ? (
          <Outcome result={done} onClose={() => closeDialog(false)} />
        ) : (
          <div className="flex flex-col gap-3">
            {error ? <Notice tone="error">{error}</Notice> : null}

            {config && !config.emailConfigured ? (
              <Notice tone="ok">
                Outbound email is switched off on this instance, so nothing will
                be delivered. The link is shown here afterwards for you to pass
                on.
              </Notice>
            ) : null}

            <div>
              <p className="mb-[6px] text-micro uppercase text-ink-muted">
                Email
              </p>
              <input
                type="email"
                value={email}
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
                placeholder="them@studio.com"
                className={INPUT}
              />
              <p className="mt-1 text-micro text-ink-faint">
                Checked against the leads already here first — if they have
                rung before, this lands on their record instead of a new one.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-[6px] text-micro uppercase text-ink-muted">
                  Name
                </p>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Optional"
                  className={INPUT}
                />
              </div>
              <div className="min-w-0">
                <p className="mb-[6px] text-micro uppercase text-ink-muted">
                  Company
                </p>
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Optional"
                  className={INPUT}
                />
              </div>
            </div>

            {config?.canConfigure ? (
              <LinkEditor
                current={config.url}
                onSaved={(url) =>
                  setConfig((previous) =>
                    previous ? { ...previous, url } : previous,
                  )
                }
              />
            ) : config && !config.url ? (
              <Notice tone="error">
                No onboarding form has been set, so there is no link to send.
                An administrator sets it here.
              </Notice>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
