"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { recordOnboarding, type RecordOnboardingOutcome } from "@/lib/actions/leads";

/**
 * The form came back. Somebody types what it said.
 *
 * This is the load-bearing half of the onboarding loop, not a fallback for the
 * webhook. Outbound email is off on this instance and the Zapier secret is
 * blank, so the form link is passed on by hand and the answers come back by
 * hand — over the phone, in a reply, as a PDF attachment. Without this button
 * nothing ever clears `prospectAt`, which means the quote being held can never
 * be approved and never be sent: the prospect path would be a one-way door.
 *
 * It is deliberately a small form and not a copy of the client record. What it
 * asks for is what an onboarding form asks for, and every field is optional,
 * because a form that will not accept a half-filled answer gets worked around
 * with a note nobody reads.
 *
 * **Filling blanks only** is the rule, and it is enforced on the server rather
 * than here — see `lib/leads/onboarding.ts`. The dialog's job afterwards is to
 * say plainly which fields it filled and which it left alone, so nobody has to
 * open the client record to find out whether their correction survived.
 *
 * A client component: the action does the gating and the writing.
 */

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

type Applied = Extract<RecordOnboardingOutcome, { status: "ok" }>;

function Field({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="min-w-0">
      <label className={LABEL}>
        {label}
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? "Optional"}
          className={`${INPUT} mt-[6px] normal-case`}
        />
      </label>
    </div>
  );
}

function Outcome({ result, onClose }: { result: Applied; onClose: () => void }) {
  const { applied } = result;

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="ok">{result.message}</Notice>

      {applied.requirements ? (
        <div className="rounded-well bg-sunken p-3">
          <p className="mb-1 text-detail text-ink-muted">
            Still outstanding:{" "}
            <span className="font-bold text-ink">
              {applied.requirements.types.join(", ")}
            </span>
            . A 30-day upload link was minted for them — it is the only copy,
            and nothing was emailed.
          </p>
          <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
            {applied.requirements.url}
          </code>
        </div>
      ) : (
        <p className="text-detail text-ink-muted">
          Nothing is outstanding on them — agreement, ID and COI are all either
          on file or waived.
        </p>
      )}

      <p className="text-detail text-ink-muted">
        <Link
          href={`/dashboard/clients/${applied.clientId}`}
          onClick={onClose}
          className="text-accent-text underline"
        >
          Open {applied.clientName}
        </Link>
        {applied.order ? (
          <>
            {" · "}
            <Link
              href={`/dashboard/orders/${applied.order.id}`}
              onClick={onClose}
              className="text-accent-text underline"
            >
              Open {applied.order.reservationNumber}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function RecordOnboarding({
  leadId,
  leadName,
  prospect,
  defaults,
}: {
  leadId: string;
  leadName: string;
  /** The account behind this lead is still a shell holding a quote. */
  prospect: boolean;
  defaults: {
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState<Applied | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState(defaults.name);
  const [companyName, setCompanyName] = useState(defaults.companyName ?? "");
  const [email, setEmail] = useState(defaults.email ?? "");
  const [phone, setPhone] = useState(defaults.phone ?? "");
  const [address, setAddress] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [notes, setNotes] = useState("");

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setDone(null);
      setError("");
    }
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await recordOnboarding(leadId, {
        name,
        companyName,
        email,
        phone,
        address,
        billingAddress,
        notes,
      });
      if (result.status === "ok") {
        setDone(result);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`h-8 rounded-pill px-3 text-pill ${
          prospect
            ? "bg-accent-solid text-accent-on-solid"
            : "bg-sunken text-ink hover:bg-row-hover"
        }`}
      >
        Record onboarding
      </button>

      <Modal
        open={open}
        onOpenChange={close}
        title="Record onboarding"
        blurb={
          done
            ? undefined
            : prospect
              ? `${leadName} is holding a quote against a provisional account. Recording their form makes the account real and releases the quote.`
              : "What their onboarding form said. Blank fields on the account are filled from this; anything already recorded is left alone."
        }
        footer={
          done ? (
            <ModalCancel>Done</ModalCancel>
          ) : (
            <>
              <ModalCancel />
              <ModalConfirm disabled={busy} onClick={submit}>
                {busy ? "Recording…" : "Record it"}
              </ModalConfirm>
            </>
          )
        }
      >
        {done ? (
          <Outcome result={done} onClose={() => close(false)} />
        ) : (
          <div className="flex flex-col gap-3">
            {error ? <Notice tone="error">{error}</Notice> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Company" value={companyName} onChange={setCompanyName} />
              <Field label="Email" type="email" value={email} onChange={setEmail} />
              <Field label="Phone" value={phone} onChange={setPhone} />
            </div>

            <Field label="Address" value={address} onChange={setAddress} />
            <Field
              label="Billing address"
              value={billingAddress}
              onChange={setBillingAddress}
              placeholder="Only if it differs"
            />
            <Field label="Anything they said" value={notes} onChange={setNotes} />

            <p className="text-micro text-ink-faint">
              Nothing here overwrites what is already on the account — a field
              somebody typed after speaking to them beats a field somebody typed
              into a web form. You will be told which ones were kept.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
