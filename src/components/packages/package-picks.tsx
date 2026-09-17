"use client";

import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import {
  expandTemplateForWindow,
  findTemplates,
  type TemplateDraftLine,
} from "@/lib/actions/package-templates";

type Hit = Awaited<ReturnType<typeof findTemplates>>[number];

const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };

/**
 * Our packages in the equipment search of a quote still being built — quick
 * quote and the new-order builder. The same search that finds assets finds
 * packages; picking one expands it into draft lines for the quote's dates, which
 * the screen adds like any other lines. (On an order that already exists, Add
 * line does the same thing server-side.)
 */
export function usePackageSearch(query: string) {
  const [hits, setHits] = useState<Hit[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = needle.length >= 2 ? await findTemplates(needle) : [];
      if (ticket === latest.current) setHits(found);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return hits;
}

export function PackagePicks({
  hits,
  start,
  end,
  onLines,
}: {
  hits: Hit[];
  start: string;
  end: string;
  /** The package's lines for these dates, and anything that couldn't come across. */
  onLines: (lines: TemplateDraftLine[], note: string | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (hits.length === 0) return null;

  async function pick(hit: Hit) {
    setBusyId(hit.id);
    const result = await expandTemplateForWindow(hit.id, start, end);
    setBusyId(null);
    if (result.status === "error") {
      onLines([], result.message);
      return;
    }
    onLines(
      result.lines,
      result.skipped.length
        ? `${result.name}: ${result.skipped.join(", ")} can't go on a quote being built — add ${
            result.skipped.length === 1 ? "it" : "them"
          } on the order once it's saved.`
        : null,
    );
  }

  return (
    <>
      <li className="px-2 pt-1 text-micro uppercase text-ink-muted">Our packages</li>
      {hits.map((hit) => (
        <li key={`package-${hit.id}`}>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => pick(hit)}
            className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover disabled:opacity-60"
          >
            <Package className="size-[13px] flex-none self-center text-accent-text" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold">{hit.name}</span>
              <span className="text-ink-faint">
                {" "}
                · {busyId === hit.id ? "adding…" : hit.summary || `${hit.lineCount} lines`}
              </span>
            </span>
            <span className="flex-none tabular-nums text-ink-faint">
              {hit.totals.byPeriod
                .map((t) => `${t.amount.toFixed(2)}/${PERIOD[t.pricingType] ?? t.pricingType.toLowerCase()}`)
                .join(" + ")}
            </span>
          </button>
        </li>
      ))}
      <li className="px-2 pt-2 text-micro uppercase text-ink-muted">Assets</li>
    </>
  );
}
