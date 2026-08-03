"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeAllTrustDevices, revokeTrustDevice } from "@/lib/actions/mfa-trust";
import { dayYear } from "@/lib/format";

export type TrustedDevice = {
  id: string;
  deviceName: string;
  lastUsedAt: Date;
  expiresAt: Date;
};

/**
 * Devices allowed to skip the second factor, and the button that takes that
 * back.
 *
 * Revoking is the whole point of the list — the interesting case is a laptop
 * you no longer have.
 */
export function TrustedDevices({ devices }: { devices: TrustedDevice[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");

  function revoke(id?: string) {
    setError("");
    startTransition(async () => {
      const result = id
        ? await revokeTrustDevice(id)
        : await revokeAllTrustDevices();
      if (!result.success) setError(result.error ?? "Could not revoke.");
      else router.refresh();
    });
  }

  return (
    <div className="px-2 pb-3">
      {error ? (
        <p
          role="alert"
          className="mx-2 mb-2 rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-px">
        {devices.map((device) => (
          <li
            key={device.id}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="truncate">{device.deviceName}</span>
            <span className="tabular-nums text-ink-muted">
              last used {dayYear(device.lastUsedAt)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => revoke(device.id)}
              className="text-accent-text hover:underline disabled:opacity-50"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>

      {devices.length > 1 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => revoke()}
          className="mx-2 mt-2 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
        >
          Revoke all {devices.length}
        </button>
      ) : null}
    </div>
  );
}
