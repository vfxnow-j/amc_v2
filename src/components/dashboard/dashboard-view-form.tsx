"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  deleteDashboardView,
  saveDashboardView,
} from "@/lib/actions/dashboard";
import {
  TILE_CATEGORIES,
  TILE_IDS,
  tileMeta,
  type TileId,
} from "@/lib/dashboard/catalog";
import { slugifyViewKey } from "@/lib/dashboard/views";
import type { Role } from "@/lib/roles";
import { ROLE_OPTIONS } from "@/lib/settings/roles";
import { cn } from "@/lib/utils";

/**
 * Add or change a company dashboard view.
 *
 * **A checklist, not a second drag canvas, and that is the design rather than
 * the shortcut.** A view is a list of tiles in reading order; where each one
 * sits is derived from the catalog's default sizes and flowed left to right,
 * and every user then reshapes their own copy by dragging. Letting an
 * administrator drag the template would be storing one person's arrangement as
 * everyone else's starting point — and the first thing most of those people
 * would do is change it.
 *
 * Order still matters, though, so it is editable: the selected tiles are an
 * ordered list with move controls, and the picker below appends. That is what
 * "reading order" means on the phone, where the placement rules do not apply
 * and the dashboard is exactly this list top to bottom.
 *
 * The key is offered once and never again. It is the identity a user's saved
 * layout hangs off (`DashboardLayout.templateKey`), so renaming it would
 * silently orphan every reshaped copy of the view — the label is free to change
 * and does the job a name is for.
 *
 * Which view is being edited lives in the URL, and the page keys this component
 * on it, so picking another row remounts the form with that row's values rather
 * than an effect copying props into state on every change.
 */

export type DashboardViewDraft = {
  id: string;
  key: string;
  label: string;
  access: Role[];
  sortOrder: number;
  tiles: TileId[];
  /** How many people have dragged this view into a shape of their own. */
  reshapedBy: number;
};

const FIELD =
  "w-full rounded-well bg-sunken px-3 py-2 text-body text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-ring";
const BUTTON = "rounded-pill px-3 py-1 text-pill transition-colors disabled:opacity-50";

export function DashboardViewForm({ view }: { view: DashboardViewDraft | null }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [label, setLabel] = useState(view?.label ?? "");
  const [key, setKey] = useState(view?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(Boolean(view));
  const [sortOrder, setSortOrder] = useState(String(view?.sortOrder ?? 0));
  const [access, setAccess] = useState<Role[]>(view?.access ?? []);
  const [tiles, setTiles] = useState<TileId[]>(view?.tiles ?? []);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const derivedKey = keyTouched ? key : slugifyViewKey(label);

  function rename(next: string) {
    setLabel(next);
    if (!keyTouched) setKey(slugifyViewKey(next));
  }

  function toggleRole(role: Role) {
    setAccess((current) =>
      current.includes(role)
        ? current.filter((entry) => entry !== role)
        : [...current, role],
    );
  }

  function move(index: number, by: number) {
    setTiles((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        await saveDashboardView({
          id: view?.id,
          key: view ? undefined : derivedKey,
          label: label.trim(),
          tiles,
          access,
          sortOrder: Number(sortOrder),
        });
        router.push("/dashboard/settings/dashboards");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function remove() {
    if (!view) return;
    setError("");
    startTransition(async () => {
      try {
        await deleteDashboardView(view.id);
        router.push("/dashboard/settings/dashboards");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not delete.");
      }
    });
  }

  const unplaced = TILE_IDS.filter((id) => !tiles.includes(id));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_92px]">
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Name</span>
          <input
            value={label}
            onChange={(event) => rename(event.target.value)}
            placeholder="Logistics"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Key</span>
          <input
            value={derivedKey}
            disabled={Boolean(view)}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(slugifyViewKey(event.target.value));
            }}
            placeholder="logistics"
            className={cn(FIELD, view && "text-ink-muted")}
          />
          <span className="text-detail text-ink-muted">
            {view
              ? "Fixed — saved layouts hang off it."
              : "Set once, never changed."}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Order</span>
          <input
            value={sortOrder}
            inputMode="numeric"
            onChange={(event) => setSortOrder(event.target.value)}
            className={FIELD}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-micro uppercase text-ink-muted">
          Who can open it
        </legend>
        <p className="text-detail text-ink-muted">
          {access.length === 0
            ? "Nothing ticked means everyone who can sign in."
            : "Only the roles ticked. A tile on the view is still gated by its own access."}
        </p>
        <div className="flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((option) => {
            const on = access.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleRole(option.value)}
                title={option.detail}
                className={cn(
                  BUTTON,
                  on
                    ? "bg-accent-solid text-accent-on-solid"
                    : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="text-micro uppercase text-ink-muted">
            On this view · {tiles.length}
          </h3>
          <p className="text-detail text-ink-muted">
            Top to bottom is the reading order, which is exactly what a phone
            shows — placement only applies above 1024px.
          </p>
          {tiles.length === 0 ? (
            <p className="rounded-well bg-sunken px-3 py-2 text-detail text-ink-muted">
              Nothing yet. Pick from the list beside this one.
            </p>
          ) : (
            <ol className="flex flex-col gap-px">
              {tiles.map((id, index) => (
                <li
                  key={id}
                  className="flex items-baseline gap-2 rounded-row px-2 py-[7px] hover:bg-row-hover"
                >
                  <span className="text-detail tabular-nums text-ink-faint">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body">
                    {tileMeta(id).title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${tileMeta(id).title} up`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className={cn(BUTTON, "text-ink-muted hover:text-ink")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${tileMeta(id).title} down`}
                    onClick={() => move(index, 1)}
                    disabled={index === tiles.length - 1}
                    className={cn(BUTTON, "text-ink-muted hover:text-ink")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Take ${tileMeta(id).title} off`}
                    onClick={() =>
                      setTiles((current) =>
                        current.filter((entry) => entry !== id),
                      )
                    }
                    className={cn(BUTTON, "text-ink-muted hover:text-ink")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-micro uppercase text-ink-muted">
            Everything else · {unplaced.length}
          </h3>
          {TILE_CATEGORIES.map((category) => {
            const group = unplaced.filter(
              (id) => tileMeta(id).category === category,
            );
            if (group.length === 0) return null;

            return (
              <div key={category}>
                <p className="text-detail text-ink-faint">{category}</p>
                <ul className="flex flex-col gap-px">
                  {group.map((id) => {
                    const meta = tileMeta(id);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => setTiles((current) => [...current, id])}
                          className="w-full rounded-row px-2 py-[7px] text-left transition-colors hover:bg-row-hover"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="text-body">{meta.title}</span>
                            {meta.access === "admin" ? (
                              <span className="rounded-pill bg-sunken px-2 py-px text-pill text-ink-muted">
                                admins only
                              </span>
                            ) : null}
                            <span className="ml-auto text-detail text-ink-muted">
                              add
                            </span>
                          </span>
                          <span className="block truncate text-detail text-ink-muted">
                            {meta.blurb}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className={cn(
            BUTTON,
            "bg-accent-solid px-4 py-2 text-accent-on-solid hover:bg-accent-800",
          )}
        >
          {view ? "Save the view" : "Add the view"}
        </button>

        {view ? (
          confirming ? (
            <>
              {/* The blast radius in numbers, per the builder's own rule. The
                  reshaped copies go with the view: templateKey is a plain
                  string with no cascade, and leaving them behind would mean
                  recreating this key silently restoring arrangements of a
                  different set of tiles. */}
              <span className="text-detail text-ink-muted">
                Deletes the view and{" "}
                {view.reshapedBy === 0
                  ? "no saved layouts"
                  : `${view.reshapedBy} saved ${view.reshapedBy === 1 ? "layout" : "layouts"}`}
                .
              </span>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className={cn(
                  BUTTON,
                  "bg-destructive px-4 py-2 text-destructive-foreground",
                )}
              >
                Delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={cn(BUTTON, "text-ink-muted hover:text-ink")}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={cn(BUTTON, "ml-auto text-ink-muted hover:text-ink")}
            >
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
