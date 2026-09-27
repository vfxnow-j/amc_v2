"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAssetOffering, setUnitOffering } from "@/lib/actions/unit-offering";
import {
  UNIT_OFFERINGS,
  UNIT_OFFERING_HINT,
  UNIT_OFFERING_LABEL,
  type UnitOfferingValue,
} from "@/lib/inventory/unit-offering";

/**
 * Rental / Sale / Flow ticks. On a unit it saves each change straight away; on
 * an asset it applies the chosen set to every in-fleet unit when asked, since
 * that overwrites per-unit choices.
 */
export function UnitOfferingControl({
  target,
  id,
  initial,
  counts,
  canEdit,
}: {
  target: "unit" | "asset";
  id: string;
  initial: UnitOfferingValue[];
  /** Asset only: how many in-fleet units carry each offering now. */
  counts?: Record<UnitOfferingValue, number> & { total: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [value, setValue] = useState<UnitOfferingValue[]>(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function save(next: UnitOfferingValue[]) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        if (target === "unit") {
          await setUnitOffering(id, next);
        } else {
          const { updated } = await setAssetOffering(id, next);
          setMessage(`Applied to ${updated} unit${updated === 1 ? "" : "s"}.`);
        }
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save.");
      }
    });
  }

  function toggle(offering: UnitOfferingValue) {
    const next = value.includes(offering)
      ? value.filter((v) => v !== offering)
      : UNIT_OFFERINGS.filter((o) => o === offering || value.includes(o));
    setValue(next);
    if (target === "unit") save(next);
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {UNIT_OFFERINGS.map((offering) => (
        <label key={offering} className="flex items-baseline gap-2 text-detail">
          <input
            type="checkbox"
            checked={value.includes(offering)}
            disabled={!canEdit || busy}
            onChange={() => toggle(offering)}
            className="translate-y-[2px]"
          />
          <span className="text-ink">{UNIT_OFFERING_LABEL[offering]}</span>
          <span className="text-ink-faint">
            {counts
              ? `${counts[offering]} of ${counts.total} units now`
              : UNIT_OFFERING_HINT[offering]}
          </span>
        </label>
      ))}
      {target === "asset" && canEdit ? (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => save(value)}
            className="rounded-pill bg-accent-solid px-3 py-[5px] text-pill text-accent-on-solid disabled:opacity-50"
          >
            Apply to every unit
          </button>
        </div>
      ) : null}
      {message ? <span className="text-detail text-ink-muted">{message}</span> : null}
      {error ? <span className="text-detail text-destructive">{error}</span> : null}
    </div>
  );
}
