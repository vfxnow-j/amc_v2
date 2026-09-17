"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { deleteDocument } from "@/lib/actions/documents";

const TYPES = [
  { value: "LEASE_AGREEMENT", label: "Agreement" },
  { value: "STATEMENT", label: "Statement" },
  { value: "PAYOFF_LETTER", label: "Payoff letter" },
  { value: "OTHER", label: "Other" },
] as const;

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((type) => [type.value, type.label]));

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Doc = { id: string; filename: string; documentType: string; fileSize: number; createdAt: string; uploadedBy: string | null };

/**
 * A lease's own paperwork: the agreement, lender statements, the payoff letter.
 * Drop files on the card or choose them, say what they are, and they upload —
 * several at once, 25 MB each. Moving one to trash is reversible from Settings →
 * Documents.
 */
export function LeaseDocuments({ leaseId, documents }: { leaseId: string; documents: Doc[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<string>("LEASE_AGREEMENT");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setMessage(null);
    setUploading(true);
    const form = new FormData();
    form.set("entityType", "LEASE");
    form.set("entityId", leaseId);
    form.set("documentType", type);
    for (const file of list) form.append("file", file);
    try {
      const response = await fetch("/api/documents/upload", { method: "POST", body: form });
      const body = (await response.json()) as {
        stored?: { filename: string }[];
        refused?: { file: string; message: string }[];
        error?: string;
      };
      const stored = body.stored ?? [];
      const refused = body.refused ?? [];
      if (body.error) setMessage({ tone: "error", text: body.error });
      else
        setMessage({
          tone: refused.length && !stored.length ? "error" : "ok",
          text: [
            stored.length ? `Uploaded ${stored.map((doc) => doc.filename).join(", ")}.` : "",
            refused.length ? `Not uploaded: ${refused.map((r) => `${r.file} — ${r.message}`).join("; ")}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
      if (stored.length) router.refresh();
    } catch {
      setMessage({ tone: "error", text: "The upload didn't go through. Check the connection and try again." });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center gap-2 rounded-well border border-dashed p-3 transition-colors ${
          dragging ? "border-accent-solid bg-accent-tint" : "border-hairline bg-sunken"
        }`}
      >
        <Upload className="size-4 text-ink-faint" aria-hidden />
        <span className="min-w-0 flex-1 text-detail text-ink-muted">
          {uploading ? "Uploading…" : "Drop files here, or"}
        </span>
        <label className="flex items-center gap-1 text-detail text-ink-muted">
          <span className="sr-only">Document type</span>
          <select
            id="lease-doc-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-8 rounded-well border border-hairline bg-panel px-2 text-detail text-ink outline-none"
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={uploading}
          onClick={() => input.current?.click()}
          className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Choose files
        </button>
        <input
          ref={input}
          id="lease-doc-files"
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {documents.length === 0 ? (
        <p className="text-detail text-ink-muted">
          No documents yet. Upload the agreement first — it&rsquo;s what the terms on this page come from.
        </p>
      ) : (
        <ul className="flex flex-col gap-px">
          {documents.map((doc) => (
            <li key={doc.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-row px-2 py-[6px] text-detail odd:bg-row-alt">
              <a href={`/api/documents/${doc.id}`} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-2 hover:underline">
                <FileText className="size-4 flex-none text-ink-faint" aria-hidden />
                <span className="min-w-0 truncate font-bold">{doc.filename}</span>
              </a>
              <span className="text-ink-muted">
                {TYPE_LABEL[doc.documentType] ?? doc.documentType} · {size(doc.fileSize)} · {DAY.format(new Date(doc.createdAt))}
                {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
              </span>
              <a href={`/api/documents/${doc.id}?download=1`} aria-label={`Download ${doc.filename}`} className="text-ink-faint hover:text-ink">
                <Download className="size-4" aria-hidden />
              </a>
              <button
                type="button"
                disabled={busy}
                aria-label={`Move ${doc.filename} to trash`}
                onClick={() => {
                  if (!window.confirm(`Move ${doc.filename} to trash? It can be restored from Settings → Documents.`)) return;
                  startTransition(async () => {
                    try {
                      await deleteDocument(doc.id, "Removed from the lease record");
                      setMessage({ tone: "ok", text: `${doc.filename} moved to trash.` });
                      router.refresh();
                    } catch (error) {
                      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Couldn't move it to trash." });
                    }
                  });
                }}
                className="text-ink-faint hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
