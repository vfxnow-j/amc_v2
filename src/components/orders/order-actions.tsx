"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import type {
  BillingCycleType,
  ReservationStatus,
  ReservationType,
} from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { movesFor, type Move } from "@/lib/orders/lifecycle";
import {
  activateOrder,
  approveOrder,
  cancelOrder,
  completeOrder,
  createQuoteLink,
  invoiceOrder,
  loseOrder,
  prepareOrder,
  reviseOrder,
  saveBillingTerms,
  sendOrderQuote,
  shipOrder,
  type BillingTerms,
  type StageOutcome,
} from "@/lib/actions/order-stage";

/**
 * The controls that move an order along, on the order record.
 *
 * One component, not nine, because the moves share everything that is hard: the
 * busy state, the single result strip, the refresh after a write, and the rule
 * that a refusal from the server is shown verbatim rather than translated. Each
 * move differs only in which dialog it opens and what that dialog asks for.
 *
 * The status decides what is offered — see `lib/orders/lifecycle` — and the
 * server decides what is allowed. The two agree today; where they ever stop
 * agreeing, the server wins and says why, because it is the one holding the
 * transaction.
 *
 * Nothing here is optimistic. An order's stage is the thing the warehouse, the
 * billing run and the client portal all read, so it changes on the screen only
 * once it has changed in the database.
 */

export type OrderActionsProps = {
  id: string;
  status: ReservationStatus;
  type: ReservationType;
  clientEmail: string | null;
  clientPaymentTerms: number;
  staff: { id: string; name: string }[];
  terms: BillingTerms;
  /** Shown in the activate dialog so the cycle is confirmed against a figure. */
  total: number;
  /** What is still to be scanned out. Shipping is gated on it. */
  handover: {
    linesOutstanding: number;
    unitsOutstanding: number;
    nothingToScan: boolean;
  };
};

export function OrderActions(props: OrderActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Move | null>(null);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  const moves = movesFor(props.status, props.type);

  /** Every dialog commits through here, so they all behave the same way. */
  function run(work: () => Promise<StageOutcome>) {
    startTransition(async () => {
      const result = await work();
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(null);
        router.refresh();
      }
    });
  }

  const shared = { busy, run, onClose: () => setOpen(null), ...props };

  const { handover } = props;
  // Preparing *is* checking out — the scan well sits directly below this card,
  // and the order cannot ship until it is empty of work. Saying what is left
  // here means nobody has to infer it from the counts strip further up.
  const preparing = props.status === "PREPARING";
  const blocked = handover.unitsOutstanding > 0;

  return (
    <div className="flex flex-col gap-2">
      {preparing ? (
        <p className="text-detail text-balance text-ink-muted">
          {handover.nothingToScan
            ? "Nothing physical on this order to scan, so it can ship as soon as you say so."
            : blocked
              ? `${handover.unitsOutstanding} ${handover.unitsOutstanding === 1 ? "unit" : "units"} still to scan out across ${handover.linesOutstanding} ${handover.linesOutstanding === 1 ? "line" : "lines"}. Scan them below — it cannot ship until they are all out.`
              : "Everything is checked out. It can ship."}
        </p>
      ) : null}
      {moves.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {moves.map((spec) => {
            // Offering a button that the server will refuse is worse than not
            // offering it: the person scans nothing and learns nothing.
            const gated = spec.move === "ship" && blocked;
            return (
            <button
              key={spec.move}
              type="button"
              title={
                gated
                  ? `${handover.unitsOutstanding} units still to check out`
                  : spec.detail
              }
              disabled={busy || gated}
              onClick={() => {
                setOutcome(null);
                setOpen(spec.move);
              }}
              className={
                spec.primary
                  ? "h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
                  : "h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
              }
            >
              {spec.label}
            </button>
            );
          })}
        </div>
      )}

      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"}>
          {outcome.message}
          {outcome.status === "ok" && outcome.href ? (
            <>
              {" "}
              <Link href={outcome.href} className="underline">
                Open it
              </Link>
              .
            </>
          ) : null}
        </Notice>
      ) : null}

      {open === "send-quote" ? <SendQuoteDialog {...shared} /> : null}
      {open === "prepare" ? <PrepareDialog {...shared} /> : null}
      {open === "activate" ? <ActivateDialog {...shared} /> : null}
      {open === "ship" ? <ShipDialog {...shared} /> : null}
      {open === "approve" ? <ApproveDialog {...shared} /> : null}
      {open === "revise" ? <ReasonDialog {...shared} kind="revise" /> : null}
      {open === "lose" ? <ReasonDialog {...shared} kind="lose" /> : null}
      {open === "cancel" ? <ReasonDialog {...shared} kind="cancel" /> : null}
      {open === "complete" ? <CompleteDialog {...shared} /> : null}
    </div>
  );
}

type DialogProps = OrderActionsProps & {
  busy: boolean;
  run: (work: () => Promise<StageOutcome>) => void;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Send quote
// ---------------------------------------------------------------------------

/**
 * The quote goes out one of two ways and the dialog offers both, side by side.
 *
 * The link is minted the moment the dialog opens rather than on confirm,
 * because the common case in this business is pasting it into a thread the
 * client is already in — and a link you have to commit to a status change to
 * see is no use for that. Minting it also stamps the order's expiry, so what is
 * copied and what the order says expire on the same day.
 */
function SendQuoteDialog({ id, clientEmail, busy, run, onClose }: DialogProps) {
  const [emails, setEmails] = useState(clientEmail ?? "");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Minted once, when the dialog opens. In an effect and not during render:
  // minting writes a row and stamps the order's expiry, and React is entitled
  // to render a component twice — which would leave two tokens behind, one of
  // them for a link nobody was ever shown.
  useEffect(() => {
    let live = true;
    createQuoteLink(id).then((result) => {
      if (!live) return;
      if (result.status === "ok") setLink(result.url);
      else setLinkError(result.message);
    });
    return () => {
      live = false;
    };
  }, [id]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard still shows the link in a field
      // the person can select, so there is nothing to recover from.
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Send quote"
      blurb="Email the client a link to the online quote, or copy one to send yourself. Either way, confirming marks the quote as sent."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            disabled={busy}
            onClick={() => run(() => sendOrderQuote(id, { emails: [emails], message }))}
          >
            {busy ? "Sending…" : "Send quote"}
          </ModalConfirm>
        </>
      }
    >
      <Label>Quote link</Label>
      {linkError ? (
        <Notice tone="error">{linkError}</Notice>
      ) : (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link ?? "Minting a link…"}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Online quote link"
            className="h-9 min-w-0 flex-1 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            aria-label="Copy quote link"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-well bg-sunken text-ink hover:bg-row-hover disabled:opacity-50"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the quote as the client sees it"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-well bg-sunken text-ink hover:bg-row-hover"
            >
              <ExternalLink className="size-4" />
            </a>
          ) : null}
        </div>
      )}
      <p className="mt-1 text-micro text-ink-faint">
        The link expires with the quote. Opening it shows the client exactly what
        they would see.
      </p>

      <div className="mt-4">
        <Label>Email it to</Label>
        <input
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder="Separate several with commas — leave blank to send it yourself"
          aria-label="Recipient email addresses"
          className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
        />
        {clientEmail ? null : (
          <p className="mt-1 text-micro text-ink-faint">
            This client has no email address on file, so nothing is prefilled.
          </p>
        )}
      </div>

      <div className="mt-3">
        <Label>Note to include</Label>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          placeholder="Optional — goes in the body above the quote link"
          aria-label="Note to the client"
          className="w-full resize-none rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

/**
 * Handing the order to the floor.
 *
 * The person is named because "who has this order" is the question asked over
 * the radio twenty times a day, and it defaults to whoever is pressing the
 * button — an order flagged as preparing with nobody's name on it answers
 * nothing. Telling the client is offered here rather than as a separate act,
 * because the moment the kit starts being pulled is the moment worth telling
 * them about.
 */
function PrepareDialog({ id, clientEmail, staff, busy, run, onClose }: DialogProps) {
  const [preparedById, setPreparedById] = useState("");
  const [notify, setNotify] = useState(!!clientEmail);
  const [email, setEmail] = useState(clientEmail ?? "");

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Prepare order"
      blurb="Flags the order as being built, so it shows on the floor's queue and units can be scanned out against its lines."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            disabled={busy || (notify && !email.trim())}
            onClick={() =>
              run(() =>
                prepareOrder(id, {
                  preparedById: preparedById || undefined,
                  notifyEmail: notify ? email : undefined,
                }),
              )
            }
          >
            {busy ? "Starting…" : "Start preparing"}
          </ModalConfirm>
        </>
      }
    >
      <Label>Prepared by</Label>
      <select
        value={preparedById}
        onChange={(event) => setPreparedById(event.target.value)}
        aria-label="Who is preparing the order"
        className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
      >
        <option value="">Me</option>
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      <label className="mt-4 flex items-start gap-2">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Tell the client it is being prepared
          <span className="block text-micro text-ink-faint">
            Sends the order number and its dates. Nothing about pricing.
          </span>
        </span>
      </label>

      {notify ? (
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Where to send it"
          aria-label="Client notification address"
          className="mt-2 h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
        />
      ) : null}
    </Modal>
  );
}

/**
 * Shipping is the handover: the kit leaves the building and is the client's
 * problem until it comes back.
 *
 * Gated on everything being scanned out, and the gate is stated here as well as
 * enforced on the server — a shipped order with unscanned kit is a unit nobody
 * can find. Only lines with a unit to scan count: a service line or a delivery
 * charge has nothing to check out, and counting those meant an order carrying
 * one could never ship at all.
 *
 * Billing is offered here but not implied by shipping. They are different
 * facts — kit can be with a client for a week before the cycle starts, and a
 * cloud order bills without anything shipping — so activation stays a decision,
 * with its terms confirmed in its own dialog.
 */
function ShipDialog({ id, clientEmail, handover, busy, run, onClose }: DialogProps) {
  const [notify, setNotify] = useState(!!clientEmail);
  const [email, setEmail] = useState(clientEmail ?? "");
  const blocked = handover.unitsOutstanding > 0;

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Mark shipped"
      blurb="The kit leaves the building and is with the client from here. Everything has to be scanned out first."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            disabled={busy || blocked || (notify && !email.trim())}
            onClick={() => run(() => shipOrder(id, { notifyEmail: notify ? email : undefined }))}
          >
            {busy ? "Marking…" : "Mark shipped"}
          </ModalConfirm>
        </>
      }
    >
      {blocked ? (
        <Notice tone="error">
          {handover.unitsOutstanding}{" "}
          {handover.unitsOutstanding === 1 ? "unit is" : "units are"} still to be
          checked out across {handover.linesOutstanding}{" "}
          {handover.linesOutstanding === 1 ? "line" : "lines"}. Close this and
          scan them out first.
        </Notice>
      ) : (
        <p className="mb-3 text-detail text-ink-muted">
          {handover.nothingToScan
            ? "Nothing physical on this order, so there was nothing to scan."
            : "Everything on the order is checked out."}{" "}
          Once shipped it is with the client, and comes back through check-in.
        </p>
      )}

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Tell the client it is on its way
          <span className="block text-micro text-ink-faint">
            Sends the order number and its dates. Nothing about pricing.
          </span>
        </span>
      </label>
      {notify ? (
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-label="Client notification address"
          className="mt-2 h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none"
        />
      ) : null}

      <p className="mt-3 border-t border-hairline pt-3 text-micro text-ink-faint">
        Shipping does not start billing. Activate the order when the cycle
        should begin — kit is often with a client before it starts earning.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

/**
 * The moment the order starts earning, and the last one at which the cycle can
 * be got right.
 *
 * `runBillingCycle` only ever looks at orders that are ACTIVE, recurring and
 * have a `nextBillingDate` in the past — so an order activated on the wrong
 * cycle either bills the client on the wrong day or is never picked up at all,
 * silently. That is why the terms are in front of the person here instead of
 * buried in an edit screen: confirming activation is confirming the cycle.
 */
function ActivateDialog({ id, terms, total, clientPaymentTerms, type, busy, run, onClose }: DialogProps) {
  const [draft, setDraft] = useState<BillingTerms>(terms);
  const [invoiceNow, setInvoiceNow] = useState(draft.billingCycleType === "ONE_TIME");

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Activate order"
      blurb="Puts the order on the billing run and starts tracking its revenue. Check what it bills on before confirming — the run reads these, not the dates."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm
            disabled={busy}
            onClick={() => run(() => activateOrder(id, { terms: draft, invoiceNow }))}
          >
            {busy ? "Activating…" : "Activate"}
          </ModalConfirm>
        </>
      }
    >
      <BillingTermsFields
        value={draft}
        onChange={setDraft}
        total={total}
        clientPaymentTerms={clientPaymentTerms}
        type={type}
      />

      <label className="mt-4 flex items-start gap-2 border-t border-hairline pt-3">
        <input
          type="checkbox"
          checked={invoiceNow}
          disabled={draft.notBilled}
          onChange={(event) => setInvoiceNow(event.target.checked)}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Invoice the client now
          <span className="block text-micro text-ink-faint">
            {draft.notBilled
              ? "Not available — this order is marked not billed."
              : "Raises a draft invoice against the order. It is not sent until you send it."}
          </span>
        </span>
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The rest — one confirmation each
// ---------------------------------------------------------------------------

function ApproveDialog({ id, busy, run, onClose }: DialogProps) {
  const [force, setForce] = useState(false);
  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Mark approved"
      blurb="Records the client's yes and reserves the units on the order's lines."
      footer={
        <>
          <ModalCancel />
          <ModalConfirm disabled={busy} onClick={() => run(() => approveOrder(id, force))}>
            {busy ? "Approving…" : "Approve"}
          </ModalConfirm>
        </>
      }
    >
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Approve even if stock is short
          <span className="block text-micro text-ink-faint">
            The check counts available units per line. Tick this when the kit is
            coming from a sub-rental or a purchase order.
          </span>
        </span>
      </label>
    </Modal>
  );
}

const REASON_COPY = {
  revise: {
    title: "Request revision",
    blurb: "Pulls the order back so it can be repriced. The agreed rates stay on the lines — only the stage moves.",
    confirm: "Send back for revision",
    placeholder: "What needs to change",
    tone: "accent",
  },
  lose: {
    title: "Mark lost",
    blurb: "The client declined. The order stays on the record with its pricing, so what was quoted can be read back later.",
    confirm: "Mark lost",
    placeholder: "Why it was lost — price, timing, went elsewhere",
    tone: "danger",
  },
  cancel: {
    title: "Cancel order",
    blurb: "Calls the order off and releases any units held for it.",
    confirm: "Cancel order",
    placeholder: "Why it was canceled",
    tone: "danger",
  },
} as const;

function ReasonDialog({
  id,
  kind,
  busy,
  run,
  onClose,
}: DialogProps & { kind: "revise" | "lose" | "cancel" }) {
  const [reason, setReason] = useState("");
  const copy = REASON_COPY[kind];

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={copy.title}
      blurb={copy.blurb}
      footer={
        <>
          <ModalCancel>Never mind</ModalCancel>
          <ModalConfirm
            tone={copy.tone}
            disabled={busy}
            onClick={() =>
              run(() =>
                kind === "revise"
                  ? reviseOrder(id, reason)
                  : kind === "lose"
                    ? loseOrder(id, reason)
                    : cancelOrder(id, reason),
              )
            }
          >
            {busy ? "Working…" : copy.confirm}
          </ModalConfirm>
        </>
      }
    >
      <Label>Reason</Label>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        placeholder={copy.placeholder}
        aria-label="Reason"
        className="w-full resize-none rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
      />
      <p className="mt-1 text-micro text-ink-faint">
        Optional, and kept on the order&rsquo;s activity log rather than shown to the
        client.
      </p>
    </Modal>
  );
}

function CompleteDialog({ id, type, busy, run, onClose }: DialogProps) {
  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={type === "SALE" ? "Close order" : "Complete order"}
      blurb={
        type === "SALE"
          ? "Closes the sale out. Nothing is expected back."
          : "Closes the order out. Everything has to be checked back in first — the order refuses while anything is still out."
      }
      footer={
        <>
          <ModalCancel />
          <ModalConfirm disabled={busy} onClick={() => run(() => completeOrder(id))}>
            {busy ? "Closing…" : "Close it out"}
          </ModalConfirm>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Billing terms, shared between activation and the billing card
// ---------------------------------------------------------------------------

const CYCLES: { value: BillingCycleType; label: string; detail: string }[] = [
  { value: "ONE_TIME", label: "One time", detail: "A single charge for the whole term" },
  { value: "MONTHLY", label: "Monthly", detail: "On a chosen day of the month" },
  { value: "WEEKLY", label: "Weekly", detail: "On a chosen day of the week" },
  { value: "BI_WEEKLY", label: "Fortnightly", detail: "Every 14 days" },
  { value: "DAILY", label: "Daily", detail: "Every day" },
  { value: "CUSTOM", label: "Custom", detail: "Every N days" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What the order bills on: the cycle, what comes off, what goes on top.
 *
 * Shared rather than duplicated because these fields are asked twice — once on
 * activation, where they are confirmed, and once on the billing card, where
 * they are corrected. Two copies would drift, and the field that drifted would
 * be the one nobody noticed until an invoice came out wrong.
 */
export function BillingTermsFields({
  value,
  onChange,
  total,
  clientPaymentTerms,
  type,
}: {
  value: BillingTerms;
  onChange: (next: BillingTerms) => void;
  total: number;
  clientPaymentTerms: number;
  type: ReservationType;
}) {
  const set = (patch: Partial<BillingTerms>) => onChange({ ...value, ...patch });
  const recurring = value.billingCycleType !== "ONE_TIME";
  const cycle = CYCLES.find((option) => option.value === value.billingCycleType);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Bills</Label>
        <select
          value={value.billingCycleType}
          onChange={(event) => {
            const next = event.target.value as BillingCycleType;
            set({
              billingCycleType: next,
              isRecurring: next !== "ONE_TIME",
              billingCycleDays: next === "CUSTOM" ? (value.billingCycleDays ?? 30) : value.billingCycleDays,
            });
          }}
          aria-label="Billing cycle"
          className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
        >
          {CYCLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-micro text-ink-faint">
          {cycle?.detail}
          {type === "RENT_TO_OWN" && value.billingCycleType !== "MONTHLY"
            ? " · A rent-to-own is financed monthly; anything else will not match its installment schedule."
            : ""}
        </p>
      </div>

      {value.billingCycleType === "MONTHLY" ? (
        <NumberField
          label="Day of month"
          value={value.billingCycleDay}
          min={1}
          max={28}
          onChange={(next) => set({ billingCycleDay: next })}
          hint="1–28, so every month has one"
        />
      ) : null}

      {value.billingCycleType === "WEEKLY" ? (
        <div>
          <Label>Day of week</Label>
          <select
            value={value.billingCycleDay}
            onChange={(event) => set({ billingCycleDay: Number(event.target.value) })}
            aria-label="Day of week"
            className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {value.billingCycleType === "CUSTOM" ? (
        <NumberField
          label="Every N days"
          value={value.billingCycleDays ?? 30}
          min={1}
          max={365}
          onChange={(next) => set({ billingCycleDays: next })}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Discount</Label>
          <div className="flex gap-2">
            <select
              value={value.discountType ?? ""}
              onChange={(event) =>
                set({
                  discountType: (event.target.value || null) as BillingTerms["discountType"],
                  discountValue: event.target.value ? value.discountValue : 0,
                })
              }
              aria-label="Discount type"
              className="h-9 min-w-0 flex-1 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
            >
              <option value="">None</option>
              <option value="PERCENTAGE">%</option>
              <option value="FIXED">$</option>
            </select>
            <input
              inputMode="decimal"
              value={value.discountType ? value.discountValue : ""}
              disabled={!value.discountType}
              onChange={(event) => set({ discountValue: Number(event.target.value) || 0 })}
              aria-label="Discount value"
              className="h-9 w-[5.5rem] rounded-well border-0 bg-sunken px-3 text-detail tabular-nums text-ink outline-none disabled:opacity-50"
            />
          </div>
        </div>

        <NumberField
          label="Tax rate %"
          value={value.taxRate}
          min={0}
          max={100}
          step="0.01"
          onChange={(next) => set({ taxRate: next })}
        />
      </div>

      <NumberField
        label="Payment terms, days"
        value={value.paymentTerms ?? clientPaymentTerms}
        min={0}
        max={365}
        onChange={(next) => set({ paymentTerms: next })}
        hint={
          value.paymentTerms == null
            ? `Inherited from the client (${clientPaymentTerms} days) until you change it`
            : `The client's default is ${clientPaymentTerms} days`
        }
      />

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={value.notBilled}
          onChange={(event) => set({ notBilled: event.target.checked })}
          className="mt-[3px] size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        <span className="text-detail text-ink">
          Never invoice this order
          <span className="block text-micro text-ink-faint">
            For evaluations and goodwill kit. It still tracks units and revenue;
            no invoice is ever raised against it.
          </span>
        </span>
      </label>

      <p className="rounded-well bg-sunken px-3 py-2 text-micro text-ink-muted">
        {value.notBilled
          ? "Nothing will be billed against this order."
          : recurring
            ? `Recurring — ${MONEY.format(total)} is the order's value; each cycle raises its own invoice.`
            : `One charge of ${MONEY.format(total)} for the whole term.`}
      </p>
    </div>
  );
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-[6px] text-micro uppercase text-ink-muted">{children}</p>;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: string;
  hint?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail tabular-nums text-ink outline-none"
      />
      {hint ? <p className="mt-1 text-micro text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/**
 * Raise an invoice against the order, on the billing card.
 *
 * Separate from the stage bar because invoicing is not a stage: an active order
 * can be invoiced many times, and a completed one still can be when something
 * was billed late.
 */
export function InvoiceButton({
  id,
  notBilled,
  dueDays,
}: {
  id: string;
  notBilled: boolean;
  dueDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(dueDays);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        Create invoice
      </button>

      {outcome ? (
        <div className="px-4 pb-3">
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>
            {outcome.message}
            {outcome.status === "ok" && outcome.href ? (
              <>
                {" "}
                <Link href={outcome.href} className="underline">
                  Open it
                </Link>
                .
              </>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Create invoice"
          blurb={
            notBilled
              ? "This order is marked not billed, so nothing can be raised against it until that is cleared."
              : "Raises a draft invoice for everything on the order. It is not sent to the client until you send it."
          }
          footer={
            <>
              <ModalCancel />
              <ModalConfirm
                disabled={busy || notBilled}
                onClick={() =>
                  startTransition(async () => {
                    const result = await invoiceOrder(id, { dueDays: days });
                    setOutcome(result);
                    if (result.status === "ok") {
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {busy ? "Raising…" : "Create invoice"}
              </ModalConfirm>
            </>
          }
        >
          <NumberField
            label="Due in, days"
            value={days}
            min={0}
            max={365}
            onChange={setDays}
            hint="From today. Prefilled from the order's payment terms."
          />
        </Modal>
      ) : null}
    </>
  );
}

/** The billing card's edit control — the same fields, outside activation. */
export function EditBillingTerms({
  id,
  terms,
  total,
  clientPaymentTerms,
  type,
}: {
  id: string;
  terms: BillingTerms;
  total: number;
  clientPaymentTerms: number;
  type: ReservationType;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(terms);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(terms);
          setOutcome(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        Edit terms
      </button>

      {outcome && outcome.status === "error" ? (
        <div className="px-4 pb-3">
          <Notice tone="error">{outcome.message}</Notice>
        </div>
      ) : null}

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Billing terms"
          blurb="The cycle the billing run reads, and what comes off and goes on top. Saving reprices the order against them."
          footer={
            <>
              <ModalCancel />
              <ModalConfirm
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await saveBillingTerms(id, draft);
                    setOutcome(result);
                    if (result.status === "ok") {
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {busy ? "Saving…" : "Save terms"}
              </ModalConfirm>
            </>
          }
        >
          {outcome && outcome.status === "error" ? (
            <Notice tone="error" className="mb-3">
              {outcome.message}
            </Notice>
          ) : null}
          <BillingTermsFields
            value={draft}
            onChange={setDraft}
            total={total}
            clientPaymentTerms={clientPaymentTerms}
            type={type}
          />
        </Modal>
      ) : null}
    </>
  );
}
