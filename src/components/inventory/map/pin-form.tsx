"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pinAddress } from "@/lib/actions/map";

/**
 * Place an address the offline geocoder couldn't, by typing its coordinates
 * (right-click → "What's here?" in any map app gives them). MVP correction;
 * drag-to-pin is phase 2.
 */
export function PinForm({ address }: { address: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    setError(null);
    startTransition(async () => {
      const result = await pinAddress({ address, lat, lng });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const input =
    "w-28 rounded-well bg-sunken px-2 py-1 text-detail text-ink tabular-nums outline-none focus:ring-2 focus:ring-[var(--accent-solid)]";

  return (
    <details className="relative z-10 mt-1">
      <summary className="cursor-pointer text-detail text-accent-text hover:underline">
        Pin by coordinates
      </summary>
      <form action={submit} className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-detail text-ink-muted">
          Lat
          <input name="lat" type="number" step="any" min={-90} max={90} required className={input} />
        </label>
        <label className="flex items-center gap-1 text-detail text-ink-muted">
          Lng
          <input name="lng" type="number" step="any" min={-180} max={180} required className={input} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid disabled:opacity-60"
        >
          {pending ? "Pinning…" : "Pin"}
        </button>
        {error ? <span className="text-detail text-[var(--danger)]">{error}</span> : null}
      </form>
    </details>
  );
}
