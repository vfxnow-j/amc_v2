"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { importItems, type ImportOutcome } from "@/lib/actions/entity-import";
import { CSV_TEMPLATE } from "@/lib/entities/csv-template";
import { AREA, Label, PILL, PRIMARY } from "./fields";

const MAX_BYTES = 1_000_000;
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
    if (file.size > MAX_BYTES) return setFileError("That file is too large (1 MB at most).");
    setText(await file.text());
    setResult(null);
  }

  function run(dryRun: boolean) {
    const sent = text;
    start(async () => {
      const r = await importItems(slug, sent, dryRun);
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
