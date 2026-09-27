"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPortalListing, type ListingTarget } from "@/lib/actions/portal-offers";

/** The two switches on the portal card. Saves on change. */
export function PortalListingToggles({
  target,
  isVisible,
  isPublic,
  canEdit,
}: {
  target: ListingTarget;
  isVisible: boolean;
  isPublic: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");

  function save(change: { isVisible?: boolean; isPublic?: boolean }) {
    setError("");
    startTransition(async () => {
      try {
        await setPortalListing(target, change);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not save.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-baseline gap-2 text-detail">
        <input
          type="checkbox"
          checked={isVisible}
          disabled={!canEdit || busy}
          onChange={(e) => save({ isVisible: e.target.checked })}
          className="translate-y-[2px]"
        />
        <span className="font-bold text-ink">Show in the client portal</span>
      </label>
      <label className="flex items-baseline gap-2 pl-5 text-detail">
        <input
          type="checkbox"
          checked={isPublic}
          disabled={!canEdit || busy || !isVisible}
          onChange={(e) => save({ isPublic: e.target.checked })}
          className="translate-y-[2px]"
        />
        <span className={isVisible ? "text-ink" : "text-ink-faint"}>Show its price range on the website</span>
      </label>
      {error ? <span className="text-detail text-destructive">{error}</span> : null}
    </div>
  );
}
