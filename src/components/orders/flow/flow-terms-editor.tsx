"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { FLOW_TERMS } from "@/lib/flow/terms";
import { FLOW_KNOB_BOUNDS } from "@/lib/flow/knob-bounds";
import {
  markFlowAutopaySetUp,
  saveFlowTerms,
  type FlowTermsInput,
} from "@/lib/actions/flow-record";
import type { StageOutcome } from "@/lib/actions/order-stage";

/**
 * Edit a Flow order's terms after it was created — the term, the pricing knobs,
 * the month-13 step and the extension rate. Ported from v1's flow-terms-editor
 * and the step and extension inputs of its flow-terms-card, in one dialog.
 *
 * Saving reprices every line and the schedule on the server. Once the client has
 * agreed or a period has been billed the server refuses, so the dialog opens
 * read-only and says which of the two locked it rather than offering a save that
 * will be turned down.
 */
export function FlowTermsEditor({
  id,
  knobs,
  lock,
  defaultExtensionPct,
}: {
  id: string;
  knobs: FlowTermsInput;
  /** Why the terms can no longer change, or null while they can. */
  lock: string | null;
  defaultExtensionPct: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(knobs));
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const locked = lock != null;

  function save() {
    const value: FlowTermsInput = {
      termMonths: Number(draft.termMonths),
      marginPct: Number(draft.marginPct),
      financePct: Number(draft.financePct),
      purchaseTaxPct: Number(draft.purchaseTaxPct),
      taxExempt: draft.taxExempt,
      recoverByMonth: Number(draft.recoverByMonth),
      stepPct: draft.stepPct.trim() === "" ? null : Number(draft.stepPct),
      extensionPct: draft.extensionPct.trim() === "" ? null : Number(draft.extensionPct),
    };
    startTransition(async () => {
      const result = await saveFlowTerms(id, value);
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  const field = (
    key: "marginPct" | "financePct" | "purchaseTaxPct" | "recoverByMonth" | "stepPct" | "extensionPct",
    label: string,
    hint?: string,
    placeholder?: string,
  ) => (
    <label className="flex flex-col">
      <span className="mb-[6px] text-micro uppercase text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={draft[key]}
        placeholder={placeholder}
        disabled={locked || busy}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail tabular-nums text-ink outline-none disabled:opacity-60"
      />
      {hint ? <span className="mt-1 text-micro text-ink-faint">{hint}</span> : null}
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(toDraft(knobs));
          setOutcome(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        {locked ? "View terms" : "Edit terms"}
      </button>

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Flow terms"
          blurb={
            locked
              ? "These terms are locked."
              : "Changing these reprices every line and the payment schedule. The end date follows the term."
          }
          footer={
            locked ? (
              <ModalCancel>Close</ModalCancel>
            ) : (
              <>
                <ModalCancel />
                <ModalConfirm disabled={busy} onClick={save}>
                  {busy ? "Saving…" : "Save terms"}
                </ModalConfirm>
              </>
            )
          }
        >
          {lock ? (
            <Notice tone="error" className="mb-3">
              {lock}
            </Notice>
          ) : null}
          {outcome && outcome.status === "error" ? (
            <Notice tone="error" className="mb-3">
              {outcome.message}
            </Notice>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col">
              <span className="mb-[6px] text-micro uppercase text-ink-muted">Term</span>
              <select
                value={draft.termMonths}
                disabled={locked || busy}
                onChange={(event) => setDraft({ ...draft, termMonths: event.target.value })}
                className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none disabled:opacity-60"
              >
                {/* A legacy term outside the offered set still reads as itself. */}
                {(FLOW_TERMS as readonly number[]).includes(knobs.termMonths) ? null : (
                  <option value={String(knobs.termMonths)}>{knobs.termMonths} months</option>
                )}
                {FLOW_TERMS.map((months) => (
                  <option key={months} value={String(months)}>
                    {months} months
                  </option>
                ))}
              </select>
            </label>
            {field(
              "recoverByMonth",
              FLOW_KNOB_BOUNDS.recoverByMonth.label,
              "Year-one shape when no month-13 % is set (1–12)",
            )}
            {field("marginPct", FLOW_KNOB_BOUNDS.marginPct.label)}
            {field("financePct", FLOW_KNOB_BOUNDS.financePct.label)}
            {field("purchaseTaxPct", FLOW_KNOB_BOUNDS.purchaseTaxPct.label, "Tax we would pay buying the gear")}
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={draft.taxExempt}
                disabled={locked || busy}
                onChange={(event) => setDraft({ ...draft, taxExempt: event.target.checked })}
                className="size-4 flex-none accent-[var(--color-accent-solid)]"
              />
              <span className="text-detail text-ink">Bought for resale (no purchase tax)</span>
            </label>
            {field(
              "stepPct",
              "From month 13, pay",
              "% of the year-one payment. Blank follows recover-by. The contract stays the same.",
              "recover-by",
            )}
            {field(
              "extensionPct",
              "Extension after term",
              `% of the final payment. Blank uses the default ${defaultExtensionPct}%.`,
              String(defaultExtensionPct),
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function toDraft(knobs: FlowTermsInput) {
  return {
    termMonths: String(knobs.termMonths),
    marginPct: String(knobs.marginPct),
    financePct: String(knobs.financePct),
    purchaseTaxPct: String(knobs.purchaseTaxPct),
    taxExempt: knobs.taxExempt,
    recoverByMonth: String(knobs.recoverByMonth),
    stepPct: knobs.stepPct == null ? "" : String(knobs.stepPct),
    extensionPct: knobs.extensionPct == null ? "" : String(knobs.extensionPct),
  };
}

/** The amber to-do's button: staff have set up the recurring charge. */
export function MarkAutopaySetUp({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          startTransition(async () => {
            const result = await markFlowAutopaySetUp(id);
            if (result.status === "ok") {
              setError("");
              router.refresh();
            } else {
              setError(result.message);
            }
          })
        }
        className="flex-none rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
      >
        {busy ? "Saving…" : "Mark set up"}
      </button>
      {error ? (
        <Notice tone="error" className="col-span-full mt-1 w-full">
          {error}
        </Notice>
      ) : null}
    </>
  );
}
