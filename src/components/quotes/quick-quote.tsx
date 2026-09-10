"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { lookupAssets, lookupClients } from "@/lib/actions/order-builder";
import { createProspectQuote, createQuickQuote } from "@/lib/actions/quick-quote";
import type { AssetAvailability } from "@/lib/queries/order-builder";
import type {
  ProspectQuoteOutcome,
  QuickQuoteOutcome,
} from "@/lib/quotes/contract";
import { SUBTOTAL_LABEL, estimateQuote } from "@/lib/quotes/estimate";
import { formatTermLength, periodUnitAbbrev } from "@/lib/pricing/periods";
import { Modal, ModalCancel } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

type Client = { id: string; name: string; companyName: string | null };

type Line = {
  assetId: string;
  name: string;
  quantity: number;
  rate: number;
  pricingType: string;
  /** Units free across the whole window when the line was added. */
  free: number;
};

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * A price against a client, in one dialog, in under a minute.
 *
 * The full builder at `/dashboard/orders/new` is a screen because it has to be:
 * substitutes, moving the window, four order types, a rent-to-own term. This is
 * the other half of the same job — somebody is on the phone, they want a
 * number, and losing the call to a page navigation is the actual failure mode.
 * So it reuses the builder's server side verbatim (`lookupClients`,
 * `lookupAssets`, and `createOrder` underneath `createQuickQuote`) and offers
 * only the parts of it you can answer while somebody is talking.
 *
 * Three deliberate absences, each of which would be a lie if included:
 *
 *  - **No total.** The figure is captioned `SUBTOTAL_LABEL` and nothing else.
 *    Tax is derived from the location of the first unit as the order is
 *    written, so this side of the wire genuinely cannot know it; the taxed
 *    total comes back in the outcome, from the saved order, and is shown in
 *    place of the estimate once it exists.
 *  - **No cadence toggle.** Two rate rules coexist in the app and disagree —
 *    `pickRate` in `queries/order-builder.ts` hands back a monthly figure and
 *    the unit it is quoted in, while `pricing/rates.ts` derives a ladder. Let a
 *    person flip a line to "weekly" here and the monthly number would keep its
 *    value under a `/wk` label: a roughly fourfold overcharge on a quote.
 *    Each line is priced in the unit the catalog quotes it in, full stop.
 *  - **No quote to a prospect.** Somebody who is not an account yet can be
 *    quoted — that is the second half of this dialog — but what leaves the
 *    building is the onboarding form, not the quote. A quote link is the whole
 *    rate card, and anyone can type anyone's address into a box. The quote is
 *    saved, held against a provisional account, and released once their form
 *    comes back.
 *
 * Rentals only. The other three order types each need a field this dialog does
 * not ask for.
 */
export function QuickQuote({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const today = new Date();

  const [start, setStart] = useState(iso(today));
  const [end, setEnd] = useState(iso(new Date(today.getTime() + 7 * 86_400_000)));
  const [projectName, setProjectName] = useState("");

  const [client, setClient] = useState<Client | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<Client[]>([]);

  const [assetQuery, setAssetQuery] = useState("");
  const [assetHits, setAssetHits] = useState<AssetAvailability[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  // Set when the person is quoting somebody who is not an account yet. Null is
  // the ordinary path; the two are never both live.
  const [prospect, setProspect] = useState<{
    email: string;
    name: string;
    companyName: string;
  } | null>(null);

  const [outcome, setOutcome] = useState<
    QuickQuoteOutcome | ProspectQuoteOutcome | null
  >(null);
  const [busy, startTransition] = useTransition();
  const typed = useRef(false);

  useEffect(() => {
    // Same shape as the builder's: clearing happens on the timer too, so the
    // effect never sets state synchronously and cascade-renders.
    const timer = setTimeout(() => {
      if (!clientQuery.trim()) setClientHits([]);
      else lookupClients(clientQuery).then(setClientHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [clientQuery]);

  useEffect(() => {
    if (!typed.current || !assetQuery.trim()) return;
    const timer = setTimeout(() => {
      lookupAssets(assetQuery, start, end).then(setAssetHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [assetQuery, start, end]);

  const estimate = estimateQuote(
    // A quick quote is always a plain rental: non-recurring, priced across the
    // whole window, which is exactly how `createReservation` will store it.
    { startDate: start, endDate: end, isRecurring: false },
    lines,
  );
  const short = lines.filter((line) => line.quantity > line.free);
  const datesValid = start < end;
  const named = prospect
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospect.email.trim())
    : Boolean(client);
  const ready = named && lines.length > 0 && datesValid;
  const done = outcome?.status === "ok";
  const sent = done && "onboardingUrl" in outcome ? outcome : null;

  function update(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function reset() {
    setClient(null);
    setProspect(null);
    setClientQuery("");
    setClientHits([]);
    setAssetQuery("");
    setAssetHits([]);
    setLines([]);
    setProjectName("");
    setOutcome(null);
    typed.current = false;
  }

  /** The lines, in the shape both actions take. */
  function draftLines() {
    return lines.map((line) => ({
      assetId: line.assetId,
      name: line.name,
      quantity: line.quantity,
      rate: line.rate,
      pricingType: line.pricingType,
      // Said out loud in the panel above, not decided silently: a line
      // asking for more than is free raises the flag ops already reads.
      ...(line.quantity > line.free ? { overbooked: true } : {}),
    }));
  }

  /** The prospect path. One button, and it never sends the quote. */
  function commitProspect() {
    if (!prospect) return;
    setOutcome(null);
    startTransition(async () => {
      const result = await createProspectQuote({
        email: prospect.email.trim(),
        name: prospect.name.trim() || undefined,
        companyName: prospect.companyName.trim() || undefined,
        start,
        end,
        projectName: projectName.trim() || undefined,
        lines: draftLines(),
      });
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  function commit(send: boolean) {
    setOutcome(null);
    startTransition(async () => {
      const result = await createQuickQuote({
        clientId: client?.id ?? "",
        start,
        end,
        projectName: projectName.trim() || undefined,
        send,
        lines: draftLines(),
      });
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Quick quote"
      blurb={
        done
          ? "Saved. The figures below are the order's own, read back after it was written."
          : prospect
            ? "A price for somebody who is not an account yet. It saves as a draft and is held — they get the onboarding form, not the quote."
            : "A price against a client you already have. It saves as an order, so nothing is quoted twice."
      }
      footer={
        done ? (
          <>
            <ModalCancel>Close</ModalCancel>
            <Link
              href={outcome.href}
              className="flex h-9 items-center rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid"
            >
              Open the order
            </Link>
          </>
        ) : prospect ? (
          <>
            <ModalCancel />
            <button
              type="button"
              disabled={busy || !ready}
              onClick={commitProspect}
              className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy ? "Working…" : "Hold quote · request onboarding"}
            </button>
          </>
        ) : (
          <>
            <ModalCancel />
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => commit(false)}
              className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              {busy ? "Working…" : "Create draft"}
            </button>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => commit(true)}
              className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy ? "Working…" : "Create and send"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-3">
          <Notice tone="ok">{outcome.message}</Notice>

          {sent ? (
            <>
              {sent.delivered ? (
                <p className="text-detail text-ink-muted">
                  The onboarding form went to {sent.email}.
                </p>
              ) : (
                <div className="rounded-well bg-sunken p-3">
                  <p className="mb-1 text-detail text-ink-muted">
                    Outbound email is switched off here, so{" "}
                    <span className="font-bold text-ink">
                      nothing reached {sent.email}
                    </span>
                    . Send them this form link yourself — the quote stays put
                    until it comes back.
                  </p>
                  <code className="block break-all rounded-row bg-panel/60 p-2 text-[11px] select-all">
                    {sent.onboardingUrl}
                  </code>
                </div>
              )}
              <p className="text-detail text-ink-muted">
                <Link
                  href={`/dashboard/leads/${sent.leadId}`}
                  className="text-accent-text underline"
                >
                  Open {sent.leadName}
                </Link>{" "}
                — record their onboarding there when it lands, and the quote can
                be sent and approved.
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {outcome?.status === "error" ? (
            <Notice tone="error">{outcome.message}</Notice>
          ) : null}

          {outcome?.status === "client-exists" ? (
            <Notice tone="error">
              <p className="mb-2">{outcome.message}</p>
              <button
                type="button"
                onClick={() => {
                  setClient(outcome.client);
                  setProspect(null);
                  setOutcome(null);
                }}
                className="h-8 rounded-pill bg-panel px-3 text-pill text-ink"
              >
                Quote {outcome.client.name} as a client
              </button>
            </Notice>
          ) : null}

          {prospect ? (
            <div className="flex flex-col gap-2 rounded-well bg-sunken p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-micro uppercase text-ink-muted">
                  Somebody new
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProspect(null);
                    setOutcome(null);
                  }}
                  className="text-micro text-ink-faint underline hover:text-ink"
                >
                  Back to clients
                </button>
              </div>

              <input
                type="email"
                value={prospect.email}
                autoFocus
                onChange={(event) =>
                  setProspect({ ...prospect, email: event.target.value })
                }
                placeholder="them@studio.com"
                aria-label="Their email"
                className={`${FIELD} bg-panel`}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={prospect.name}
                  onChange={(event) =>
                    setProspect({ ...prospect, name: event.target.value })
                  }
                  placeholder="Name (optional)"
                  aria-label="Their name"
                  className={`${FIELD} bg-panel`}
                />
                <input
                  value={prospect.companyName}
                  onChange={(event) =>
                    setProspect({ ...prospect, companyName: event.target.value })
                  }
                  placeholder="Company (optional)"
                  aria-label="Their company"
                  className={`${FIELD} bg-panel`}
                />
              </div>
              <p className="text-micro text-ink-faint">
                They get the onboarding form at this address. They do not get
                the quote — it is held against a provisional account until the
                form comes back, and cannot be approved or sent before then. If
                they have rung before, this lands on their existing lead.
              </p>
            </div>
          ) : (
          <div>
            <label className={LABEL} htmlFor="qq-client">
              Client
            </label>
            {client ? (
              <div className="flex items-center gap-2 rounded-well bg-sunken px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body">
                  {client.name}
                  {client.companyName ? (
                    <span className="text-ink-faint"> · {client.companyName}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setClient(null);
                    setClientQuery("");
                  }}
                  className="text-detail text-accent-text hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  id="qq-client"
                  value={clientQuery}
                  onChange={(event) => setClientQuery(event.target.value)}
                  placeholder="Search clients"
                  className={FIELD}
                />
                {clientHits.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-px rounded-well bg-sunken p-1">
                    {clientHits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClient(hit);
                            setClientHits([]);
                          }}
                          className="w-full truncate rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                        >
                          {hit.name}
                          {hit.companyName ? (
                            <span className="text-ink-faint"> · {hit.companyName}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {clientQuery.trim().length >= 2 && clientHits.length === 0 ? (
                  <div className="mt-1 rounded-well bg-sunken p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOutcome(null);
                        setProspect({
                          email: "",
                          // Whatever was typed into the search is a name far
                          // more often than it is a company, and retyping it is
                          // the sort of friction that loses the call.
                          name: clientQuery.trim(),
                          companyName: "",
                        });
                        setClientQuery("");
                        setClientHits([]);
                      }}
                      className="w-full rounded-row px-2 py-[6px] text-left text-detail text-accent-text hover:bg-row-hover"
                    >
                      No match — quote “{clientQuery.trim()}” as somebody new
                    </button>
                    <p className="px-2 pt-1 text-micro text-ink-faint">
                      Opens a lead, holds the quote against a provisional
                      account and asks them to onboard. Nothing priced is sent
                      to them. The full builder is at{" "}
                      <Link
                        href="/dashboard/orders/new"
                        className="text-accent-text hover:underline"
                      >
                        New order
                      </Link>
                      .
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} htmlFor="qq-start">
                Out
              </label>
              <input
                id="qq-start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="qq-end">
                Back
              </label>
              <input
                id="qq-end"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className={FIELD}
              />
            </div>
          </div>
          {datesValid ? null : (
            <Notice tone="error">The quote has to end after it starts.</Notice>
          )}

          <div>
            <span className={LABEL}>Equipment</span>
            <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
              <Search className="size-4 flex-none text-ink-faint" aria-hidden />
              <input
                value={assetQuery}
                onChange={(event) => {
                  typed.current = true;
                  setAssetQuery(event.target.value);
                }}
                placeholder="Search assets to add"
                aria-label="Search assets"
                className="w-full border-0 bg-transparent text-body outline-none placeholder:text-ink-faint"
              />
            </label>

            {assetHits.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-px rounded-well bg-sunken p-1">
                {assetHits.map((asset) => (
                  <li key={asset.assetId}>
                    <button
                      type="button"
                      onClick={() => {
                        setAssetQuery("");
                        setAssetHits([]);
                        setLines((current) => [
                          ...current,
                          {
                            assetId: asset.assetId,
                            name: asset.name,
                            quantity: 1,
                            rate: asset.rate,
                            pricingType: asset.pricingType,
                            free: asset.free,
                          },
                        ]);
                      }}
                      className="grid w-full grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                    >
                      <span className="truncate">
                        {asset.name}
                        <span
                          className={
                            asset.free > 0
                              ? " text-ink-faint"
                              : " text-accent-text"
                          }
                        >
                          {" "}
                          · {asset.free} of {asset.fleet} free
                        </span>
                      </span>
                      <span className="tabular-nums text-ink-muted">
                        {MONEY.format(asset.rate)}
                        <span className="text-ink-faint">
                          /{periodUnitAbbrev(asset.pricingType)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {lines.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {lines.map((line, index) => (
                <li
                  key={`${line.assetId}-${index}`}
                  className="grid grid-cols-[1fr_56px_88px_24px] items-center gap-2 rounded-bubble bg-row-alt px-2 py-[6px]"
                >
                  <span className="truncate text-detail">
                    {line.name}
                    <span className="text-ink-faint">
                      {" "}
                      · {MONEY.format(line.rate)}/
                      {periodUnitAbbrev(line.pricingType)}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    aria-label={`Quantity of ${line.name}`}
                    onChange={(event) =>
                      update(index, {
                        quantity: Math.max(1, Number(event.target.value) || 1),
                      })
                    }
                    className="h-7 rounded-row border-0 bg-panel px-2 text-right text-detail tabular-nums outline-none"
                  />
                  <span className="text-right text-detail font-bold tabular-nums">
                    {MONEY.format(estimate.lineAmounts[index] ?? 0)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                    className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <label className={LABEL} htmlFor="qq-project">
              Project
            </label>
            <input
              id="qq-project"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Optional"
              className={FIELD}
            />
          </div>

          <div className="rounded-well bg-sunken px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-detail text-ink-muted">{SUBTOTAL_LABEL}</span>
              <span className="text-page-title text-[20px] tabular-nums">
                {MONEY.format(estimate.subtotal)}
              </span>
            </div>
            <p className="mt-1 text-micro text-ink-muted">
              {lines.length === 0
                ? "Nothing added yet."
                : `${lines.length} ${lines.length === 1 ? "line" : "lines"} priced across ${formatTermLength(start, end)}, ${DAY.format(new Date(start))} – ${DAY.format(new Date(end))}. Tax follows the location of the units and is worked out when the order is saved.`}
            </p>
          </div>

          {short.length > 0 ? (
            <Notice tone="ok">
              {short.length === 1
                ? `${short[0].name}: ${short[0].free} free across the window, ${short[0].quantity} asked for.`
                : `${short.length} lines ask for more than is free across the window.`}{" "}
              The quote still saves — a draft holds no stock — and ops is flagged
              to confirm cover before it is approved.
            </Notice>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
