"use client";

import Link from "next/link";
import type { Tone } from "@/lib/scan/audio";

/**
 * The receipt.
 *
 * Both existing scan panels keep the last eight rows, which is right beside an
 * order table you can compare against and useless as the record of a sixty-unit
 * outbound. This keeps the session, because reconciling afterwards — "did that
 * one actually go through?" — is the whole reason a person looks at a log at
 * all.
 *
 * A pending row is rendered the moment a scan is accepted and resolves in
 * place, so the queue is visible rather than implied. A failed row keeps its
 * code and the server's own words: the point is that the person can see exactly
 * which unit did not land, and re-scan that one.
 */

export type ScanEntry = {
  key: string;
  code: string;
  state: "pending" | "done";
  tone?: Tone;
  message?: string;
  href?: string;
};

const DOT: Record<Tone, string> = {
  ok: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  error: "bg-[var(--danger)]",
};

export function ScanLog({ entries }: { entries: ScanEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="px-2 py-4 text-detail text-ink-muted">
        Nothing scanned yet in this session.
      </p>
    );
  }

  return (
    <ol role="log" aria-live="polite" className="flex flex-col gap-[2px]">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="flex min-h-[30px] items-center gap-2 rounded-row px-2 py-1 odd:bg-row-alt"
        >
          <span
            aria-hidden
            className={`size-2 flex-none rounded-full ${
              entry.state === "pending"
                ? "animate-pulse bg-ink-faint"
                : DOT[entry.tone ?? "ok"]
            }`}
          />
          <span className="w-[104px] flex-none truncate text-detail tabular-nums text-ink">
            {entry.code}
          </span>
          <span className="flex-1 truncate text-detail text-ink-muted">
            {entry.state === "pending" ? "…" : entry.message}
          </span>
          {entry.href ? (
            <Link
              href={entry.href}
              className="flex-none text-detail text-accent-text hover:underline"
            >
              Open
            </Link>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
