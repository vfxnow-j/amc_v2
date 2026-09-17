"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import {
  addOption,
  chooseOption,
  copyOption,
  removeOption,
  renameOption,
  type OptionOutcome,
} from "@/lib/actions/order-options";
import { saveOptionAsTemplate } from "@/lib/actions/package-templates";
import type { OrderOption } from "@/lib/queries/packages";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The quote options on an order, as tabs above its lines.
 *
 * Each tab is one option the client can choose on the online quote; the one
 * marked "the order" is what the order is priced and fulfilled on until the
 * client approves another. Viewing an option is just the URL (`?option=`), so a
 * link to a specific option works and the lines card below reads the same.
 *
 * Editing stops where the ported actions stop it: once the order enters
 * fulfilment the options are fixed, and the bar shows them without controls.
 */
export function OrderOptions({
  reservationId,
  options,
  selectedId,
  editable,
}: {
  reservationId: string;
  options: OrderOption[];
  selectedId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "add" | "copy" | "rename">(null);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<OptionOutcome | { status: "ok"; message: string; href?: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const href = (id: string) => `/dashboard/orders/${reservationId}?option=${id}`;

  function run(action: () => Promise<OptionOutcome>, goTo?: (result: OptionOutcome) => string | null) {
    startTransition(async () => {
      const result = await action();
      setOutcome(result);
      if (result.status === "ok") {
        setMode(null);
        setName("");
        const next = goTo?.(result);
        if (next) router.push(next);
        else router.refresh();
      }
    });
  }

  function submitName(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === "add") {
      run(() => addOption(reservationId, trimmed), (r) => (r.status === "ok" && r.optionId ? href(r.optionId) : null));
    } else if (mode === "copy") {
      run(() => copyOption(reservationId, selected.id, trimmed), (r) => (r.status === "ok" && r.optionId ? href(r.optionId) : null));
    } else if (mode === "rename") {
      run(() => renameOption(reservationId, selected.id, trimmed));
    }
  }

  const multiple = options.length > 1;

  return (
    <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-micro uppercase text-ink-muted">
          {multiple ? `${options.length} options for the client` : "Quote option"}
        </span>
        <div role="tablist" aria-label="Quote options" className="flex flex-wrap gap-1">
          {options.map((option) => {
            const current = option.id === selected.id;
            return (
              <Link
                key={option.id}
                role="tab"
                aria-selected={current}
                href={href(option.id)}
                scroll={false}
                className={`flex items-center gap-2 rounded-pill px-3 py-1 text-pill transition-colors ${
                  current ? "bg-accent-tint text-accent-on-tint" : "bg-sunken text-ink hover:bg-row-hover"
                }`}
              >
                {option.isActive && multiple ? <Check className="size-3" aria-label="The order" /> : null}
                <span className="font-bold">{option.name}</span>
                <span className="tabular-nums opacity-80">{MONEY.format(option.subtotal)}</span>
                {option.rtoTermMonths ? <span className="opacity-70">{option.rtoTermMonths} mo</span> : null}
              </Link>
            );
          })}
        </div>

        {editable ? (
          <span className="ml-auto flex flex-wrap items-center gap-1">
            <IconButton label="New option" onClick={() => { setMode("add"); setName(""); setOutcome(null); }}>
              <Plus className="size-[13px]" aria-hidden /> New
            </IconButton>
            <IconButton label={`Copy ${selected.name}`} onClick={() => { setMode("copy"); setName(`${selected.name} copy`); setOutcome(null); }}>
              <Copy className="size-[13px]" aria-hidden /> Copy
            </IconButton>
            <IconButton label={`Rename ${selected.name}`} onClick={() => { setMode("rename"); setName(selected.name); setOutcome(null); }}>
              <Pencil className="size-[13px]" aria-hidden /> Rename
            </IconButton>
            {multiple && !selected.isActive ? (
              <IconButton
                label={`Remove ${selected.name}`}
                onClick={() => {
                  if (window.confirm(`Remove the option “${selected.name}” and its lines?`)) {
                    run(() => removeOption(reservationId, selected.id), () => `/dashboard/orders/${reservationId}`);
                  }
                }}
              >
                <Trash2 className="size-[13px]" aria-hidden /> Remove
              </IconButton>
            ) : null}
          </span>
        ) : null}
      </div>

      {mode ? (
        <form onSubmit={submitName} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id="option-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Option name, e.g. 4× RTX 5090 build"
            aria-label="Option name"
            className="h-8 min-w-0 flex-1 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50">
            {busy ? "Saving…" : mode === "add" ? "Add option" : mode === "copy" ? "Copy option" : "Rename"}
          </button>
          <button type="button" onClick={() => setMode(null)} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover">
            Cancel
          </button>
        </form>
      ) : null}

      {multiple || !selected.isActive ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-detail text-ink-muted">
          {selected.isActive ? (
            <span>
              <span className="font-bold text-ink">{selected.name}</span> is the order — its lines and total. The client
              can pick another on the online quote.
            </span>
          ) : (
            <>
              <span>
                Viewing <span className="font-bold text-ink">{selected.name}</span>, an alternative. The order is priced on{" "}
                {options.find((option) => option.isActive)?.name ?? "another option"}.
              </span>
              {editable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => chooseOption(reservationId, selected.id))}
                  className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
                >
                  Go ahead with this option
                </button>
              ) : null}
            </>
          )}
          {selected.lineCount > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveOptionAsTemplate(selected.id);
                  setOutcome(result.status === "ok" ? { status: "ok", message: result.message, href: result.href } : result);
                })
              }
              className="ml-auto text-accent-text hover:underline disabled:opacity-50"
            >
              Save to our packages
            </button>
          ) : null}
        </div>
      ) : null}

      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"} className="mt-2">
          {outcome.message}
          {"href" in outcome && outcome.href ? (
            <Link href={outcome.href} className="ml-2 text-accent-text hover:underline">
              Open →
            </Link>
          ) : null}
        </Notice>
      ) : null}
    </section>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-7 items-center gap-1 rounded-pill bg-sunken px-2 text-pill text-ink hover:bg-row-hover"
    >
      {children}
    </button>
  );
}
