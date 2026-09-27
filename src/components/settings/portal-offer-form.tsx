"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { deletePortalOffer, savePortalOffer } from "@/lib/actions/portal-offers";

export type PortalOfferDraft = {
  id: string;
  kind: "ASSET" | "PACKAGE";
  targetId: string;
  title: string;
  slug: string;
  blurb: string;
  solutions: string[];
  termsBySolution: { rto: number[]; flow: number[] };
  software: string[];
  specs: { key: string; value: string }[];
  isPublic: boolean;
  isVisible: boolean;
  sortOrder: number;
};

const SOLUTIONS = [
  { id: "rental", label: "Rental", terms: null },
  { id: "rto", label: "Rent-to-own", terms: [3, 6, 12, 24, 36] },
  { id: "flow", label: "Flow", terms: [12, 24, 36, 48] },
] as const;

const FIELD =
  "h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "text-micro uppercase text-ink-muted";

/**
 * Add or change a portal offer. The selection comes from the URL and the page
 * keys this form on it, so picking another row remounts it with that row's values.
 * Prices are not entered here: the portal is quoted from the target's own rates.
 */
export function PortalOfferForm({
  offer,
  assets,
  packages,
}: {
  offer: PortalOfferDraft | null;
  assets: { id: string; name: string; priced: boolean }[];
  packages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [kind, setKind] = useState<"ASSET" | "PACKAGE">(offer?.kind ?? "ASSET");
  const [targetId, setTargetId] = useState(offer?.targetId ?? "");
  const [title, setTitle] = useState(offer?.title ?? "");
  const [slug, setSlug] = useState(offer?.slug ?? "");
  const [blurb, setBlurb] = useState(offer?.blurb ?? "");
  const [solutions, setSolutions] = useState<string[]>(offer?.solutions ?? ["rental"]);
  const [terms, setTerms] = useState<{ rto: number[]; flow: number[] }>(
    offer?.termsBySolution ?? { rto: [12, 24, 36], flow: [12, 24, 36, 48] },
  );
  const [software, setSoftware] = useState((offer?.software ?? []).join(", "));
  const [specs, setSpecs] = useState(offer?.specs.length ? offer.specs : [{ key: "", value: "" }]);
  const [isVisible, setVisible] = useState(offer?.isVisible ?? false);
  const [isPublic, setPublic] = useState(offer?.isPublic ?? false);
  const [sortOrder, setSortOrder] = useState(String(offer?.sortOrder ?? 0));

  const targets = kind === "ASSET" ? assets : packages;

  function toggle(list: string[], value: string, on: boolean) {
    return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
  }

  function done() {
    router.push("/dashboard/settings/portal-offers");
    router.refresh();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const order = Number(sortOrder);
    startTransition(async () => {
      try {
        await savePortalOffer({
          id: offer?.id ?? null,
          kind,
          targetId,
          title,
          slug,
          blurb,
          solutions,
          termsBySolution: terms,
          software: software.split(",").map((s) => s.trim()).filter(Boolean),
          specs: specs.filter((s) => s.key.trim()),
          isPublic,
          isVisible,
          sortOrder: Number.isInteger(order) ? order : 0,
        });
        done();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function remove() {
    if (!offer) return;
    startTransition(async () => {
      try {
        await deletePortalOffer(offer.id);
        done();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not delete.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex gap-2">
        {(["ASSET", "PACKAGE"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setTargetId("");
            }}
            className={`rounded-pill px-3 py-[6px] text-pill ${kind === k ? "bg-accent-solid text-accent-on-solid" : "bg-sunken text-ink-muted hover:text-ink"}`}
          >
            {k === "ASSET" ? "An item" : "A package"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>{kind === "ASSET" ? "Item" : "Package"}</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={FIELD}>
          <option value="">Choose…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {"priced" in t && !t.priced ? " (no monthly rate)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} placeholder="e.g. RTX 5090 workstation" />
      </label>
      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Slug — optional, made from the title</span>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className={FIELD} placeholder="rtx-5090-workstation" />
      </label>
      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Blurb — optional</span>
        <textarea
          value={blurb}
          onChange={(e) => setBlurb(e.target.value)}
          rows={3}
          className="rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-well bg-sunken p-2">
        <legend className={`${LABEL} px-1`}>Solutions and terms</legend>
        {SOLUTIONS.map((s) => {
          const on = solutions.includes(s.id);
          return (
            <div key={s.id} className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-detail font-bold text-ink">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setSolutions(toggle(solutions, s.id, e.target.checked))}
                  className="size-[14px] accent-accent-solid"
                />
                {s.label}
              </label>
              {on && s.terms ? (
                <div className="flex flex-wrap gap-3 pl-6">
                  {s.terms.map((t) => {
                    const key = s.id as "rto" | "flow";
                    const checked = terms[key].includes(t);
                    return (
                      <label key={t} className="flex items-center gap-1 text-detail text-ink-muted">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setTerms({
                              ...terms,
                              [key]: e.target.checked
                                ? [...terms[key], t].sort((a, b) => a - b)
                                : terms[key].filter((x) => x !== t),
                            })
                          }
                          className="size-[14px] accent-accent-solid"
                        />
                        {t} mo
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Software — comma-separated</span>
        <input value={software} onChange={(e) => setSoftware(e.target.value)} className={FIELD} placeholder="Houdini, Nuke, Unreal" />
      </label>

      <div className="flex flex-col gap-[3px]">
        <span className={LABEL}>Specs shown on the portal</span>
        {specs.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row.key}
              onChange={(e) => setSpecs(specs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              placeholder="GPU"
              className={`${FIELD} w-28`}
            />
            <input
              value={row.value}
              onChange={(e) => setSpecs(specs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              placeholder="RTX 5090 32GB"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button
              type="button"
              aria-label="Remove spec"
              onClick={() => setSpecs(specs.length > 1 ? specs.filter((_, j) => j !== i) : [{ key: "", value: "" }])}
              className="rounded-pill bg-sunken px-2 text-pill text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSpecs([...specs, { key: "", value: "" }])}
          className="self-start rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted hover:text-ink"
        >
          Add a spec
        </button>
      </div>

      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Sort order</span>
        <input type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={`${FIELD} w-24`} />
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded-well bg-sunken p-2">
        <input type="checkbox" checked={isVisible} onChange={(e) => setVisible(e.target.checked)} className="mt-[2px] size-[14px] accent-accent-solid" />
        <span>
          <span className="block text-detail font-bold text-ink">Published</span>
          <span className="block text-detail text-ink-muted">The portal can list and quote it. Off, it does not exist to the portal.</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 rounded-well bg-sunken p-2">
        <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} className="mt-[2px] size-[14px] accent-accent-solid" />
        <span>
          <span className="block text-detail font-bold text-ink">On the public site</span>
          <span className="block text-detail text-ink-muted">Its price band — never the exact price — appears on the public site, once published.</span>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim() || !targetId}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : offer ? "Save changes" : "Add offer"}
        </button>
        {offer ? (
          <Link
            href="/dashboard/settings/portal-offers"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
          >
            Cancel
          </Link>
        ) : null}
      </div>

      {offer ? (
        <div className="rounded-well bg-sunken p-3 text-detail text-ink-muted">
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
              >
                Yes, delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-pill bg-panel px-3 py-1 text-pill text-ink-muted hover:text-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-pill bg-panel px-3 py-1 text-pill text-destructive hover:bg-row-hover"
            >
              Delete offer
            </button>
          )}
        </div>
      ) : null}
    </form>
  );
}
