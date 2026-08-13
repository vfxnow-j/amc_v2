"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/actions/entities";
import { Notice } from "@/components/feedback/notice";

export type CategoryDraft = {
  id: string;
  name: string;
  description: string | null;
  isConfigurable: boolean;
  isComponent: boolean;
  assets: number;
};

/**
 * Add or change an asset category.
 *
 * One form, not two. Which category it is editing comes from the URL
 * (`?edit=<id>`), so the server picks the row and this component only ever
 * renders what it was handed — selection stays shareable, survives a reload,
 * and there is no client-side copy of the list to fall out of step.
 *
 * The two flags are the part that needs explaining rather than labelling.
 * "Configurable" and "component" are what let a workstation line carry RAM and
 * GPU sub-items on an order; a category that is both, or a component category
 * with no configurable parent to hang off, is a shape the order builder cannot
 * render. So they are described in terms of what they do to an order line.
 *
 * The fields are seeded from props and then owned by this component. Selecting
 * a different row remounts it — the page keys this on the selected id — rather
 * than an effect copying props into state on every change, which is a cascade
 * of renders and one stale field away from saving somebody else's values.
 */
export function CategoryForm({ category }: { category: CategoryDraft | null }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [configurable, setConfigurable] = useState(
    category?.isConfigurable ?? false,
  );
  const [component, setComponent] = useState(category?.isComponent ?? false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      isConfigurable: configurable,
      isComponent: component,
    };
    startTransition(async () => {
      try {
        if (category) await updateCategory(category.id, payload);
        else await createCategory(payload);
        router.push("/dashboard/settings/categories");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function remove() {
    if (!category) return;
    setError("");
    startTransition(async () => {
      try {
        await deleteCategory(category.id);
        router.push("/dashboard/settings/categories");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not delete.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? (
        <Notice tone="error">
          {error}
        </Notice>
      ) : null}

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Workstations"
          className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">
          Description — optional
        </span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <Toggle
        checked={configurable}
        onChange={setConfigurable}
        label="Builds a configuration"
        detail="An order line in this category can hold sub-items — a workstation with RAM, storage and a GPU under it."
      />
      <Toggle
        checked={component}
        onChange={setComponent}
        label="Fits inside one"
        detail="Assets here can be attached under a configurable line rather than booked on their own."
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : category ? "Save changes" : "Add category"}
        </button>
        {category ? (
          <Link
            href="/dashboard/settings/categories"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
          >
            Cancel
          </Link>
        ) : null}
      </div>

      {category ? (
        <div className="rounded-well bg-sunken p-3 text-detail text-ink-muted">
          {category.assets > 0 ? (
            <p>
              {category.assets} {category.assets === 1 ? "asset is" : "assets are"}{" "}
              filed under this category, so it can&rsquo;t be deleted. Move them
              to another category first.
            </p>
          ) : confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
              >
                Yes, delete {category.name}
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
            <>
              <p className="mb-2">Nothing is filed here, so it can be removed.</p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-pill bg-panel px-3 py-1 text-pill text-destructive hover:bg-row-hover"
              >
                Delete category
              </button>
            </>
          )}
        </div>
      ) : null}
    </form>
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
