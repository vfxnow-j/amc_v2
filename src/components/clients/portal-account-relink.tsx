"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  relinkPortalAccountToClient,
  searchClientsForRelink,
} from "@/lib/actions/portal-accounts";

/**
 * "Re-link" — move a portal account onto a different, existing client
 * (docs/portal-api-plan.md §2, owner answer 5). Admin only; the action file
 * checks the role itself, this only decides what's offered.
 */

const input =
  "h-9 min-w-0 flex-1 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint disabled:opacity-50";
const quiet =
  "rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50";
const solid =
  "h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50";

type Candidate = { id: string; name: string; companyName: string | null };

export function PortalAccountRelink({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  function search(value: string) {
    setQuery(value);
    setResults([]);
    if (value.trim().length < 2) return;
    setSearching(true);
    startTransition(async () => {
      try {
        setResults(await searchClientsForRelink(value));
      } finally {
        setSearching(false);
      }
    });
  }

  function pick(target: Candidate) {
    setError("");
    startTransition(async () => {
      const result = await relinkPortalAccountToClient(accountId, target.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="border-t border-hairline px-4 py-3">
        <button type="button" className={quiet} onClick={() => setOpen(true)}>
          Re-link to a different client
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => search(event.target.value)}
          placeholder="Search clients by name or company"
          aria-label="Search clients to re-link this portal account to"
          className={input}
        />
        <button
          type="button"
          className={quiet}
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setQuery("");
            setResults([]);
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
      {searching ? (
        <p className="text-detail text-ink-faint">Searching…</p>
      ) : results.length ? (
        <ul className="flex flex-col gap-1">
          {results.map((candidate) => (
            <li key={candidate.id} className="flex items-center justify-between gap-2 rounded-well bg-sunken px-2 py-1">
              <span className="min-w-0 truncate text-detail text-ink">
                {candidate.name}
                {candidate.companyName ? ` · ${candidate.companyName}` : ""}
              </span>
              <button type="button" disabled={busy} className={solid} onClick={() => pick(candidate)}>
                Link
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? (
        <p className="text-detail text-ink-faint">
          No clients without a portal account match “{query}”.
        </p>
      ) : null}
    </div>
  );
}
