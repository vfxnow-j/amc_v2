"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePortalOfferImage,
  movePortalOfferImage,
  setPortalOfferImageAlt,
} from "@/lib/actions/portal-offer-images";

export type OfferImage = { id: string; alt: string | null; width: number; height: number };

/**
 * Product images for one offer. The first is the one the portal shows first.
 * Uploads go to /api/portal-images, where each file is checked and re-encoded
 * (lib/portal/images.ts); what comes back here is what the portal will get.
 */
export function PortalOfferImages({
  offerId,
  images,
  max,
  canEdit,
}: {
  offerId: string;
  images: OfferImage[];
  max: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function run(work: () => Promise<void>) {
    setError("");
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.");
      }
    });
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setMessage("");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("offerId", offerId);
      for (const file of Array.from(files)) form.append("file", file);
      const response = await fetch("/api/portal-images", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as {
        stored?: number;
        refused?: { file: string; message: string }[];
        error?: string;
      };
      if (body.error) setError(body.error);
      const refused = body.refused ?? [];
      setMessage(
        [
          body.stored ? `${body.stored} added.` : "",
          ...refused.map((r) => `${r.file}: ${r.message}`),
        ]
          .filter(Boolean)
          .join(" "),
      );
      router.refresh();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {images.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-1 rounded-well bg-sunken p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a session-gated route, not a static asset */}
              <img
                src={`/api/portal-images/${image.id}`}
                alt={image.alt ?? ""}
                className="aspect-[4/3] w-full rounded-well bg-panel object-contain"
              />
              <input
                defaultValue={image.alt ?? ""}
                disabled={!canEdit}
                placeholder="Alt text"
                maxLength={200}
                onBlur={(e) => {
                  if (e.target.value !== (image.alt ?? "")) run(() => setPortalOfferImageAlt(image.id, e.target.value));
                }}
                className="h-8 rounded-well border-0 bg-panel px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between text-detail">
                <span className="tabular-nums text-ink-faint">
                  {index === 0 ? "First · " : ""}
                  {image.width}×{image.height}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || busy || index === 0}
                    onClick={() => run(() => movePortalOfferImage(image.id, "up"))}
                    className="text-accent-text hover:underline disabled:opacity-40"
                    aria-label="Move earlier"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit || busy || index === images.length - 1}
                    onClick={() => run(() => movePortalOfferImage(image.id, "down"))}
                    className="text-accent-text hover:underline disabled:opacity-40"
                    aria-label="Move later"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit || busy}
                    onClick={() => run(() => deletePortalOfferImage(image.id))}
                    className="text-destructive hover:underline disabled:opacity-40"
                  >
                    Remove
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-detail text-ink-muted">No images yet. The portal shows it without one.</p>
      )}
      {canEdit ? (
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={uploading || images.length >= max}
          onChange={(e) => upload(e.target.files)}
          className="text-detail text-ink-muted file:mr-2 file:rounded-pill file:border-0 file:bg-accent-solid file:px-3 file:py-[5px] file:text-pill file:text-accent-on-solid"
        />
        <span className="text-detail text-ink-faint">
          JPEG, PNG or WebP, up to 15 MB · {images.length}/{max}
        </span>
      </div>
      ) : null}
      {uploading ? <span className="text-detail text-ink-muted">Uploading…</span> : null}
      {message ? <span className="text-detail text-ink-muted">{message}</span> : null}
      {error ? <span className="text-detail text-destructive">{error}</span> : null}
    </div>
  );
}
