"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { lookupAssets } from "@/lib/actions/order-builder";
import {
  addTemplateLine,
  deleteTemplate,
  removeTemplateLine,
  updateTemplate,
  updateTemplateLine,
  type TemplateOutcome,
} from "@/lib/actions/package-templates";
import { addDays, businessToday, toDateInput } from "@/lib/billing/calendar";
import type { AssetAvailability } from "@/lib/queries/order-builder";
import type { TemplateLine } from "@/lib/queries/packages";
import type { PricingType } from "@/generated/prisma/client";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };
const FIELD =
  "h-8 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

type Template = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  lines: TemplateLine[];
  totals: { byPeriod: { pricingType: string; amount: number }[]; once: number };
};

/**
 * Build one of our packages: its name, and its lines.
 *
 * A line's rate box is blank when the line follows the asset's current rate —
 * the figure shown beside it is what it would price at today. Typing a rate
 * pins it (a bundle price); clearing it goes back to following the asset.
 */
export function PackageEditor({ template }: { template: Template }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<TemplateOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");

  function run(action: () => Promise<TemplateOutcome>) {
    startTransition(async () => {
      const result = await action();
      setOutcome(result);
      if (result.status === "ok") {
        if (result.href && result.href !== `/dashboard/packages/${template.id}`) router.push(result.href);
        else router.refresh();
      }
    });
  }

  const detailsChanged = name.trim() !== template.name || description.trim() !== (template.description ?? "");

  return (
    <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[1.6fr_1fr]">
      <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
        <header className="flex items-baseline gap-2 px-4 pb-3">
          <h2 className="text-card-title">Lines</h2>
          <span className="text-detail text-ink-muted">
            {template.lines.length} {template.lines.length === 1 ? "line" : "lines"} ·{" "}
            {template.totals.byPeriod
              .map((t) => `${MONEY.format(t.amount)}/${PERIOD[t.pricingType] ?? t.pricingType.toLowerCase()}`)
              .join(" + ") || "nothing recurring"}
            {template.totals.once ? ` + ${MONEY.format(template.totals.once)} once` : ""} at current rates
          </span>
        </header>

        {template.lines.length === 0 ? (
          <p className="px-4 pb-3 text-body text-ink-muted">
            No lines yet. Search for an asset below — a workstation brings its recorded build with it when the package
            goes on a quote.
          </p>
        ) : (
          <ul className="flex flex-col gap-px px-2 pb-2">
            {template.lines.map((line) => (
              <LineRow key={line.id} line={line} busy={busy} run={run} />
            ))}
          </ul>
        )}

        <AddTemplateLine templateId={template.id} run={run} busy={busy} />
      </section>

      <div className="flex flex-col gap-3">
        <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
          <h2 className="text-card-title">Details</h2>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Name</span>
            <input id="template-name" value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} h-9 text-body`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Description</span>
            <input
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What it is for"
              className={`${FIELD} h-9 text-body`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !detailsChanged}
              onClick={() => run(() => updateTemplate(template.id, { name, description }))}
              className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
            >
              Save details
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => updateTemplate(template.id, { isActive: !template.isActive }))}
              className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              {template.isActive ? "Archive" : "Restore"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${template.name}? Orders it was loaded into keep their lines.`)) {
                  run(() => deleteTemplate(template.id));
                }
              }}
              className="ml-auto h-8 rounded-pill px-3 text-pill text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </section>

        <section className="rounded-card bg-panel p-4 text-detail text-ink-muted shadow-sm">
          <h2 className="mb-2 text-card-title text-ink">Using it</h2>
          On any quote, <span className="text-ink">Add a line</span> finds this package by name or by what&rsquo;s in it.
          Picking it adds every line to the option you&rsquo;re viewing, priced as shown here. To offer a client a choice,
          add a new option on the order first, then load a different package into each.
          <Link href="/dashboard/packages?view=clients" className="mt-2 block text-accent-text hover:underline">
            See what clients have taken →
          </Link>
        </section>

        {outcome ? (
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
        ) : null}
      </div>
    </div>
  );
}

function LineRow({
  line,
  busy,
  run,
}: {
  line: TemplateLine;
  busy: boolean;
  run: (action: () => Promise<TemplateOutcome>) => void;
}) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [rate, setRate] = useState(line.rate === null ? "" : String(line.rate));

  function save() {
    const q = Number(quantity);
    const r = rate.trim() === "" ? null : Number(rate);
    if (q === line.quantity && r === line.rate) return;
    run(() => updateTemplateLine(line.id, { quantity: q, rate: r }));
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_64px_120px_110px_24px] items-center gap-2 rounded-row px-2 py-[6px] text-detail odd:bg-row-alt">
      <span className="min-w-0">
        {line.assetId ? (
          <Link href={`/dashboard/assets/${line.assetId}`} className="block truncate font-bold hover:underline">
            {line.label}
          </Link>
        ) : (
          <span className="block truncate font-bold">{line.label}</span>
        )}
        <span className="block text-micro text-ink-faint">
          {line.kind === "asset" ? (line.rate === null ? "follows the asset's rate" : "package rate") : line.kind}
          {line.isOneTime ? " · one time" : ""}
        </span>
      </span>
      <input
        aria-label={`${line.label} quantity`}
        inputMode="numeric"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={save}
        className={`${FIELD} text-right tabular-nums`}
      />
      <input
        aria-label={`${line.label} rate`}
        inputMode="decimal"
        value={rate}
        placeholder={line.kind === "asset" ? `${line.effectiveRate.toFixed(2)}` : "rate"}
        onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={save}
        className={`${FIELD} text-right tabular-nums`}
      />
      <span className="text-right tabular-nums">
        {MONEY.format(line.effectiveRate * line.quantity)}
        <span className="text-ink-faint">{line.isOneTime ? " once" : `/${PERIOD[line.pricingType] ?? ""}`}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${line.label}`}
        onClick={() => run(() => removeTemplateLine(line.id))}
        className="text-ink-faint hover:text-destructive disabled:opacity-50"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function AddTemplateLine({
  templateId,
  run,
  busy,
}: {
  templateId: string;
  run: (action: () => Promise<TemplateOutcome>) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AssetAvailability[]>([]);
  const [chosen, setChosen] = useState<AssetAvailability | null>(null);
  const [quantity, setQuantity] = useState("1");
  const latest = useRef(0);
  // Availability isn't the point on a package — any window returns the rates.
  const start = toDateInput(businessToday());
  const end = toDateInput(addDays(businessToday(), 30));

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || chosen) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = await lookupAssets(needle, start, end);
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [query, chosen, start, end]);

  function add() {
    if (!chosen) return;
    run(() =>
      addTemplateLine(templateId, {
        assetId: chosen.assetId,
        quantity: Number(quantity) || 1,
        pricingType: chosen.pricingType as PricingType,
      }),
    );
    setChosen(null);
    setQuery("");
    setHits([]);
    setQuantity("1");
  }

  return (
    <div className="border-t border-hairline px-4 py-3">
      {chosen ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-micro uppercase text-ink-muted">Asset</span>
            <span className="block truncate text-body font-bold">{chosen.name}</span>
            <span className="block text-micro text-ink-faint">
              {chosen.rate.toFixed(2)}/{PERIOD[chosen.pricingType] ?? chosen.pricingType.toLowerCase()} today
            </span>
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Qty</span>
            <input
              id="template-line-qty"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
              className={`${FIELD} h-9 w-16 text-right tabular-nums`}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={add}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            Add to package
          </button>
          <button type="button" onClick={() => setChosen(null)} className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover">
            Back
          </button>
        </div>
      ) : (
        <>
          <input
            id="template-asset-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets to add to this package"
            aria-label="Search assets"
            className={`${FIELD} h-9 w-full`}
          />
          {hits.length > 0 ? (
            <ul className="mt-1 flex max-h-56 flex-col gap-px overflow-y-auto rounded-well bg-sunken p-1">
              {hits.map((hit) => (
                <li key={hit.assetId}>
                  <button
                    type="button"
                    onClick={() => setChosen(hit)}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="flex-none text-ink-faint">{hit.category ?? ""}</span>
                    <span className="flex-none tabular-nums text-ink-faint">
                      {hit.rate.toFixed(2)}/{PERIOD[hit.pricingType] ?? hit.pricingType.toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
