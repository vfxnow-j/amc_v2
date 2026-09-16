"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EnvSection } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import {
  deleteEnvironmentItem,
  saveEnvironmentItem,
  type EnvResult,
  type EnvironmentItemInput,
} from "@/lib/actions/environment";
import {
  ENV_FIELD_HINT,
  ENV_FIELD_LABEL,
  ENV_NAME_HINT,
  ENV_SECTION_FIELDS,
  type EnvField,
} from "@/lib/tracker/environment";

/**
 * Adding and amending the *owned* column of one section of the profile.
 *
 * One editor per section rather than one for the whole card, because the
 * section decides which fields exist — `ENV_SECTION_FIELDS` — and a single form
 * with a section dropdown would have to redraw itself on every change and
 * carry answers to questions it had stopped asking.
 *
 * Plain rows in, never a Prisma import beyond types: this is a client
 * component, and anything reaching `lib/prisma` breaks the build on `dns`.
 */

export type EditableItem = {
  id: string;
  name: string;
  vendor: string | null;
  quantity: number | null;
  os: string | null;
  gpu: string | null;
  capacityTb: number | null;
  percentUsed: number | null;
  protocol: string | null;
  backup: string | null;
  speed: string | null;
  refreshAt: Date | null;
  notes: string | null;
};

const FIELD =
  "h-8 min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint disabled:opacity-50";

/** The numeric fields, so the input asks for a number pad and rejects letters. */
const NUMERIC: EnvField[] = ["quantity", "capacityTb", "percentUsed"];

type Draft = Record<string, string>;

function draftFrom(item: EditableItem | null): Draft {
  if (!item) return {};
  return {
    name: item.name,
    vendor: item.vendor ?? "",
    quantity: item.quantity?.toString() ?? "",
    os: item.os ?? "",
    gpu: item.gpu ?? "",
    capacityTb: item.capacityTb?.toString() ?? "",
    percentUsed: item.percentUsed?.toString() ?? "",
    protocol: item.protocol ?? "",
    backup: item.backup ?? "",
    speed: item.speed ?? "",
    refreshOn: item.refreshAt ? item.refreshAt.toISOString().slice(0, 10) : "",
    notes: item.notes ?? "",
  };
}

export function EnvironmentEditor({
  clientId,
  section,
  items,
}: {
  clientId: string;
  section: EnvSection;
  items: EditableItem[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Null = closed. "" = adding. An id = amending that row.
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});

  const fields = ENV_SECTION_FIELDS[section];

  function run(work: () => Promise<EnvResult>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("That didn't save.");
      }
    });
  }

  function begin(item: EditableItem | null) {
    setError("");
    setDraft(draftFrom(item));
    setOpen(item?.id ?? "");
  }

  function save() {
    const input: EnvironmentItemInput = {
      ...(open ? { id: open } : {}),
      clientId,
      section,
      name: draft.name ?? "",
      notes: draft.notes,
    };
    for (const field of fields) {
      const key = field === "refreshAt" ? "refreshOn" : field;
      (input as Record<string, unknown>)[key] = draft[key] ?? "";
    }
    run(() => saveEnvironmentItem(input), () => setOpen(null));
  }

  return (
    <div className="flex flex-col gap-1">
      {error ? <Notice tone="error">{error}</Notice> : null}

      {open === null ? (
        <button
          type="button"
          onClick={() => begin(null)}
          className="self-start rounded-pill bg-sunken px-3 py-[2px] text-pill text-ink hover:bg-row-hover"
        >
          Add what they run
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-well bg-sunken p-2">
          <input
            value={draft.name ?? ""}
            autoFocus
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder={ENV_NAME_HINT[section]}
            aria-label="What it is"
            className={`${FIELD} bg-panel`}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((field) => {
              const key = field === "refreshAt" ? "refreshOn" : field;
              return (
                <label key={field} className="flex flex-col gap-[2px]">
                  <span className="text-micro uppercase text-ink-muted">
                    {ENV_FIELD_LABEL[field]}
                  </span>
                  <input
                    type={
                      field === "refreshAt"
                        ? "date"
                        : NUMERIC.includes(field)
                          ? "number"
                          : "text"
                    }
                    min={NUMERIC.includes(field) ? 0 : undefined}
                    max={field === "percentUsed" ? 100 : undefined}
                    step={field === "capacityTb" ? "0.01" : undefined}
                    value={draft[key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    placeholder={ENV_FIELD_HINT[field]}
                    className={`${FIELD} bg-panel`}
                  />
                </label>
              );
            })}
          </div>
          <input
            value={draft.notes ?? ""}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Notes (optional)"
            aria-label="Notes"
            className={`${FIELD} bg-panel`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !(draft.name ?? "").trim()}
              onClick={save}
              className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy ? "Saving…" : open ? "Save" : "Add"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(null)}
              className="h-8 rounded-pill bg-panel px-3 text-pill text-ink"
            >
              Cancel
            </button>
            {open ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => deleteEnvironmentItem(clientId, open), () => setOpen(null))
                }
                className="ml-auto text-micro text-ink-faint underline hover:text-ink"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Amending is reached from the row itself, so the list above stays the
          thing you read and this stays the thing you type into. */}
      {open === null && items.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => begin(item)}
              className="rounded-pill bg-sunken px-2 py-[1px] text-micro text-ink-muted hover:bg-row-hover hover:text-ink"
            >
              Edit {item.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
