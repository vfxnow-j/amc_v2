"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { logInteraction } from "@/lib/actions/tracker";
import {
  BUSINESSES,
  BUSINESS_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  DIRECTIONS,
  DIRECTION_LABEL,
  INTENTS,
  INTENT_DEFAULT_STEP,
  INTENT_LABEL,
  NEXT_STEPS,
  NEXT_STEP_LABEL,
  REACHES,
  REACH_LABEL,
  RETRY_DAYS,
} from "@/lib/tracker/labels";

/**
 * The quick log: one conversation or attempt, graded on two axes.
 *
 * Grading proposes the next step from the spec's table — Curious follows up in
 * two weeks, Ready to buy sends a quote in two days — and the rep can change
 * either before saving. The server enforces the same rules, so this form only
 * makes them easy to follow, never the only thing following them.
 */

const field =
  "h-9 min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none disabled:opacity-50";
const label = "mb-1 block text-micro uppercase text-ink-muted";

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function QuickLog({
  target,
  contacts,
  openAsks,
}: {
  target: { clientId: string } | { leadId: string };
  contacts: { id: string; name: string }[];
  openAsks: number;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [business, setBusiness] = useState("VFXNOW");
  const [channel, setChannel] = useState("CALL");
  const [direction, setDirection] = useState("OUTBOUND");
  const [reach, setReach] = useState("CONNECTED");
  const [intent, setIntent] = useState("");
  const [nextStep, setNextStep] = useState("FOLLOW_UP");
  const [nextStepOn, setNextStepOn] = useState(isoInDays(7));
  const [occurredOn, setOccurredOn] = useState(isoInDays(0));
  const [contactId, setContactId] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const connected = reach === "CONNECTED";
  const clientId = "clientId" in target ? target.clientId : null;

  function chooseReach(value: string) {
    setReach(value);
    if (value !== "CONNECTED") {
      setIntent("");
      setNextStep("FOLLOW_UP");
      setNextStepOn(isoInDays(RETRY_DAYS));
    }
  }

  function chooseIntent(value: string) {
    setIntent(value);
    const preset = INTENT_DEFAULT_STEP[value as keyof typeof INTENT_DEFAULT_STEP];
    if (!preset) return;
    setNextStep(preset.step);
    if (preset.days !== null) setNextStepOn(isoInDays(preset.days));
  }

  function reset() {
    setIntent("");
    setSummary("");
    setNotes("");
    setCloseReason("");
    setContactId("");
    setOccurredOn(isoInDays(0));
    setReach("CONNECTED");
    setNextStep("FOLLOW_UP");
    setNextStepOn(isoInDays(7));
  }

  if (!open) {
    return (
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 w-full rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid"
        >
          Log a conversation
        </button>
      </div>
    );
  }

  return (
    <form
      className="mx-4 mb-3 flex flex-col gap-2 rounded-well bg-row-alt p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(async () => {
          try {
            const result = await logInteraction({
              ...target,
              business,
              channel,
              direction,
              reach,
              intent: connected ? intent || undefined : undefined,
              nextStep,
              nextStepOn: nextStep === "NONE" ? undefined : nextStepOn,
              occurredOn,
              contactId: contactId || undefined,
              summary,
              notes,
              closeReason: closeReason || undefined,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            reset();
            setOpen(false);
            router.refresh();
          } catch {
            setError("That didn't save.");
          }
        });
      }}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor="log-channel">How</label>
          <select id="log-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={`${field} w-full`}>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>{CHANNEL_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="log-business">For</label>
          <select id="log-business" value={business} onChange={(e) => setBusiness(e.target.value)} className={`${field} w-full`}>
            {BUSINESSES.map((value) => (
              <option key={value} value={value}>{BUSINESS_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="log-direction">Who started it</label>
          <select id="log-direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={`${field} w-full`}>
            {DIRECTIONS.map((value) => (
              <option key={value} value={value}>{DIRECTION_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="log-reach">Reached them?</label>
          <select id="log-reach" value={reach} onChange={(e) => chooseReach(e.target.value)} className={`${field} w-full`}>
            {REACHES.map((value) => (
              <option key={value} value={value}>{REACH_LABEL[value]}</option>
            ))}
          </select>
        </div>
      </div>

      {connected ? (
        <div>
          <span className={label}>How interested</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="How interested">
            {INTENTS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={intent === value}
                onClick={() => chooseIntent(value)}
                className={`rounded-pill px-3 py-1 text-pill ${
                  intent === value ? "bg-accent-tint font-bold text-accent-on-tint" : "bg-sunken text-ink hover:bg-row-hover"
                }`}
              >
                {INTENT_LABEL[value]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-detail text-ink-muted">
          An unanswered attempt needs no grade, only a retry date. Three in a row over two months, on an account
          already cold, marks it Dead.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor="log-next">Next step</label>
          <select id="log-next" value={nextStep} onChange={(e) => setNextStep(e.target.value)} className={`${field} w-full`}>
            {NEXT_STEPS.map((value) => (
              <option key={value} value={value}>{NEXT_STEP_LABEL[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="log-next-on">On</label>
          <input
            id="log-next-on"
            type="date"
            value={nextStepOn}
            disabled={nextStep === "NONE"}
            min={isoInDays(0)}
            onChange={(e) => setNextStepOn(e.target.value)}
            className={`${field} w-full`}
          />
        </div>
        <div>
          <label className={label} htmlFor="log-when">When it happened</label>
          <input
            id="log-when"
            type="date"
            value={occurredOn}
            max={isoInDays(0)}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={`${field} w-full`}
          />
        </div>
        {contacts.length ? (
          <div>
            <label className={label} htmlFor="log-contact">With</label>
            <select id="log-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={`${field} w-full`}>
              <option value="">Not recorded</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="One line — what happened"
        aria-label="Summary"
        maxLength={200}
        className={`${field} px-3 placeholder:text-ink-faint`}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Detail worth keeping — optional"
        aria-label="Notes"
        rows={3}
        className="min-w-0 rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
      />

      {intent === "NO_GO" && openAsks > 0 ? (
        <input
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder={`Why — closes ${openAsks} open ${openAsks === 1 ? "ask" : "asks"} as lost`}
          aria-label="Reason the open asks were lost"
          className={`${field} px-3 placeholder:text-ink-faint`}
        />
      ) : null}
      {intent === "NOT_NOW" && clientId ? (
        <p className="text-detail text-ink-muted">
          If they only book around events, an administrator can set their months on the Relationship card so the
          account rests between windows instead of going cold.
        </p>
      ) : null}
      {intent === "CURIOUS" || intent === "PROSPECTING" ? (
        <p className="text-detail text-ink-muted">Capture what they asked for under Asks, so it can be quoted and tracked.</p>
      ) : null}
      {intent === "READY_TO_BUY" && clientId ? (
        <p className="text-detail text-ink-muted">
          Log this, then{" "}
          <Link href={`/dashboard/orders/new?client=${clientId}`} className="text-accent-text hover:underline">
            start their order
          </Link>
          .
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !summary.trim() || (connected && !intent)}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Log it
        </button>
      </div>
    </form>
  );
}
