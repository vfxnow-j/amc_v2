"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
} from "@/lib/clients/labels";
import {
  createLeadFromForm,
  type LeadCreateOutcome,
} from "@/lib/actions/leads";
import type { LeadSource, LeadStatus } from "@/generated/prisma/client";

/**
 * Recording an enquiry by hand.
 *
 * `createLead` had been ported since the migration and was reachable from no
 * screen, so every lead in v2 arrived from v1 or from a webhook — and the one
 * that arrives by phone, at a trade show, or from a friend of a friend had
 * nowhere to go. This is that screen.
 *
 * The name is the only thing required, for the same reason as the account form:
 * a lead is written down mid-conversation, and a form that demands a company
 * and an estimated value before it will take a name gets filled with rubbish or
 * skipped entirely.
 *
 * **Attribution is on the form.** The lead record has displayed campaign,
 * platform and cost-to-acquire since it was built, and nothing in v2 could set
 * them — so the only leads in this database carrying a cost are the ones v1
 * left behind. They are their own block rather than hidden behind the Ad
 * source, because a referral that came off a conference sponsorship has a cost
 * too, and a field that only appears for one source never gets filled in for
 * the others.
 *
 * A match is a question, not a refusal. `findMatchingLead` is the same dedupe
 * the website form and the JustCall webhook go through — email, then phone,
 * then name and company, then the same name inside a week — so keying in
 * somebody who already rang offers their record instead of opening a second
 * one. Two people at one company is real, so insisting is one click.
 *
 * A client component: nothing here may import anything that reaches
 * `lib/prisma`. The action does the gating and the validating; this only avoids
 * asking for what will be refused.
 */

const SOURCES = Object.keys(LEAD_SOURCE_LABEL) as LeadSource[];

/** The stages you can start a lead in. Won, Lost and Bound are outcomes, not
 *  starting points — they are reached from the record, with the reason. */
const STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED"];

const INPUT =
  "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-[6px] text-micro uppercase text-ink-muted">{label}</p>
      {children}
      {hint ? <p className="mt-1 text-micro text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function LeadForm({
  assignees,
  currentUserId,
}: {
  assignees: { id: string; name: string }[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<LeadCreateOutcome | null>(null);
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    email: "",
    phone: "",
    source: "PHONE" as LeadSource,
    channel: "",
    salesRep: "",
    status: "NEW" as LeadStatus,
    // Whoever is writing it down took the call, so it is theirs until somebody
    // says otherwise. An unowned live lead is the failure the list screen
    // exists to catch, and defaulting to nobody is how they get made.
    assignedToId: currentUserId ?? "",
    estimatedValue: "",
    notes: "",
    adCampaign: "",
    adPlatform: "",
    adCost: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  function submit(allowDuplicate = false) {
    startTransition(async () => {
      const result = await createLeadFromForm({
        name: form.name,
        companyName: form.companyName,
        email: form.email,
        phone: form.phone,
        source: form.source,
        channel: form.channel,
        salesRep: form.salesRep,
        status: form.status,
        assignedToId: form.assignedToId || undefined,
        estimatedValue:
          form.estimatedValue.trim() === ""
            ? undefined
            : Number(form.estimatedValue),
        notes: form.notes,
        adCampaign: form.adCampaign,
        adPlatform: form.adPlatform,
        adCost: form.adCost.trim() === "" ? undefined : Number(form.adCost),
        allowDuplicate,
      });
      setOutcome(result);
      if (result.status === "ok") router.push(`/dashboard/leads/${result.id}`);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
      className="flex max-w-2xl flex-col gap-3 rounded-card bg-panel p-4 shadow-sm"
    >
      {outcome?.status === "error" ? (
        <Notice tone="error">{outcome.message}</Notice>
      ) : null}

      {outcome?.status === "duplicate" ? (
        <Notice tone="error">
          {outcome.message}{" "}
          <Link
            href={`/dashboard/leads/${outcome.existing.id}`}
            className="underline"
          >
            Open it
          </Link>{" "}
          and add what is new there, or{" "}
          <button type="button" onClick={() => submit(true)} className="underline">
            record a separate lead anyway
          </button>
          .
        </Notice>
      ) : null}

      <Field label="Name" hint="Who rang, or who wrote in. The only thing required.">
        <input
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          autoFocus
          required
          placeholder="Jane Doe"
          className={INPUT}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company">
          <input
            value={form.companyName}
            onChange={(event) => set({ companyName: event.target.value })}
            placeholder="Where they work"
            className={INPUT}
          />
        </Field>
        <Field label="Email" hint="Also how a duplicate enquiry gets matched.">
          <input
            type="email"
            value={form.email}
            onChange={(event) => set({ email: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Phone">
          <input
            value={form.phone}
            onChange={(event) => set({ phone: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Estimated value" hint="Leave blank rather than guessing.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.estimatedValue}
            onChange={(event) => set({ estimatedValue: event.target.value })}
            className={`${INPUT} tabular-nums`}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source" hint="How they reached us.">
          <select
            value={form.source}
            onChange={(event) =>
              set({ source: event.target.value as LeadSource })
            }
            className={INPUT}
          >
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {LEAD_SOURCE_LABEL[source]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Came in through"
          hint="The entry point — a pricing page, a stand at NAB, an inbound call."
        >
          <input
            value={form.channel}
            onChange={(event) => set({ channel: event.target.value })}
            placeholder="Contact form"
            className={INPUT}
          />
        </Field>
        <Field label="Sales rep" hint="The name they were given, if any.">
          <input
            value={form.salesRep}
            onChange={(event) => set({ salesRep: event.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label="Owner" hint="Who is chasing it.">
          <select
            value={form.assignedToId}
            onChange={(event) => set({ assignedToId: event.target.value })}
            className={INPUT}
          >
            <option value="">Nobody yet</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Stage" hint="Where it starts. Won and Lost are recorded on the record itself.">
        <select
          value={form.status}
          onChange={(event) => set({ status: event.target.value as LeadStatus })}
          className={`${INPUT} sm:max-w-[calc(50%-6px)]`}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="rounded-well bg-sunken p-3">
        <legend className="px-1 text-micro uppercase text-ink-muted">
          Attribution
        </legend>
        <p className="mb-3 text-micro text-ink-faint">
          What this enquiry cost to get. The lead record shows these; until now
          nothing in the app could fill them in.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Campaign">
            <input
              value={form.adCampaign}
              onChange={(event) => set({ adCampaign: event.target.value })}
              placeholder="Q3 rentals"
              className={`${INPUT} bg-panel`}
            />
          </Field>
          <Field label="Platform">
            <input
              value={form.adPlatform}
              onChange={(event) => set({ adPlatform: event.target.value })}
              placeholder="Google Ads, Meta, LinkedIn"
              className={`${INPUT} bg-panel`}
            />
          </Field>
          <Field label="Cost to acquire">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.adCost}
              onChange={(event) => set({ adCost: event.target.value })}
              className={`${INPUT} bg-panel tabular-nums`}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
          rows={3}
          placeholder="What they asked for, and when they need it"
          className={`${INPUT} h-auto resize-none py-2`}
        />
      </Field>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          {busy ? "Saving…" : "Record lead"}
        </button>
        <Link
          href="/dashboard/leads"
          className="h-9 rounded-pill bg-sunken px-4 text-pill leading-9 text-ink hover:bg-row-hover"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
