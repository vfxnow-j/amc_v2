"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAgreementTemplate,
  uploadAgreementTemplate,
} from "@/lib/actions/agreement";
import {
  deleteDocument,
  repairDocuments,
  restoreDocument,
} from "@/lib/actions/documents";
import { fileSize } from "@/lib/settings/format";

/**
 * The three things you can do on the documents screen.
 *
 * Nothing here removes a file. Deleting is a soft delete: the row keeps its
 * signer, its timestamp and its original filename, and the file moves to
 * `documents/.trash/` rather than being unlinked — a signed rental agreement
 * that could be permanently destroyed from a settings screen would be a
 * liability, not a feature. Restore puts both back.
 */

/** Soft-delete or restore one row, from the table. */
export function DocumentRowAction({
  id,
  filename,
  trashed,
}: {
  id: string;
  filename: string;
  trashed: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  function run(work: () => Promise<unknown>) {
    startTransition(async () => {
      await work();
      setConfirming(false);
      setReason("");
      router.refresh();
    });
  }

  if (trashed) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => restoreDocument(id))}
        className="text-accent-text hover:underline disabled:opacity-50"
      >
        Restore
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-ink-muted hover:underline"
      >
        Trash
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why?"
        aria-label={`Reason for trashing ${filename}`}
        className="h-6 w-20 rounded-row border-0 bg-sunken px-2 text-[11px] text-ink outline-none placeholder:text-ink-faint"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => deleteDocument(id, reason || undefined))}
        className="text-destructive hover:underline disabled:opacity-50"
      >
        Trash
      </button>
    </span>
  );
}

/**
 * Regenerate the PDFs whose files have gone missing.
 *
 * Only purchase orders can be rebuilt — their source data is still in the
 * database, so the PDF is reproducible. A quote or a signed agreement is not:
 * the file *was* the record. The button says what it will and won't recover
 * before you press it, and reports the split afterwards.
 */
export function RepairButton({
  missing,
  storeMissing,
}: {
  missing: number;
  storeMissing: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [result, setResult] = useState<{
    scanned: number;
    missing: number;
    regenerated: number;
    unrecoverable: { id: string; filename: string; type: string }[];
  } | null>(null);

  if (missing === 0) return null;

  return (
    <div className="px-4 pb-4">
      <p className="mb-2 text-body text-ink-muted">
        {storeMissing ? (
          <>
            This instance has no <code className="text-ink">documents/</code>{" "}
            directory at all, so every one of these {missing} rows points at a
            file that was never copied across. Rebuilding can only recover
            purchase orders, whose source data is still in the database —
            quotes, delivery notes and signed agreements are gone unless the
            directory is restored from wherever it lives.
          </>
        ) : (
          <>
            {missing} {missing === 1 ? "row points" : "rows point"} at a file
            that is not on disk. Rebuilding recovers purchase orders, which can
            be regenerated from the order behind them; everything else stays
            listed as a record of what existed.
          </>
        )}
      </p>

      {result ? (
        <p
          role="status"
          className="mb-2 rounded-well bg-accent-tint px-3 py-2 text-detail text-accent-on-tint"
        >
          Scanned {result.scanned}, found {result.missing} missing, rebuilt{" "}
          {result.regenerated}. {result.unrecoverable.length} could not be
          rebuilt and were left in place.
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          startTransition(async () => {
            setResult(await repairDocuments());
            router.refresh();
          })
        }
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
      >
        {busy ? "Rebuilding…" : "Rebuild what can be rebuilt"}
      </button>
    </div>
  );
}

/**
 * The rental agreement template — the PDF a client signs after approving a
 * quote. One file, replaced rather than versioned, which is v1's model.
 */
export function AgreementTemplate({
  template,
}: {
  template: { filename: string; fileSize: number; uploadedAt: string } | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");

  function upload(file: File) {
    setError("");
    if (file.type !== "application/pdf") {
      setError("The template has to be a PDF — that is what gets signed.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      startTransition(async () => {
        try {
          await uploadAgreementTemplate(base64, file.name);
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Could not upload it.",
          );
        }
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}

      {template ? (
        <p className="mb-2 text-body text-ink-muted">
          <span className="text-ink">{template.filename}</span> ·{" "}
          {fileSize(template.fileSize)} · uploaded{" "}
          {new Date(template.uploadedAt).toLocaleDateString("en-US")}
        </p>
      ) : (
        <p className="mb-2 text-body text-ink-muted">
          No template uploaded. Until there is one, a client who approves a quote
          has nothing to sign, and the agreement requirement on their account
          cannot be satisfied.
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Uploading…" : template ? "Replace it" : "Upload a template"}
        </button>
        {template ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                await deleteAgreementTemplate();
                router.refresh();
              })
            }
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-destructive hover:bg-row-hover disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
