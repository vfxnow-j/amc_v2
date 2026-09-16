"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AskCategory, AskStatus, Business } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { createAsk, setAskStatus, type TrackerResult } from "@/lib/actions/tracker";
import {
  ASK_CATEGORIES,
  ASK_CATEGORY_LABEL,
  ASK_STATUSES,
  ASK_STATUS_LABEL,
  BUSINESSES,
  BUSINESS_LABEL,
  CLOSED_ASK_STATUSES,
} from "@/lib/tracker/labels";

/**
 * What an account has asked for — structured, so a can't-supply can later roll
 * into a demand report and an open ask can be matched to the order that
 * answers it.
 *
 * Takes plain rows, never a Prisma import beyond types: this is a client
 * component, and anything reaching `lib/prisma` breaks the build on `dns`.
 */

type Ask = {
  id: string;
  business: Business;
  category: AskCategory;
  description: string;
  quantity: number | null;
  status: AskStatus;
  lostReason: string | null;
};

const field =
  "h-8 min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none disabled:opacity-50";

export function AskList({
  target,
  asks,
  canEdit,
}: {
  target: { clientId: string } | { leadId: string };
  asks: Ask[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [business, setBusiness] = useState<string>("VFXNOW");
  const [category, setCategory] = useState<string>("WORKSTATION");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [losing, setLosing] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");

  function run(work: () => Promise<TrackerResult>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("That didn't save.");
      }
    });
  }

  if (asks.length === 0 && !canEdit) return null;

  return (
    <div className="px-4 pb-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-micro uppercase text-ink-muted">
          Asks
          {asks.length ? ` · ${asks.filter((a) => !CLOSED_ASK_STATUSES.includes(a.status)).length} open` : ""}
        </span>
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto rounded-pill bg-sunken px-3 py-[2px] text-pill text-ink hover:bg-row-hover"
          >
            Add ask
          </button>
        ) : null}
      </div>

      {error ? <Notice tone="error" className="mb-2">{error}</Notice> : null}

      {adding ? (
        <form
          className="mb-2 flex flex-col gap-2 rounded-well bg-row-alt p-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                createAsk({
                  ...target,
                  business,
                  category,
                  description,
                  quantity: quantity ? Number(quantity) : null,
                }),
              () => {
                setDescription("");
                setQuantity("");
                setAdding(false);
              },
            );
          }}
        >
          <div className="flex gap-2">
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} flex-1`}>
              {ASK_CATEGORIES.map((value) => (
                <option key={value} value={value}>{ASK_CATEGORY_LABEL[value]}</option>
              ))}
            </select>
            <select aria-label="For" value={business} onChange={(e) => setBusiness(e.target.value)} className={field}>
              {BUSINESSES.map((value) => (
                <option key={value} value={value}>{BUSINESS_LABEL[value]}</option>
              ))}
            </select>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Qty"
              aria-label="Quantity"
              className={`${field} w-14 placeholder:text-ink-faint`}
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What they asked for — e.g. 4× RTX 6000 nodes for a March show"
            aria-label="What they asked for"
            maxLength={500}
            className={`${field} px-3 placeholder:text-ink-faint`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
              Cancel
            </button>
            <button type="submit" disabled={busy || !description.trim()} className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50">
              Add
            </button>
          </div>
        </form>
      ) : null}

      {asks.length === 0 ? (
        <p className="text-detail text-ink-faint">Nothing asked for yet.</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {asks.map((ask) => {
            const closed = CLOSED_ASK_STATUSES.includes(ask.status);
            return (
              <li key={ask.id} className="rounded-row py-1 text-detail">
                <span className="flex items-center gap-2">
                  <span className="flex-none text-micro uppercase text-ink-faint">
                    {ASK_CATEGORY_LABEL[ask.category]}
                    {ask.business === "GPL" ? " · GPL" : ""}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${closed ? "text-ink-muted" : "font-bold"}`}>
                    {ask.quantity ? `${ask.quantity}× ` : ""}
                    {ask.description}
                  </span>
                  {canEdit ? (
                    <select
                      aria-label="Status"
                      value={losing === ask.id ? "LOST" : ask.status}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === "LOST") {
                          setLosing(ask.id);
                          setLostReason("");
                        } else {
                          setLosing(null);
                          run(() => setAskStatus(ask.id, next));
                        }
                      }}
                      className={`${field} h-7 flex-none`}
                    >
                      {ASK_STATUSES.map((value) => (
                        <option key={value} value={value}>{ASK_STATUS_LABEL[value]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="flex-none text-ink-muted">{ASK_STATUS_LABEL[ask.status]}</span>
                  )}
                </span>
                {ask.status === "LOST" && ask.lostReason && losing !== ask.id ? (
                  <span className="block text-ink-faint">Lost — {ask.lostReason}</span>
                ) : null}
                {losing === ask.id ? (
                  <form
                    className="mt-1 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(() => setAskStatus(ask.id, "LOST", lostReason), () => setLosing(null));
                    }}
                  >
                    <input
                      autoFocus
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      placeholder="Why was it lost?"
                      aria-label="Why it was lost"
                      className={`${field} flex-1 px-3 placeholder:text-ink-faint`}
                    />
                    <button type="button" onClick={() => setLosing(null)} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
                      Cancel
                    </button>
                    <button type="submit" disabled={busy || !lostReason.trim()} className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50">
                      Mark lost
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
