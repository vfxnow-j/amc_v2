"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  NUMBER_KIND_LABEL,
  NUMBER_KINDS,
  numberingProblem,
  renderNumber,
  type NumberKind,
  type NumberingRule,
} from "@/lib/numbering/format";
import { saveNumbering } from "@/lib/settings/business-actions";

const FIELD =
  "h-8 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Draft = { pattern: string; padding: string; reset: "yearly" | "never"; next: string };

/**
 * One row per kind of record: the pattern, its padding and reset, and the next
 * number to issue — with the number it would produce, worked out as you type.
 *
 * `highest` is the highest sequence already issued under each *saved* pattern
 * this year. Change a pattern and nothing matches it yet, so numbering starts
 * again at 1 unless a next number is set — the preview says so rather than
 * letting it be discovered on the first invoice.
 */
export function NumberingForm({
  rules,
  highest,
  year,
}: {
  rules: Record<NumberKind, NumberingRule>;
  highest: Record<NumberKind, number>;
  year: number;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const initial = () =>
    Object.fromEntries(
      NUMBER_KINDS.map((kind) => [
        kind,
        {
          pattern: rules[kind].pattern,
          padding: String(rules[kind].padding),
          reset: rules[kind].reset,
          next: rules[kind].next === null ? "" : String(rules[kind].next),
        },
      ]),
    ) as Record<NumberKind, Draft>;
  const [draft, setDraft] = useState<Record<NumberKind, Draft>>(initial);

  const toRule = (d: Draft): NumberingRule => ({
    pattern: d.pattern.trim(),
    padding: Number(d.padding),
    reset: d.reset,
    next: d.next.trim() === "" ? null : Number(d.next),
  });

  const changed = NUMBER_KINDS.some(
    (kind) => JSON.stringify(toRule(draft[kind])) !== JSON.stringify(rules[kind]),
  );

  function set(kind: NumberKind, patch: Partial<Draft>) {
    setSaved("");
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved("");
    startTransition(async () => {
      const result = await saveNumbering(
        Object.fromEntries(NUMBER_KINDS.map((kind) => [kind, toRule(draft[kind])])) as Record<
          NumberKind,
          NumberingRule
        >,
      );
      if (result.status === "error") setError(result.message);
      else {
        setSaved(result.message);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="ok">{saved}</Notice> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-left">
          <thead>
            <tr className="text-micro uppercase text-ink-muted">
              <th className="px-1 font-normal">Record</th>
              <th className="px-1 font-normal">Pattern</th>
              <th className="w-[64px] px-1 font-normal">Digits</th>
              <th className="w-[96px] px-1 font-normal">Restarts</th>
              <th className="w-[92px] px-1 font-normal">Next no.</th>
              <th className="px-1 font-normal">Next issued</th>
            </tr>
          </thead>
          <tbody>
            {NUMBER_KINDS.map((kind) => {
              const d = draft[kind];
              const rule = toRule(d);
              const problem = numberingProblem(rule);
              const samePattern =
                rule.pattern === rules[kind].pattern && rule.reset === rules[kind].reset;
              const sequence = Math.max(samePattern ? highest[kind] + 1 : 1, rule.next ?? 1);
              return (
                <tr key={kind} className="align-top">
                  <td className="px-1 py-1 text-detail font-bold">{NUMBER_KIND_LABEL[kind]}</td>
                  <td className="px-1">
                    <input
                      id={`pattern-${kind}`}
                      aria-label={`${NUMBER_KIND_LABEL[kind]} pattern`}
                      value={d.pattern}
                      onChange={(event) => set(kind, { pattern: event.target.value })}
                      spellCheck={false}
                      className={`${FIELD} font-mono`}
                    />
                  </td>
                  <td className="px-1">
                    <input
                      id={`padding-${kind}`}
                      aria-label={`${NUMBER_KIND_LABEL[kind]} digits`}
                      inputMode="numeric"
                      value={d.padding}
                      onChange={(event) => set(kind, { padding: event.target.value })}
                      className={`${FIELD} tabular-nums`}
                    />
                  </td>
                  <td className="px-1">
                    <select
                      id={`reset-${kind}`}
                      aria-label={`${NUMBER_KIND_LABEL[kind]} restarts`}
                      value={d.reset}
                      onChange={(event) =>
                        set(kind, { reset: event.target.value as Draft["reset"] })
                      }
                      className={FIELD}
                    >
                      <option value="yearly">Each year</option>
                      <option value="never">Never</option>
                    </select>
                  </td>
                  <td className="px-1">
                    <input
                      id={`next-${kind}`}
                      aria-label={`${NUMBER_KIND_LABEL[kind]} next number`}
                      inputMode="numeric"
                      placeholder="auto"
                      value={d.next}
                      onChange={(event) => set(kind, { next: event.target.value.replace(/[^\d]/g, "") })}
                      className={`${FIELD} tabular-nums placeholder:text-ink-faint`}
                    />
                  </td>
                  <td className="px-1 py-1 text-detail">
                    {problem ? (
                      <span className="text-destructive">{problem}</span>
                    ) : (
                      <>
                        <span className="font-mono font-bold">{renderNumber(rule, sequence, year)}</span>
                        {!samePattern && !rule.next ? (
                          <span className="block text-micro text-ink-faint">
                            new pattern starts at 1 — set a next number to continue
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-detail text-ink-muted">
        <span className="font-mono text-ink">{"{SEQ}"}</span> is the running number,{" "}
        <span className="font-mono text-ink">{"{YYYY}"}</span> and{" "}
        <span className="font-mono text-ink">{"{YY}"}</span> the year —{" "}
        <span className="font-mono text-ink">vfxnow-res-{"{SEQ}"}-{"{YY}"}</span> gives{" "}
        <span className="font-mono text-ink">vfxnow-res-00118-26</span>. A next number can move
        numbering forward but never reissues one that exists. Quotes carry their order&rsquo;s
        number. Numbers already issued are never changed.
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !changed}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save numbering"}
        </button>
        {changed ? (
          <button
            type="button"
            onClick={() => setDraft(initial())}
            className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink hover:bg-row-hover"
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
