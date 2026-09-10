"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/record/record-card";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import {
  sendRequirementsRequest,
  waiveRequirement,
  type RequirementsOutcome,
} from "@/lib/actions/agreement";
import { dayYear } from "@/lib/format";

/**
 * The three things that gate shipping to an account — and, now, the two ways
 * to settle them.
 *
 * It rendered read-only until this point, which meant the whole requirements
 * layer was a report on a state nothing in v2 could change: `agreement.ts` had
 * been ported entire, `applyOnboardingToLead` had been minting 30-day tokens,
 * and the only screen that showed any of it could not ask for a document or
 * decide one was not needed.
 *
 * Two controls, and they are deliberately different weights. **Asking** is an
 * editor's job and mints a link to `/requirements/[token]`. **Waiving** is an
 * admin's, wants a reason, and is written to the audit log — it is the only
 * control here that makes a requirement go away rather than satisfying it, and
 * the question afterwards is always "who decided that, and why".
 *
 * A waived requirement is still shown as waived rather than as met. They are
 * different facts and collapsing them would hide exactly the thing somebody is
 * looking for.
 *
 * The agreement has no waiver, because there is no column for one and there
 * should not be: ID and insurance are checks on the customer, and the agreement
 * is the contract the hire happens under.
 */

export type RequirementsCardProps = {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  agreementSignedAt: Date | null;
  agreementSignerName: string | null;
  idVerifiedAt: Date | null;
  coiVerifiedAt: Date | null;
  skipIdRequirement: boolean;
  skipCoiRequirement: boolean;
  /** No template means nothing to sign — the ask has to say so up front. */
  hasTemplate: boolean;
  canRequest: boolean;
  canWaive: boolean;
};

type Kind = "ID" | "COI" | "AGREEMENT";

export function RequirementsCard(props: RequirementsCardProps) {
  const [open, setOpen] = useState<"request" | "waive-ID" | "waive-COI" | null>(
    null,
  );
  const [outcome, setOutcome] = useState<RequirementsOutcome | null>(null);

  const rows = [
    {
      kind: "AGREEMENT" as Kind,
      label: "Rental agreement",
      at: props.agreementSignedAt,
      by: props.agreementSignerName,
      waived: false,
    },
    {
      kind: "ID" as Kind,
      label: "ID verified",
      at: props.idVerifiedAt,
      by: null,
      waived: props.skipIdRequirement,
    },
    {
      kind: "COI" as Kind,
      label: "Insurance (COI)",
      at: props.coiVerifiedAt,
      by: null,
      waived: props.skipCoiRequirement,
    },
  ];

  const outstanding = rows.filter((row) => !row.at && !row.waived);

  return (
    <Card
      title="Requirements"
      meta={
        outstanding.length === 0
          ? "all settled"
          : `${outstanding.length} outstanding`
      }
      action={
        props.canRequest ? (
          <button
            type="button"
            onClick={() => {
              setOutcome(null);
              setOpen("request");
            }}
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
          >
            Ask for documents
          </button>
        ) : null
      }
    >
      <ul className="flex flex-col gap-px px-2 pb-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="truncate">
              {row.label}
              {row.by ? <span className="text-ink-faint"> · {row.by}</span> : null}
            </span>
            <span className="flex items-baseline gap-2">
              {row.at ? (
                <span className="tabular-nums text-ink-muted">
                  {dayYear(row.at)}
                </span>
              ) : row.waived ? (
                <span className="text-ink-faint">Waived</span>
              ) : (
                <span className="font-bold text-destructive">Outstanding</span>
              )}
              {props.canWaive && row.kind !== "AGREEMENT" && !row.at ? (
                <button
                  type="button"
                  onClick={() => {
                    setOutcome(null);
                    setOpen(row.kind === "ID" ? "waive-ID" : "waive-COI");
                  }}
                  className="text-micro text-ink-faint hover:text-ink hover:underline"
                >
                  {row.waived ? "Unwaive" : "Waive"}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {outcome ? (
        <div className="px-4 pb-3">
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>
            {outcome.message}
            {outcome.status === "ok" && outcome.url ? (
              <CopyLink url={outcome.url} />
            ) : null}
          </Notice>
        </div>
      ) : null}

      {open === "request" ? (
        <RequestDialog
          {...props}
          outstanding={outstanding.map((row) => row.kind)}
          onClose={() => setOpen(null)}
          onOutcome={(result) => {
            setOutcome(result);
            if (result.status === "ok") setOpen(null);
          }}
        />
      ) : null}

      {open === "waive-ID" || open === "waive-COI" ? (
        <WaiveDialog
          clientId={props.clientId}
          kind={open === "waive-ID" ? "ID" : "COI"}
          waived={open === "waive-ID" ? props.skipIdRequirement : props.skipCoiRequirement}
          onClose={() => setOpen(null)}
          onOutcome={(result) => {
            setOutcome(result);
            if (result.status === "ok") setOpen(null);
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * The link, shown whether or not the email left the building.
 *
 * `sendEmail` returns `{ success: false }` rather than throwing and outbound
 * mail is switched off in this instance, so a message that only said "sent"
 * would leave somebody watching an inbox nothing will ever reach. The link is
 * always here to be copied into whatever thread the client is already in.
 */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="mt-2 flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Requirements link"
        className="h-8 min-w-0 flex-1 rounded-well border-0 bg-sunken px-2 text-micro text-ink outline-none"
      />
      <button
        type="button"
        aria-label="Copy the requirements link"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="flex size-8 flex-none items-center justify-center rounded-well bg-sunken text-ink hover:bg-row-hover"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open it as the client sees it"
        className="flex size-8 flex-none items-center justify-center rounded-well bg-sunken text-ink hover:bg-row-hover"
      >
        <ExternalLink className="size-4" />
      </a>
    </span>
  );
}

const ASK_LABEL: Record<Kind, string> = {
  ID: "Photo ID (front and back)",
  COI: "Certificate of insurance",
  AGREEMENT: "Signed rental agreement",
};

function RequestDialog({
  clientId,
  clientEmail,
  hasTemplate,
  outstanding,
  onClose,
  onOutcome,
}: RequirementsCardProps & {
  outstanding: Kind[];
  onClose: () => void;
  onOutcome: (outcome: RequirementsOutcome) => void;
}) {
  const router = useRouter();
  // Pre-ticked to what is actually missing. Asking a client for a document they
  // sent last week reads as the app having lost it.
  const [picked, setPicked] = useState<Kind[]>(outstanding);
  const [email, setEmail] = useState(clientEmail ?? "");
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();

  function toggle(kind: Kind) {
    setPicked((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Ask for documents"
      blurb="Mints a link that works for 30 days. The client uploads on it — no login, and nothing else on their account is reachable through it."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            disabled={busy || picked.length === 0 || !email.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await sendRequirementsRequest(
                  clientId,
                  picked,
                  email.trim(),
                  message.trim() || undefined,
                );
                onOutcome(result);
                if (result.status === "ok") router.refresh();
              })
            }
          >
            {busy ? "Sending…" : "Send the link"}
          </ModalConfirm>
        </>
      }
    >
      <fieldset>
        <legend className="mb-2 text-micro uppercase text-ink-muted">
          What to ask for
        </legend>
        <div className="flex flex-col gap-2">
          {(["ID", "COI", "AGREEMENT"] as Kind[]).map((kind) => (
            <label key={kind} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={picked.includes(kind)}
                onChange={() => toggle(kind)}
                className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
              />
              <span className="text-detail text-ink">
                {ASK_LABEL[kind]}
                {kind === "AGREEMENT" && !hasTemplate ? (
                  <span className="block text-micro text-destructive">
                    There is no agreement template on this instance, so the
                    portal will tell them it is coming separately rather than
                    offering a signature box. Upload one in Settings →
                    Documents first.
                  </span>
                ) : !outstanding.includes(kind) ? (
                  <span className="block text-micro text-ink-faint">
                    Already settled — asking again is fine, but they will be
                    sending it twice.
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <span className="mb-1 block text-micro uppercase text-ink-muted">
          Email it to
        </span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Which address should get it"
          aria-label="Recipient address"
          className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none"
        />
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-micro uppercase text-ink-muted">
          A line of your own (optional)
        </span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          placeholder="Anything they should know — a deadline, which policy you need"
          className="w-full rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none"
        />
      </div>

      <p className="mt-3 border-t border-hairline pt-3 text-micro text-ink-faint">
        Outbound mail is off in this instance. The link comes back on this
        screen either way — copy it and send it however you normally would.
      </p>
    </Modal>
  );
}

const WAIVE_COPY = {
  ID: {
    noun: "photo ID",
    why: "They are a long-standing account, or the hire does not leave our premises.",
  },
  COI: {
    noun: "the certificate of insurance",
    why: "They are covered under a production's blanket policy we already hold.",
  },
} as const;

/**
 * Waiving, with the reason required.
 *
 * Admin-gated on the server as well as here — the button is simply not offered
 * to anyone else, and `waiveRequirement` refuses regardless. The reason goes to
 * the audit log rather than a notes field, because a waiver is a decision
 * somebody made on a date and that is what a log is for.
 */
function WaiveDialog({
  clientId,
  kind,
  waived,
  onClose,
  onOutcome,
}: {
  clientId: string;
  kind: "ID" | "COI";
  waived: boolean;
  onClose: () => void;
  onOutcome: (outcome: RequirementsOutcome) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, startTransition] = useTransition();

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={waived ? "Ask for it again" : `Waive ${WAIVE_COPY[kind].noun}`}
      blurb={
        waived
          ? "Puts the requirement back. The account reads as outstanding again until they send it."
          : "The account will read as settled without ever sending it. Every order for them from here on is approved and shipped on that basis."
      }
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            tone={waived ? "accent" : "danger"}
            disabled={busy || !reason.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await waiveRequirement(
                  clientId,
                  kind,
                  !waived,
                  reason.trim(),
                );
                onOutcome(result);
                if (result.status === "ok") router.refresh();
              })
            }
          >
            {busy ? "Saving…" : waived ? "Require it again" : "Waive it"}
          </ModalConfirm>
        </>
      }
    >
      <span className="mb-1 block text-micro uppercase text-ink-muted">
        Why
      </span>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        placeholder={WAIVE_COPY[kind].why}
        aria-label="Reason"
        className="w-full rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none"
      />
      <p className="mt-2 text-micro text-ink-faint">
        Required, and recorded against your name in the audit log. It is the
        first thing anyone asks about a waived requirement months later.
      </p>
    </Modal>
  );
}
