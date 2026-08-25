"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { applyGroupings } from "@/lib/actions/families";
import type { FamilySuggestion } from "@/lib/inventory/families";

type Edit = { picked: boolean; name: string; excluded: Set<string> };

/**
 * Reviewing proposed asset groupings.
 *
 * Everything here is a proposal until somebody says otherwise, because whether
 * "RTX 5090 32G" and "RTX 5090 32GB OC" are the same product is a judgment
 * about hardware and not a fact in the data. So: nothing is pre-selected,
 * every name is editable, and any model can be dropped from a group without
 * losing the rest of it.
 *
 * Unchecking every model in a group unchecks the group, rather than leaving a
 * checked group that would create an asset with nothing under it.
 *
 * A model left out of everything is not a failure state. 146 of the 224 have
 * nothing to sit beside, and the screen says so rather than nagging.
 */
export function GroupingReview({
  suggestions,
}: {
  suggestions: FamilySuggestion[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Record<number, Edit>>(() =>
    Object.fromEntries(
      suggestions.map((suggestion, index) => [
        index,
        { picked: false, name: suggestion.name, excluded: new Set<string>() },
      ]),
    ),
  );

  function update(index: number, patch: Partial<Edit>) {
    setEdits((current) => ({ ...current, [index]: { ...current[index], ...patch } }));
  }

  function toggleModel(index: number, assetId: string) {
    setEdits((current) => {
      const edit = current[index];
      const excluded = new Set(edit.excluded);
      if (excluded.has(assetId)) excluded.delete(assetId);
      else excluded.add(assetId);
      const remaining = suggestions[index].assets.length - excluded.size;
      return {
        ...current,
        [index]: { ...edit, excluded, picked: remaining > 0 && edit.picked },
      };
    });
  }

  const chosen = useMemo(
    () =>
      suggestions
        .map((suggestion, index) => ({ suggestion, edit: edits[index] }))
        .filter(({ edit }) => edit.picked)
        .map(({ suggestion, edit }) => ({
          name: edit.name,
          assetIds: suggestion.assets
            .map((asset) => asset.id)
            .filter((id) => !edit.excluded.has(id)),
        }))
        .filter((group) => group.assetIds.length > 0),
    [suggestions, edits],
  );

  const modelCount = chosen.reduce((n, g) => n + g.assetIds.length, 0);

  function apply() {
    setError("");
    setDone("");
    startTransition(async () => {
      const result = await applyGroupings(chosen);
      if (result.status === "error") setError(result.message);
      else {
        setDone(result.message);
        router.refresh();
      }
    });
  }

  function setAll(picked: boolean) {
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, edit]) => [key, { ...edit, picked }]),
      ),
    );
  }

  if (suggestions.length === 0) {
    return (
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-md text-center text-body text-balance text-ink-muted">
          Nothing left to suggest. Every model that shares its leading words with
          another in the same category has been grouped — the rest stand alone,
          which is a normal resting state and not a backlog.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-wrap items-center gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
        <span className="text-body">
          <span className="font-bold">{chosen.length}</span> of{" "}
          {suggestions.length} selected
          {modelCount > 0 ? (
            <span className="text-ink-muted">
              {" "}
              · {modelCount} {modelCount === 1 ? "model" : "models"}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy || chosen.length === 0}
          className="ml-auto rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors disabled:opacity-50"
        >
          {busy
            ? "Creating…"
            : `Create ${chosen.length || ""} ${chosen.length === 1 ? "asset" : "assets"}`.trim()}
        </button>
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}

      <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        {suggestions.map((suggestion, index) => {
          const edit = edits[index];
          const kept = suggestion.assets.filter(
            (asset) => !edit.excluded.has(asset.id),
          );
          const units = kept.reduce((n, asset) => n + asset.units, 0);

          return (
            <section
              key={`${suggestion.name}-${index}`}
              className={`flex flex-col rounded-card p-3 shadow-sm transition-colors ${
                edit.picked ? "bg-accent-tint" : "bg-panel"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={edit.picked}
                  disabled={kept.length === 0}
                  onChange={(event) =>
                    update(index, { picked: event.target.checked })
                  }
                  aria-label={`Create ${edit.name}`}
                  className="mt-[6px] size-4 flex-none accent-[var(--accent-solid)]"
                />
                <span className="min-w-0 flex-1">
                  <input
                    value={edit.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    aria-label={`Name for ${suggestion.name}`}
                    className="h-7 w-full rounded-row border-0 bg-sunken px-2 text-body font-bold text-ink outline-none"
                  />
                  <span className="mt-1 block text-detail text-ink-muted">
                    {kept.length} {kept.length === 1 ? "model" : "models"} ·{" "}
                    {units} {units === 1 ? "unit" : "units"} ·{" "}
                    {suggestion.categoryName}
                  </span>
                </span>
              </div>

              <ul className="mt-2 flex flex-col gap-px">
                {suggestion.assets.map((asset) => {
                  const excluded = edit.excluded.has(asset.id);
                  return (
                    <li key={asset.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-row px-2 py-1 text-detail transition-colors hover:bg-row-hover ${
                          excluded ? "text-ink-faint line-through" : "text-ink-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onChange={() => toggleModel(index, asset.id)}
                          className="size-3 flex-none accent-[var(--accent-solid)]"
                        />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        <span className="flex-none tabular-nums">
                          {asset.units}u
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
