"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/record/record-card";
import { Notice } from "@/components/feedback/notice";
import { saveFlowTermsSettings, resetFlowTermsWording } from "@/lib/actions/flow-terms";
import { FLOW_TERMS_PLACEHOLDERS, type FlowTermsSettings } from "@/lib/pricing/flow-terms";

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * Settings → Documents → Flow Subscription Terms.
 *
 * The addendum every Flow quote carries — cancellation and extension rates,
 * the end-of-term notice window, the General Terms link, and the clauses
 * themselves. Ported from v1's flow-terms-section, redrawn on v2's own field
 * and card primitives (no shadcn form kit, no toast — `Notice` and a plain
 * `useTransition`, the pattern every other settings form here uses).
 *
 * Saving bumps the version (`saveFlowTermsSettings`); an approved Flow order
 * keeps the exact version its client signed (`Reservation.flowTermsSnapshot`),
 * so editing here only reaches quotes approved from now on. Unknown
 * `{{placeholders}}` are refused server-side with a plain message.
 *
 * `canEdit` is admin-only (the save/reset actions require `requireAdmin`) —
 * everyone else sees the same card, read-only, same as v1.
 */
export function FlowTermsSection({
  initial,
  canEdit,
}: {
  initial: FlowTermsSettings;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const setClause = (i: number, patch: Partial<{ title: string; body: string }>) =>
    setS((p) => ({ ...p, clauses: p.clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const move = (i: number, d: -1 | 1) =>
    setS((p) => {
      const c = [...p.clauses];
      const j = i + d;
      if (j < 0 || j >= c.length) return p;
      [c[i], c[j]] = [c[j], c[i]];
      return { ...p, clauses: c };
    });

  function save() {
    setError("");
    setSaved("");
    startTransition(async () => {
      try {
        const rest = {
          cancellationPct: s.cancellationPct,
          extensionPct: s.extensionPct,
          endNoticeDays: s.endNoticeDays,
          generalTermsUrl: s.generalTermsUrl,
          clauses: s.clauses,
        };
        const next = await saveFlowTermsSettings(rest);
        setS(next);
        setSaved(`Saved — new quotes use v${next.version}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function reset() {
    if (!confirm("Replace every clause with the default wording? The percentages and link are kept.")) return;
    setError("");
    setSaved("");
    startTransition(async () => {
      try {
        const next = await resetFlowTermsWording();
        setS(next);
        setSaved(`Default wording restored — now v${next.version}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reset failed");
      }
    });
  }

  const numberField = (
    key: "cancellationPct" | "extensionPct" | "endNoticeDays",
    label: string,
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        className={FIELD}
        disabled={!canEdit || busy}
        value={Number.isNaN(s[key]) ? "" : s[key]}
        onChange={(e) => setS({ ...s, [key]: e.target.value === "" ? NaN : Number(e.target.value) })}
      />
    </label>
  );

  return (
    <Card
      title="Flow subscription terms"
      meta={`v${s.version} · addendum to the general rental terms`}
    >
      <div className="flex flex-col gap-4 px-4 pb-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="ok">{saved}</Notice> : null}
        {!canEdit ? (
          <p className="text-detail text-ink-muted">
            Read-only — an administrator edits this wording. Approved orders keep
            the exact version their client signed either way.
          </p>
        ) : (
          <p className="text-detail text-ink-muted">
            Editing here only affects quotes approved from now on — an approved
            order&rsquo;s terms are frozen at the version its client signed.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          {numberField("cancellationPct", "Cancellation %")}
          {numberField("extensionPct", "Extension % of final payment")}
          {numberField("endNoticeDays", "End-of-term notice (days)")}
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">General Terms link</span>
            <input
              className={FIELD}
              disabled={!canEdit || busy}
              value={s.generalTermsUrl}
              onChange={(e) => setS({ ...s, generalTermsUrl: e.target.value })}
            />
          </label>
        </div>

        <p className="text-micro text-ink-faint">
          Placeholders: {FLOW_TERMS_PLACEHOLDERS.map((p) => `{{${p}}}`).join("  ")}
        </p>

        <div className="flex flex-col gap-3">
          {s.clauses.map((c, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-well border border-hairline bg-panel p-3">
              <div className="flex items-center gap-2">
                <span className="w-6 flex-none text-detail text-ink-muted">{i + 1}.</span>
                <input
                  className={`${FIELD} flex-1`}
                  disabled={!canEdit || busy}
                  value={c.title}
                  onChange={(e) => setClause(i, { title: e.target.value })}
                  aria-label={`Clause ${i + 1} title`}
                />
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move clause ${i + 1} up`}
                      className="text-ink-faint hover:text-ink disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === s.clauses.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move clause ${i + 1} down`}
                      className="text-ink-faint hover:text-ink disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setS({ ...s, clauses: s.clauses.filter((_, j) => j !== i) })}
                      aria-label={`Remove clause ${i + 1}`}
                      className="text-ink-faint hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </>
                ) : null}
              </div>
              <textarea
                rows={4}
                className={`${FIELD} h-auto py-2`}
                disabled={!canEdit || busy}
                value={c.body}
                onChange={(e) => setClause(i, { body: e.target.value })}
                aria-label={`Clause ${i + 1} wording`}
              />
            </div>
          ))}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setS({ ...s, clauses: [...s.clauses, { title: "New clause", body: "" }] })}
              className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              <Plus className="size-[13px]" aria-hidden /> Add clause
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              Reset to default wording
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save terms"}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
