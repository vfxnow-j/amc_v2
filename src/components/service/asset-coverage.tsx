"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { addAssetCoverage, removeAssetCoverage } from "@/lib/actions/service";

const FIELD =
  "h-8 rounded-well border border-hairline bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

type Row = { id: string; name: string; provider: string | null; termMonths: number };

function term(months: number) {
  return months % 12 === 0 ? `${months / 12} ${months === 12 ? "year" : "years"}` : `${months} months`;
}

/**
 * Coverage every unit of this model comes with — "3-year warranty",
 * "AppleCare+". Each unit's coverage runs the term from its own purchase date,
 * and shows on the unit's work orders. Coverage bought for one unit alone is
 * recorded on that unit.
 */
export function AssetCoverage({ assetId, rows }: { assetId: string; rows: Row[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [months, setMonths] = useState("36");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function add() {
    setError("");
    startTransition(async () => {
      const result = await addAssetCoverage(assetId, { name, provider, termMonths: Number(months) });
      if (result.status === "error") setError(result.message);
      else {
        setOpen(false);
        setName("");
        setProvider("");
        setMonths("36");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {rows.length === 0 && !open ? (
        <p className="text-detail text-ink-muted">No coverage recorded for this model.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-px">
          {rows.map((row) => (
            <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto_20px] items-baseline gap-2 rounded-row px-2 py-[5px] text-detail odd:bg-row-alt">
              <span className="min-w-0 truncate">
                <span className="font-bold">{row.name}</span>
                {row.provider ? <span className="text-ink-muted"> · {row.provider}</span> : null}
              </span>
              <span className="text-ink-muted">{term(row.termMonths)} from purchase</span>
              <button
                type="button"
                aria-label={`Remove ${row.name}`}
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    await removeAssetCoverage(row.id);
                    router.refresh();
                  })
                }
                className="text-ink-faint hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          <input id="coverage-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AppleCare+" aria-label="Coverage" className={`${FIELD} min-w-0 flex-1`} />
          <input id="coverage-provider" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider" aria-label="Provider" className={`${FIELD} w-32`} />
          <label className="flex items-center gap-1 text-detail text-ink-muted">
            <input id="coverage-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/[^\d]/g, ""))} aria-label="Term in months" className={`${FIELD} w-14 text-right tabular-nums`} />
            months
          </label>
          <button type="button" disabled={busy || !name.trim()} onClick={add} className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex w-fit items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover">
          <Plus className="size-[13px]" aria-hidden /> Add coverage
        </button>
      )}
    </div>
  );
}
