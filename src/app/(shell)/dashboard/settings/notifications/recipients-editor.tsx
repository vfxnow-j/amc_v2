"use client";

import { useState, useTransition } from "react";
import { saveRecipientsAction } from "@/lib/actions/notification-settings";
import {
  CATEGORY_META,
  RECIPIENT_CATEGORIES,
  isAddress,
  normalizeAddress,
  type RecipientCategory,
} from "@/lib/notifications/recipients-schema";

/**
 * The company-wide recipient list: addresses (people or distribution lists),
 * an optional label, and a tick per kind of mail.
 *
 * Edited as a whole and saved in one go, because it is one setting row; the
 * server validates every row again and keeps any key on a stored entry that
 * this screen doesn't show. Imports only the Prisma-free schema module — a
 * client component that reached `lib/prisma` would fail the build on `dns`.
 */

export type EditorRow = {
  email: string;
  name: string;
  categories: Record<RecipientCategory, boolean>;
};

const NONE = Object.fromEntries(RECIPIENT_CATEGORIES.map((category) => [category, false])) as Record<
  RecipientCategory,
  boolean
>;

const GRID = {
  gridTemplateColumns: `minmax(220px,1.6fr) repeat(${RECIPIENT_CATEGORIES.length}, minmax(58px,1fr)) 64px`,
};

export function RecipientsEditor({ initial }: { initial: EditorRow[] }) {
  const [rows, setRows] = useState<EditorRow[]>(initial);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftName, setDraftName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  function change(next: EditorRow[]) {
    setRows(next);
    setDirty(true);
    setOutcome(null);
  }

  function add() {
    const email = draftEmail.trim();
    if (!isAddress(email)) {
      setAddError("Enter an email address — a person or a distribution list.");
      return;
    }
    if (rows.some((row) => normalizeAddress(row.email) === normalizeAddress(email))) {
      setAddError(`${email} is already on the list.`);
      return;
    }
    change([...rows, { email, name: draftName.trim(), categories: { ...NONE } }]);
    setDraftEmail("");
    setDraftName("");
    setAddError(null);
  }

  function save() {
    start(async () => {
      const result = await saveRecipientsAction(rows);
      setOutcome(result);
      if (result.ok) setDirty(false);
    });
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="overflow-x-auto px-2">
        <div className="min-w-[860px]">
          <div
            className="grid items-end gap-1 px-2 pb-[6px] text-colhead uppercase text-ink-muted"
            style={GRID}
          >
            <span>Address</span>
            {RECIPIENT_CATEGORIES.map((category) => (
              <span key={category} className="text-center" title={CATEGORY_META[category].label}>
                {CATEGORY_META[category].short}
              </span>
            ))}
            <span />
          </div>

          {rows.length === 0 ? (
            <p className="px-2 py-3 text-body text-ink-muted">
              Nobody is on the list, so none of the mail below goes anywhere. Add an address to start.
            </p>
          ) : (
            <ul className="flex flex-col gap-[2px]">
              {rows.map((row, index) => (
                <li
                  key={normalizeAddress(row.email)}
                  className={`grid items-center gap-1 rounded-row px-2 py-[5px] ${index % 2 === 1 ? "bg-row-alt" : ""}`}
                  style={GRID}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold">{row.email}</span>
                    <input
                      value={row.name}
                      onChange={(event) =>
                        change(rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                      }
                      placeholder="Label (optional)"
                      aria-label={`Label for ${row.email}`}
                      maxLength={80}
                      className="mt-[2px] h-6 min-w-0 rounded-well bg-transparent px-1 text-detail text-ink-muted placeholder:text-ink-faint hover:bg-sunken focus:bg-sunken"
                    />
                  </span>
                  {RECIPIENT_CATEGORIES.map((category) => (
                    <span key={category} className="flex justify-center">
                      <input
                        type="checkbox"
                        checked={row.categories[category]}
                        onChange={(event) =>
                          change(
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, categories: { ...r.categories, [category]: event.target.checked } }
                                : r,
                            ),
                          )
                        }
                        aria-label={`${row.email} receives ${CATEGORY_META[category].label}`}
                        className="size-[14px] accent-[var(--accent-solid)]"
                      />
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => change(rows.filter((_, i) => i !== index))}
                    className="justify-self-end rounded-pill px-2 py-[2px] text-pill text-ink-muted hover:bg-row-hover hover:text-destructive"
                    aria-label={`Remove ${row.email}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-well bg-sunken p-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-detail text-ink-muted">
          Add an address
          <input
            type="email"
            value={draftEmail}
            onChange={(event) => setDraftEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="accounting@example.com"
            className="h-8 rounded-well bg-panel px-3 text-body text-ink placeholder:text-ink-faint"
          />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-detail text-ink-muted">
          Label (optional)
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Accounting list"
            maxLength={80}
            className="h-8 rounded-well bg-panel px-3 text-body text-ink placeholder:text-ink-faint"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="h-8 rounded-pill bg-panel px-4 text-pill text-ink hover:bg-row-hover"
        >
          Add
        </button>
        {addError ? <p className="w-full text-detail text-destructive">{addError}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save recipients"}
        </button>
        {dirty && !pending ? <span className="text-detail text-ink-muted">Unsaved changes. New addresses tick nothing until you choose.</span> : null}
        {outcome && !pending ? (
          <span role="status" className={`text-detail ${outcome.ok ? "text-ink-muted" : "text-destructive"}`}>
            {outcome.message}
          </span>
        ) : null}
      </div>

      <dl className="mx-4 mb-4 grid gap-x-4 gap-y-2 rounded-well bg-sunken p-3 text-detail md:grid-cols-2">
        {RECIPIENT_CATEGORIES.map((category) => (
          <div key={category} className="min-w-0">
            <dt className="font-bold">
              {CATEGORY_META[category].short} · {CATEGORY_META[category].label}
            </dt>
            <dd className="text-ink-muted">{CATEGORY_META[category].what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
