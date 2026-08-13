"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  executeImport,
  executeRateCardImport,
  executeRetiredAssetsImport,
  parseExcelFile,
  parseRateCardFile,
  parseRetiredAssetsFile,
  type ImportOptions,
  type ImportPreview,
  type ImportResult,
  type RateCardPreview,
  type RateCardResult,
  type RetiredAssetsPreview,
  type RetiredAssetsResult,
} from "@/lib/actions/import";
import { money } from "@/lib/format";
import { Notice } from "@/components/feedback/notice";

/**
 * The three spreadsheet imports, and the shape they share.
 *
 * Every one of them is: choose a file, read what it would do, then say yes.
 * The middle step is the point. These write directly into live inventory —
 * creating assets, moving rates, retiring hardware — and an import that runs on
 * the click that picked the file is one mis-click away from a bulk edit nobody
 * asked for. Nothing is written until the preview has been shown and a second,
 * differently-worded button has been pressed.
 *
 * The file itself never leaves the browser until it is parsed server-side;
 * parsing is a read, so the preview costs nothing but time. The retired import
 * keeps the File in state because `executeRetiredAssetsImport` re-parses it
 * rather than taking the preview back — it needs columns the preview drops.
 */

/* ── The shared shell ───────────────────────────────────────────────────── */

function FilePick({
  busy,
  onPick,
  label = "Choose a spreadsheet",
}: {
  busy: boolean;
  onPick: (file: File) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
      >
        {busy ? "Reading…" : label}
      </button>
      <span className="ml-2 text-detail text-ink-faint">
        .xlsx or .xls, up to 10 MB
      </span>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="error">
      {children}
    </Notice>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="ok">
      {children}
    </Notice>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-well bg-sunken p-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[2px] size-[14px] flex-none accent-accent-solid"
      />
      <span>
        <span className="block text-detail font-bold text-ink">{label}</span>
        <span className="block text-detail text-ink-muted">{detail}</span>
      </span>
    </label>
  );
}

/** Names the sheet mentions that don't exist yet — the import's side effects. */
function NewNames({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-detail text-ink-muted">
      <span className="text-ink">
        {names.length} new {title}
      </span>
      : {names.slice(0, 8).join(", ")}
      {names.length > 8 ? ` and ${names.length - 8} more` : ""}
    </p>
  );
}

/* ── Assets ─────────────────────────────────────────────────────────────── */

export function AssetImport() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [options, setOptions] = useState<ImportOptions>({
    createMissingCategories: true,
    createMissingLocations: true,
    createMissingVendors: true,
    createMissingClients: true,
    createReservationsFromCustody: false,
    updateExisting: false,
  });

  function pick(file: File) {
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    startTransition(async () => {
      try {
        setPreview(await parseExcelFile(body));
      } catch (cause) {
        setPreview(null);
        setError(
          cause instanceof Error ? cause.message : "Could not read that file.",
        );
      }
    });
  }

  function run() {
    if (!preview) return;
    setError("");
    startTransition(async () => {
      try {
        setResult(
          await executeImport(
            preview.assets.filter((asset) => asset.isValid),
            options,
          ),
        );
        setPreview(null);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The import failed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Problem>{error}</Problem> : null}

      {result ? (
        <Note>
          Created {result.assetsCreated}, updated {result.assetsUpdated},
          skipped {result.assetsSkipped}. Also created{" "}
          {result.categoriesCreated} categories, {result.locationsCreated}{" "}
          locations, {result.vendorsCreated} vendors, {result.clientsCreated}{" "}
          clients and {result.reservationsCreated} orders.
          {result.errors.length > 0
            ? ` ${result.errors.length} rows failed and were left alone.`
            : ""}
        </Note>
      ) : null}

      {!preview ? (
        <FilePick busy={busy} onPick={pick} />
      ) : (
        <>
          <p className="text-body">
            <span className="font-bold">{preview.validRows}</span> of{" "}
            {preview.totalRows} rows are usable
            {preview.invalidRows > 0 ? (
              <span className="text-destructive">
                {" "}
                · {preview.invalidRows} will be skipped
              </span>
            ) : null}
            .
          </p>

          <NewNames title="categories" names={preview.categories} />
          <NewNames title="locations" names={preview.locations} />
          <NewNames title="vendors" names={preview.vendors} />
          <NewNames title="clients" names={preview.clients} />

          {preview.errors.length > 0 ? (
            <details className="rounded-well bg-sunken p-2">
              <summary className="cursor-pointer text-detail text-ink-muted">
                {preview.errors.length} problems in the sheet
              </summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-detail text-ink-muted">
                {preview.errors.slice(0, 100).map((problem, index) => (
                  <li key={index}>
                    Row {problem.row} · {problem.field} — {problem.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-col gap-2">
            <Toggle
              checked={options.createMissingCategories}
              onChange={(value) =>
                setOptions({ ...options, createMissingCategories: value })
              }
              label="Create categories the sheet names"
              detail="Off means rows in an unknown category are skipped."
            />
            <Toggle
              checked={options.createMissingLocations}
              onChange={(value) =>
                setOptions({ ...options, createMissingLocations: value })
              }
              label="Create locations the sheet names"
              detail="Off leaves those units unlocated — bookable but not findable."
            />
            <Toggle
              checked={options.createMissingVendors}
              onChange={(value) =>
                setOptions({ ...options, createMissingVendors: value })
              }
              label="Create vendors the sheet names"
              detail="A vendor is what a warranty claim goes back to."
            />
            <Toggle
              checked={options.createMissingClients}
              onChange={(value) =>
                setOptions({ ...options, createMissingClients: value })
              }
              label="Create clients from the custody column"
              detail="Whoever is holding a unit becomes an account if they aren't one."
            />
            <Toggle
              checked={options.createReservationsFromCustody}
              onChange={(value) =>
                setOptions({
                  ...options,
                  createReservationsFromCustody: value,
                })
              }
              label="Raise orders for units already out"
              detail="Makes a real order per client holding hardware, so the units read as checked out rather than free. Leave off unless this is the first load."
            />
            <Toggle
              checked={options.updateExisting}
              onChange={(value) =>
                setOptions({ ...options, updateExisting: value })
              }
              label="Overwrite assets that already exist"
              detail="Matches on barcode. Off means an existing barcode is skipped, not changed."
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || preview.validRows === 0}
              onClick={run}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
            >
              {busy
                ? "Importing…"
                : `Import ${preview.validRows} rows into inventory`}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
            >
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Rate card ──────────────────────────────────────────────────────────── */

export function RateCardImport() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<RateCardPreview | null>(null);
  const [result, setResult] = useState<RateCardResult | null>(null);

  function pick(file: File) {
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    startTransition(async () => {
      try {
        setPreview(await parseRateCardFile(body));
      } catch (cause) {
        setPreview(null);
        setError(
          cause instanceof Error ? cause.message : "Could not read that file.",
        );
      }
    });
  }

  function run() {
    if (!preview) return;
    setError("");
    startTransition(async () => {
      try {
        setResult(await executeRateCardImport(preview.updates));
        setPreview(null);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The import failed.");
      }
    });
  }

  const changing = preview?.updates.filter(
    (update) =>
      update.newMonthlyRate !== update.currentMonthlyRate ||
      update.newSalePrice !== update.currentSalePrice,
  );

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Problem>{error}</Problem> : null}
      {result ? (
        <Note>
          Updated {result.updated} assets, skipped {result.skipped}.
          {result.errors.length > 0
            ? ` ${result.errors.length} failed.`
            : ""}
        </Note>
      ) : null}

      {!preview ? (
        <FilePick busy={busy} onPick={pick} />
      ) : (
        <>
          <p className="text-body">
            <span className="font-bold">{preview.matchedAssets}</span> of{" "}
            {preview.totalRows} rows matched an asset by name
            {preview.unmatchedNames.length > 0 ? (
              <>
                {" "}
                ·{" "}
                <span className="text-destructive">
                  {preview.unmatchedNames.length} matched nothing
                </span>
              </>
            ) : null}
            . {changing?.length ?? 0} would actually change.
          </p>

          {preview.unmatchedNames.length > 0 ? (
            <details className="rounded-well bg-sunken p-2">
              <summary className="cursor-pointer text-detail text-ink-muted">
                Names with no asset behind them
              </summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-detail text-ink-muted">
                {preview.unmatchedNames.slice(0, 100).map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {changing && changing.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-well bg-sunken p-2">
              <table className="w-full text-detail">
                <thead>
                  <tr className="text-colhead uppercase text-ink-muted">
                    <th className="text-left font-bold">Asset</th>
                    <th className="text-right font-bold">Monthly</th>
                    <th className="text-right font-bold">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {changing.slice(0, 200).map((update) => (
                    <tr key={update.assetId}>
                      <td className="truncate py-[2px] pr-2">
                        {update.assetName}
                      </td>
                      <td className="py-[2px] text-right tabular-nums">
                        {update.currentMonthlyRate === update.newMonthlyRate ? (
                          <span className="text-ink-faint">unchanged</span>
                        ) : (
                          <>
                            <span className="text-ink-faint">
                              {update.currentMonthlyRate === null
                                ? "unset"
                                : money(update.currentMonthlyRate)}
                            </span>{" "}
                            →{" "}
                            {update.newMonthlyRate === null
                              ? "unset"
                              : money(update.newMonthlyRate)}
                          </>
                        )}
                      </td>
                      <td className="py-[2px] text-right tabular-nums">
                        {update.currentSalePrice === update.newSalePrice ? (
                          <span className="text-ink-faint">unchanged</span>
                        ) : (
                          <>
                            <span className="text-ink-faint">
                              {update.currentSalePrice === null
                                ? "unset"
                                : money(update.currentSalePrice)}
                            </span>{" "}
                            →{" "}
                            {update.newSalePrice === null
                              ? "unset"
                              : money(update.newSalePrice)}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="text-detail text-ink-muted">
            Rates live on the asset, not the unit, so every unit of a matched
            asset is repriced. Orders already written keep the rate they were
            quoted at.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || preview.matchedAssets === 0}
              onClick={run}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
            >
              {busy
                ? "Applying…"
                : `Apply to ${preview.matchedAssets} assets`}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
            >
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Retired assets ─────────────────────────────────────────────────────── */

export function RetiredImport() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RetiredAssetsPreview | null>(null);
  const [result, setResult] = useState<RetiredAssetsResult | null>(null);
  const [createNew, setCreateNew] = useState(false);

  function pick(chosen: File) {
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", chosen);
    startTransition(async () => {
      try {
        setPreview(await parseRetiredAssetsFile(body));
        setFile(chosen);
      } catch (cause) {
        setPreview(null);
        setFile(null);
        setError(
          cause instanceof Error ? cause.message : "Could not read that file.",
        );
      }
    });
  }

  function run() {
    if (!file) return;
    setError("");
    const body = new FormData();
    body.append("file", file);
    startTransition(async () => {
      try {
        setResult(await executeRetiredAssetsImport(body, { createNew }));
        setPreview(null);
        setFile(null);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The import failed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Problem>{error}</Problem> : null}
      {result ? (
        <Note>
          Retired {result.updated} units, created {result.created}, skipped{" "}
          {result.skipped}.
          {result.errors.length > 0 ? ` ${result.errors.length} failed.` : ""}
        </Note>
      ) : null}

      {!preview ? (
        <FilePick busy={busy} onPick={pick} />
      ) : (
        <>
          <p className="text-body">
            <span className="font-bold">{preview.matchedAssets}</span> of{" "}
            {preview.totalRows} rows matched a unit already on the system.{" "}
            {preview.newAssets} name hardware this database has never seen.
          </p>

          {preview.errors.length > 0 ? (
            <details className="rounded-well bg-sunken p-2">
              <summary className="cursor-pointer text-detail text-ink-muted">
                {preview.errors.length} problems in the sheet
              </summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-detail text-ink-muted">
                {preview.errors.slice(0, 100).map((problem, index) => (
                  <li key={index}>
                    Row {problem.row} — {problem.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {preview.newAssets > 0 ? (
            <Toggle
              checked={createNew}
              onChange={setCreateNew}
              label={`Also create the ${preview.newAssets} unknown units, retired`}
              detail="They enter the system already out of the fleet, so they never count as bookable stock. Off means those rows are skipped."
            />
          ) : null}

          <p className="text-detail text-ink-muted">
            Retiring takes a unit out of the fleet permanently — it stops
            counting as stock, stops being bookable, and its depreciation stops
            accruing. There is no bulk undo.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || (preview.matchedAssets === 0 && !createNew)}
              onClick={run}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
            >
              {busy
                ? "Retiring…"
                : `Retire ${preview.matchedAssets}${
                    createNew ? ` and create ${preview.newAssets}` : ""
                  }`}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
              className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
            >
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}
