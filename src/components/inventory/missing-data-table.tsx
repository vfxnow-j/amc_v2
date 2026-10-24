"use client";

import { useState } from "react";
import Link from "next/link";
import { fixUnitSerial, type IncompleteUnit } from "@/lib/actions/unit-data";

/** Item · Barcode · Serial · Location · Flag */
const TRACKS = "minmax(0,1.3fr) 128px minmax(0,1.2fr) minmax(0,1fr) 110px";

const GAP_LABEL = {
  MISSING_SERIAL: "No serial",
  MISSING_BARCODE: "No barcode",
} as const;

/**
 * The inline-edit list behind Inventory → Missing data. Saving a serial removes
 * the row at once; a refusal (a serial already in the fleet) shows under the
 * input and the row stays. Scrolls sideways inside its own card on a phone, as
 * the other lists do.
 */
export function MissingDataTable({ rows }: { rows: IncompleteUnit[] }) {
  const [remaining, setRemaining] = useState(rows);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save(id: string) {
    const serial = values[id] ?? "";
    if (!serial.trim()) return;
    setBusyId(id);
    const outcome = await fixUnitSerial(id, serial);
    setBusyId(null);
    if (outcome.ok) {
      setRemaining((current) => current.filter((row) => row.id !== id));
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    } else {
      setErrors((current) => ({ ...current, [id]: outcome.message }));
    }
  }

  if (remaining.length === 0) {
    return (
      <section className="flex flex-1 flex-col rounded-card bg-panel p-[14px] shadow-sm">
        <p className="flex flex-1 items-center justify-center text-center text-body text-balance text-ink-muted">
          <span className="max-w-sm">Every unit has its serial. Nothing to fix.</span>
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto md:contents">
        <div className="flex min-h-0 min-w-[720px] flex-1 flex-col md:contents">
          <div
            className="grid gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted"
            style={{ gridTemplateColumns: TRACKS }}
          >
            <span>Item</span>
            <span>Barcode</span>
            <span>Serial</span>
            <span>Location</span>
            <span>Flag</span>
          </div>

          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
            {remaining.map((row, index) => (
              <li key={row.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(row.id);
                  }}
                  className={`grid items-center gap-2 rounded-row p-2 ${index % 2 === 1 ? "bg-row-alt" : ""}`}
                  style={{ gridTemplateColumns: TRACKS }}
                >
                  <span className="truncate">{row.assetName}</span>
                  <Link
                    href={`/dashboard/units/${row.id}`}
                    className="truncate font-bold tabular-nums text-accent-text hover:underline"
                  >
                    {row.barcode}
                  </Link>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <input
                        value={values[row.id] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [row.id]: event.target.value }))
                        }
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Serial for ${row.barcode}`}
                        placeholder="Serial"
                        className="h-8 min-w-0 flex-1 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        type="submit"
                        disabled={busyId === row.id || !(values[row.id] ?? "").trim()}
                        className="h-8 flex-none rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
                      >
                        Save
                      </button>
                    </span>
                    {errors[row.id] ? (
                      <span role="alert" className="truncate text-detail text-destructive">
                        {errors[row.id]}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-ink-muted">{row.location ?? "—"}</span>
                  <span className="truncate text-ink-muted">
                    {GAP_LABEL[row.gap]}
                    {row.flagged ? " · flagged" : ""}
                  </span>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="px-4 py-3 text-detail text-ink-muted">
        {remaining.length} {remaining.length === 1 ? "unit" : "units"} without a serial
      </footer>
    </section>
  );
}
