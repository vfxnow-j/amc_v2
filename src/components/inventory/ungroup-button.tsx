"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFamily } from "@/lib/actions/families";

/**
 * Dissolve an asset back into standalone models.
 *
 * The escape hatch for a grouping the script got wrong, and it will get some
 * wrong — "Mac Pro" is three generations of a very different machine sharing a
 * name. One button rather than a management screen, because the fix is always
 * the same: this should not have been one thing.
 *
 * Nothing is lost. The models are released, not deleted, and every unit, rate
 * and depreciation schedule was on them the whole time — an asset owns none of
 * it. That is why this needs a confirm step and not a modal: the sentence
 * explains the consequence faster than a dialog would.
 */
export function UngroupButton({ id, models }: { id: string; models: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");

  function confirm() {
    setError("");
    startTransition(async () => {
      const result = await deleteFamily(id);
      if (result.status === "error") setError(result.message);
      else router.push("/dashboard/assets");
    });
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
      >
        Not one asset?
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-detail text-ink-muted">
        Split back into {models} standalone{" "}
        {models === 1 ? "asset" : "assets"}? Nothing is deleted.
      </span>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid disabled:opacity-50"
      >
        {busy ? "Splitting…" : "Split"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted hover:text-ink"
      >
        Keep
      </button>
      {error ? <span className="text-detail text-danger">{error}</span> : null}
    </span>
  );
}
