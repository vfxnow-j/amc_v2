"use client";

import { overScanPrompt } from "@/lib/reservations/over-scan";
import type {
  OverScanConflict,
  OverScanResolution,
} from "@/lib/reservations/over-scan";

/**
 * The priced question a person answers when a scan would change the order.
 *
 * Extracted from the order record's check-out panel so the record and the scan
 * surface cannot drift. They ask the same question about the same act, and two
 * copies of a dialog that prices three different outcomes is exactly the kind
 * of duplication that ends with one of them quietly offering a fourth.
 *
 * The copy itself already lived in `lib/reservations/over-scan`, deliberately,
 * "so the scanner, the record and any future mobile surface all say the same
 * thing". This is the rendering catching up with that intent.
 *
 * Rendered as an `alertdialog` and, at both call sites, with the scan field
 * blocked while it is open. A scan arriving into an unanswered commercial
 * question must not queue behind it — that is the whole reason the conflict
 * exists rather than the server just widening the line.
 */

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function OverScanPrompt({
  conflict,
  busy,
  onResolve,
  onDismiss,
  dismissLabel = "Don’t check it out",
  className = "",
}: {
  conflict: OverScanConflict;
  busy: boolean;
  onResolve: (resolution: OverScanResolution) => void;
  onDismiss: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const prompt = overScanPrompt(conflict);

  return (
    <div
      role="alertdialog"
      aria-label={prompt.title}
      className={`rounded-bubble bg-accent-tint p-3 ${className}`}
    >
      <p className="text-card-title text-accent-on-tint">{prompt.title}</p>
      <p className="mt-1 text-detail text-accent-on-tint">{prompt.detail}</p>

      <div className="mt-3 flex flex-col gap-2">
        {prompt.options.map((option) => (
          <button
            key={option.resolution}
            type="button"
            disabled={busy}
            onClick={() => onResolve(option.resolution)}
            className="rounded-well bg-panel px-3 py-2 text-left transition-colors hover:bg-row-hover disabled:opacity-60"
          >
            <span className="block text-body font-bold">
              {option.label}
              {option.resolution === "expand" ? (
                <span className="font-normal text-ink-muted">
                  {" "}
                  · +{MONEY.format(conflict.rate)}/
                  {conflict.pricingType.toLowerCase()}
                </span>
              ) : null}
            </span>
            <span className="block text-detail text-ink-muted">
              {option.detail}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onDismiss}
        className="mt-2 text-detail text-accent-on-tint underline-offset-2 hover:underline"
      >
        {dismissLabel}
      </button>
    </div>
  );
}
