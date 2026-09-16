"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { linkToOrder } from "@/lib/actions/tracker";

/**
 * The confirm step for a conversion suggestion. Everything starts ticked —
 * the likely case is that the suggestion is right — and nothing is linked until
 * the button is pressed.
 */

type Item = { id: string; label: string; detail: string };

export function ConversionLink({
  reservationId,
  asks,
  conversations,
}: {
  reservationId: string;
  asks: Item[];
  conversations: Item[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set([...asks, ...conversations].map((item) => item.id)),
  );

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function group(title: string, items: Item[]) {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="mb-1 text-micro uppercase text-ink-muted">{title}</p>
        <ul className="flex flex-col gap-px">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-row px-1 py-1 text-detail hover:bg-row-hover">
                <input
                  type="checkbox"
                  checked={chosen.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="mt-[3px] flex-none accent-[var(--accent-solid)]"
                />
                <span className="min-w-0 break-words">
                  <span className="font-bold">{item.label}</span>
                  <span className="block text-ink-muted">{item.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-detail text-ink-muted">
        This account had these open when the order was made. Link the ones it answers — an ask becomes won with
        this order.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {group("Asks", asks)}
      {group("Buying conversations", conversations)}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy || chosen.size === 0}
          onClick={() => {
            setError("");
            startTransition(async () => {
              try {
                const result = await linkToOrder({
                  reservationId,
                  askIds: asks.filter((item) => chosen.has(item.id)).map((item) => item.id),
                  interactionIds: conversations.filter((item) => chosen.has(item.id)).map((item) => item.id),
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              } catch {
                setError("That didn't save.");
              }
            });
          }}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Link {chosen.size} to this order
        </button>
      </div>
    </div>
  );
}
