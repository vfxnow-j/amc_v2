"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import { addToListByBarcode } from "@/lib/actions/scan-lists";
import type { Tone } from "@/lib/scan/audio";

/**
 * Scanning into a scan list from its own record.
 *
 * Until a list could be created from Audits & scan lists, the only way to fill
 * one was the scan desk's list mode, and a list made here would land on a page
 * that could not take a scan. This is the same gather on the same primitives —
 * `ScanField`'s queue, `ScanLog`'s receipt, the ported `addToListByBarcode` —
 * so a duplicate is a warn tone and an unknown barcode is saved as unregistered,
 * exactly as list mode does. The bulk rate change stays on the scan desk; this
 * only gathers.
 *
 * Each scan that added something refreshes the route, so the Scanned table
 * below fills as the log does rather than on the next reload.
 */

const LOG_CAP = 50;

export function ScanListPanel({ listId }: { listId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [pending, setPending] = useState(0);
  const seq = useRef(0);

  const commit = useCallback(
    async (code: string): Promise<Tone> => {
      const key = `list-${seq.current++}`;
      setEntries((current) =>
        [{ key, code, state: "pending" as const }, ...current].slice(0, LOG_CAP),
      );
      setPending((count) => count + 1);

      const result = await addToListByBarcode(listId, code);

      let tone: Tone = "ok";
      let message = "Added.";
      if (!result.success) {
        const reason = "error" in result ? result.error : "Could not add it.";
        // Already on the list is what the person wanted — heard, nothing changed.
        tone = /already on this list/i.test(reason) ? "warn" : "error";
        message = reason;
      } else if (result.warning) {
        tone = "warn";
        message = result.warning;
      }

      setEntries((current) =>
        current.map((entry) =>
          entry.key === key ? { ...entry, state: "done" as const, tone, message } : entry,
        ),
      );
      setPending((count) => Math.max(0, count - 1));
      if (result.success) router.refresh();
      return tone;
    },
    [listId, router],
  );

  return (
    <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-card-title">Scan into this list</h2>
        <span className="text-detail text-ink-muted">
          Anything goes — unregistered codes are kept too
        </span>
        <Link
          href="/dashboard/scan"
          className="ml-auto text-detail text-accent-text hover:underline"
        >
          Change rates across a list on the scan desk
        </Link>
      </div>
      <ScanField onCommit={commit} pending={pending} />
      {entries.length > 0 ? <ScanLog entries={entries} /> : null}
    </section>
  );
}
