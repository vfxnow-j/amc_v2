"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bindLeadToOrder, convertLeadToReservation } from "@/lib/actions/leads";

/**
 * The two ways an enquiry stops being an enquiry.
 *
 * **Convert** creates the client if there isn't one, then a draft order, and
 * advances the lead to Quoted. It does *not* mark the lead Won — that happens
 * when the quote is approved, which is the order's business, not this screen's.
 *
 * **Bind** is the other outcome, and the reason `BOUND` exists: the caller
 * turns out to be a second contact on an account that already has an order
 * running. Binding adds them to that client as an associated contact and files
 * the enquiry against the order, rather than opening a duplicate account.
 *
 * Both are laid out side by side because choosing between them *is* the
 * decision — a convert button on its own quietly makes duplicate accounts the
 * default, which is how the three bound leads in this database got noticed.
 */

const TYPES = [
  { value: "RENTAL", label: "Rental" },
  { value: "SALE", label: "Sale" },
  { value: "RENT_TO_OWN", label: "Rent to own" },
  { value: "CLOUD", label: "Cloud" },
] as const;

function isoToday(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function LeadResolve({
  leadId,
  company,
  candidates,
  candidateTotal,
}: {
  leadId: string;
  company: string | null;
  candidates: { id: string; label: string }[];
  candidateTotal: number;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("RENTAL");
  const [start, setStart] = useState(isoToday());
  const [end, setEnd] = useState(isoToday(30));
  const [project, setProject] = useState(company ?? "");
  const [term, setTerm] = useState("24");
  const [bindTo, setBindTo] = useState("");

  function convert(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const outcome = await convertLeadToReservation(leadId, {
          startDate: start,
          endDate: end,
          projectName: project.trim() || undefined,
          reservationType: type,
          rtoTermMonths: type === "RENT_TO_OWN" ? Number(term) || undefined : undefined,
        });
        // Straight into the order it just made: the next thing anybody does is
        // put lines on it, and leaving them on the lead hides that it exists.
        router.push(`/dashboard/reservations/${outcome.reservation.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That didn't save.");
      }
    });
  }

  function bind(event: React.FormEvent) {
    event.preventDefault();
    if (!bindTo) return;
    setError("");
    startTransition(async () => {
      try {
        await bindLeadToOrder(leadId, bindTo);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That didn't save.");
      }
    });
  }

  const field =
    "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint";

  return (
    <div className="px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={convert}>
        <p className="mb-[6px] text-micro uppercase text-ink-muted">
          Turn it into an order
        </p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as (typeof TYPES)[number]["value"])
            }
            aria-label="Order type"
            className={field}
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="Project name"
            aria-label="Project name"
            className={field}
          />
          <label className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">Starts</span>
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
              className={field}
            />
          </label>
          <label className="flex flex-col gap-[2px]">
            <span className="text-micro uppercase text-ink-muted">Ends</span>
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
              className={field}
            />
          </label>
          {type === "RENT_TO_OWN" ? (
            <label className="col-span-2 flex flex-col gap-[2px]">
              <span className="text-micro uppercase text-ink-muted">
                Term, months
              </span>
              {/* Rent-to-own is financed on fixed instalments; without a term
                  the order's amortisation section has nothing to render. */}
              <input
                type="number"
                min={1}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className={field}
              />
            </label>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 w-full rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid disabled:opacity-50"
        >
          Create draft order
        </button>
        <p className="mt-1 text-detail text-ink-muted">
          Creates the account if they don&rsquo;t have one, opens a draft order,
          and moves the lead to Quoted. Pricing happens on the order.
        </p>
      </form>

      <form onSubmit={bind} className="mt-4 border-t border-hairline pt-4">
        <p className="mb-[6px] text-micro uppercase text-ink-muted">
          Or bind to an order they&rsquo;re already on
        </p>
        <select
          value={bindTo}
          onChange={(event) => setBindTo(event.target.value)}
          aria-label="Order to bind to"
          className={field}
        >
          <option value="">Pick an order…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !bindTo}
          className="mt-2 w-full rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover disabled:opacity-50"
        >
          Bind to this order
        </button>
        <p className="mt-1 text-detail text-ink-muted">
          {candidateTotal > candidates.length
            ? `${candidates.length} newest of ${candidateTotal} live orders. `
            : `All ${candidateTotal} live ${candidateTotal === 1 ? "order" : "orders"}. `}
          Adds them to that client as an associated contact instead of opening a
          second account.
        </p>
      </form>
    </div>
  );
}
