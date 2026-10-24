"use client";

import { useState } from "react";
import { fixUnitSerial, skipUnitSerial } from "@/lib/actions/unit-data";
import { foundUnitOnCase, reinstateUnit } from "@/lib/actions/order-flags";
import type { GateResult } from "@/lib/scan/unit-gate-rules";

/**
 * The question a scan stops on when the unit it found is missing its serial,
 * carries a serial label that is not its own, or is flagged and cannot leave.
 *
 * Same shell as the over-scan prompt, and used the same way: the scan field is
 * blocked while it is open, so a scan never queues behind an unanswered
 * question. `onResolved` says how it was answered. "fixed" means the serial is
 * saved and the scan can be re-submitted; "skipped" means the unit is now
 * flagged and the caller decides whether to carry on (a return does, a
 * check-out does not).
 */
export type GatePromptResult = Exclude<GateResult, { kind: "clear" }>;

export function UnitGatePrompt({
  result,
  skipLabel = "Skip for now",
  onResolved,
  onCancel,
  className = "",
}: {
  result: GatePromptResult;
  skipLabel?: string;
  onResolved: (how: "fixed" | "skipped") => void;
  onCancel: () => void;
  className?: string;
}) {
  const [serial, setSerial] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Case answers: the note for "leave open" and the reason for reinstating.
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<null | "note" | "reinstate">(null);
  const [claimSeen, setClaimSeen] = useState(false);
  const [done, setDone] = useState("");

  async function answerCase(choice: "returned" | "damaged" | "not-this-case" | "leave-open") {
    if (result.kind !== "on-case") return;
    setBusy(true);
    const outcome = await foundUnitOnCase({ unitId: result.unitId, flagId: result.flagId, choice, note: note.trim() || undefined });
    setBusy(false);
    if (!outcome.ok) return setError(outcome.message);
    if (choice === "returned") return onResolved("fixed");
    if (choice === "not-this-case") return onResolved("skipped");
    setDone(
      choice === "damaged"
        ? "Recorded as found but damaged. It is off the shelf; the scan has not been checked in."
        : "Note added. The case stays open and the scan has not been checked in.",
    );
  }

  async function reinstate() {
    if (result.kind !== "on-case") return;
    setBusy(true);
    const outcome = await reinstateUnit(result.unitId, note);
    setBusy(false);
    if (outcome.ok) onResolved("fixed");
    else setError(outcome.message);
  }

  async function save() {
    if (result.kind !== "needs-data") return;
    setBusy(true);
    const outcome = await fixUnitSerial(result.unitId, serial);
    setBusy(false);
    if (outcome.ok) onResolved("fixed");
    else setError(outcome.message);
  }

  async function flag(gap: "MISSING_SERIAL" | "MISSING_BARCODE" | "MISMATCH") {
    setBusy(true);
    const outcome = await skipUnitSerial(result.unitId, gap);
    setBusy(false);
    if (outcome.ok) onResolved("skipped");
    else setError(outcome.message);
  }

  const shell = `rounded-bubble bg-accent-tint p-3 ${className}`;
  const button =
    "rounded-well bg-panel px-3 py-2 text-detail transition-colors hover:bg-row-hover disabled:opacity-60";

  if (result.kind === "blocked") {
    const title = `${result.assetName} (${result.barcode}) can’t go out`;
    return (
      <div role="alertdialog" aria-label={title} className={shell}>
        <p className="text-card-title text-accent-on-tint">{title}</p>
        <p className="mt-1 text-detail text-accent-on-tint">{result.reason}</p>
        <div className="mt-3">
          <button type="button" autoFocus onClick={onCancel} className={button}>
            OK
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === "mismatch") {
    const title = `This serial does not match ${result.barcode}`;
    return (
      <div role="alertdialog" aria-label={title} className={shell}>
        <p className="text-card-title text-accent-on-tint">{title}</p>
        <p className="mt-1 text-detail text-accent-on-tint">
          {result.assetName}: scanned {result.scanned}, expected {result.expected}.
          Nothing is overwritten.
        </p>
        {error ? <p role="alert" className="mt-2 text-detail text-destructive">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => flag("MISMATCH")} className={button}>
            Flag as possible swap
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className={button}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === "on-case") {
    const written = result.unitState === "written-off";
    const title = `${result.assetName} (${result.barcode}) is on a case`;
    if (done) {
      return (
        <div role="alertdialog" aria-label={title} className={shell}>
          <p className="text-detail text-accent-on-tint">{done}</p>
          <div className="mt-3">
            <button type="button" autoFocus onClick={onCancel} className={button}>OK</button>
          </div>
        </div>
      );
    }
    const claimBlocks = written && result.claim && !claimSeen;
    return (
      <div role="alertdialog" aria-label={title} className={shell}>
        <p className="text-card-title text-accent-on-tint">{title}</p>
        <p className="mt-1 text-detail text-accent-on-tint">
          {written ? "Written off as lost" : "Missing"} on order {result.reservationNumber} ({result.reasonLabel}). It has
          turned up. What do you want to do?
        </p>
        {claimBlocks && result.claim ? (
          <p role="alert" className="mt-2 text-detail text-accent-on-tint">
            Claim {result.claim.claimNumber} was paid ${result.claim.amount.toLocaleString()} for this. Putting it back may mean
            refunding the carrier.{" "}
            <button type="button" onClick={() => setClaimSeen(true)} className="underline">Understood</button>
          </p>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-detail text-destructive">{error}</p> : null}
        {asking ? (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              aria-label={asking === "reinstate" ? "Reason for reinstating" : "Note"}
              placeholder={asking === "reinstate" ? "Why is it being reinstated?" : "For example: received at the dock, not yet inspected"}
              className="w-full resize-none rounded-well border-0 bg-panel px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => (asking === "reinstate" ? reinstate() : answerCase("leave-open"))}
                className={button}
              >
                {asking === "reinstate" ? "Reinstate" : "Add note and leave open"}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className={button}>Back</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {written ? (
              <button type="button" disabled={busy || !!claimBlocks} onClick={() => setAsking("reinstate")} className={button}>
                Reinstate (undo the write-off)
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => answerCase("returned")} className={button}>
                  Found: close and return to inventory
                </button>
                <button type="button" disabled={busy} onClick={() => answerCase("damaged")} className={button}>
                  Found but damaged
                </button>
              </>
            )}
            <button type="button" disabled={busy} onClick={() => answerCase("not-this-case")} className={button}>
              Not part of this case
            </button>
            {written ? null : (
              <button type="button" disabled={busy} onClick={() => setAsking("note")} className={button}>
                Leave open with a note
              </button>
            )}
            <button type="button" disabled={busy} onClick={onCancel} className={button}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  const noBarcode = result.gap === "MISSING_BARCODE";
  const title = noBarcode
    ? `Barcode missing — ${result.assetName}`
    : `Serial missing — ${result.assetName} (${result.barcode})`;
  return (
    <div role="alertdialog" aria-label={title} className={shell}>
      <p className="text-card-title text-accent-on-tint">{title}</p>
      {noBarcode ? (
        <p className="mt-1 text-detail text-accent-on-tint">
          This unit has no barcode. Fix it under Inventory → Missing data.
        </p>
      ) : (
        <>
          <p className="mt-1 text-detail text-accent-on-tint">
            Scan or type the serial from the unit’s label.
          </p>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <input
              autoFocus
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Serial number"
              placeholder="Serial number"
              className="h-9 min-w-0 flex-1 rounded-well border-0 bg-panel px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button type="submit" disabled={busy || !serial.trim()} className={button}>
              Save serial
            </button>
          </form>
        </>
      )}
      {error ? <p role="alert" className="mt-2 text-detail text-destructive">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => flag(result.gap)}
          className="text-detail text-accent-on-tint underline-offset-2 hover:underline"
        >
          {skipLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="text-detail text-accent-on-tint underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
