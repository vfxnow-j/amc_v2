"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { importItems, type ImportOutcome } from "@/lib/actions/entity-import";
import { MAX_CSV_BYTES } from "@/lib/entities/csv-limits";
import { CSV_TEMPLATE } from "@/lib/entities/csv-template";
import { AREA, Label, NETWORK_ERROR, PILL, PRIMARY } from "./fields";

const MAX_BYTES = MAX_CSV_BYTES;
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

/** Paste or choose a CSV, preview it (writes nothing), then import exactly what was previewed. */
export function CsvImport({ slug }: { slug: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [previewed, setPreviewed] = useState<string | null>(null); // the exact text that previewed clean
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const ready = previewed !== null && previewed === text;

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError(`That file is too large (${MAX_BYTES / 1000} KB at most; 500 rows fit comfortably).`);
    // Clear the input now so choosing the same file again fires onChange.
    if (fileRef.current) fileRef.current.value = "";
    let loaded: string;
    try {
      loaded = await file.text();
    } catch (e) {
      console.error(e);
      return setFileError("That file couldn't be read. Try choosing it again.");
    }
    if (loaded.includes("\uFFFD")) setFileError("This file doesn't look like UTF-8; check names for garbled characters before importing.");
    setText(loaded);
    setResult(null);
  }

  function run(dryRun: boolean) {
    const sent = text;
    if (new Blob([sent]).size > MAX_BYTES) return setResult({ status: "error", message: `That is too large (${MAX_BYTES / 1000} KB at most).` });
    start(async () => {
      let r: ImportOutcome;
      try {
        r = await importItems(slug, sent, dryRun);
      } catch (e) {
        console.error(e);
        r = { status: "error", message: `${NETWORK_ERROR} (Is the file too large, or are you offline?)` };
      }
      setResult(r);
      if (dryRun) setPreviewed(r.status === "ok" ? sent : null);
      else if (r.status === "ok") {
        setPreviewed(null);
        setText("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card bg-panel p-4 shadow-sm">
      <p className="text-body text-ink-muted">
        One row per unit (or per stocked location for counted items). Locations must already exist, and the file is all or nothing: any problem and nothing is imported.{" "}
        <a href={TEMPLATE_HREF} download="inventory-template.csv" className="font-bold text-ink underline">Download template</a>
      </p>

      {fileError ? <Notice tone="error">{fileError}</Notice> : null}
      {result?.status === "error" ? (
        <Notice tone="error"><span className="whitespace-pre-wrap">{result.message}</span></Notice>
      ) : null}
      {result?.status === "ok" ? (
        <Notice tone="ok">
          <p className="font-bold">{result.dryRun ? `Preview: ${result.message}` : result.message}</p>
          {result.lines.length ? (
            <ul className="mt-1 list-disc pl-5">{result.lines.map((l, n) => <li key={n}>{l}</li>)}</ul>
          ) : null}
          {result.dryRun ? <p className="mt-1">Nothing has been saved yet.</p> : null}
        </Notice>
      ) : null}

      <fieldset disabled={busy} className="flex flex-col gap-3 border-0 p-0">
        <Label text="CSV file">
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} className="text-detail text-ink" />
        </Label>
        <Label text="Or paste the contents">
          <textarea value={text} rows={10} spellCheck={false} onChange={(e) => { setText(e.target.value); setResult(null); }} className={`${AREA} font-mono`} />
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={PILL} disabled={busy || !text.trim()} onClick={() => run(true)}>{busy ? "Working…" : "Preview"}</button>
          <button type="button" className={PRIMARY} disabled={busy || !ready} onClick={() => run(false)}>Import</button>
          {!ready && text.trim() ? <span className="text-detail text-ink-muted">Preview first; Import unlocks when the preview is clean.</span> : null}
        </div>
      </fieldset>
    </div>
  );
}
