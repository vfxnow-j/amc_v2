"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ScanField } from "@/components/scan/scan-field";
import { ScanLog, type ScanEntry } from "@/components/scan/scan-log";
import { Notice } from "@/components/feedback/notice";
import {
  addToListByBarcode,
  createScanList,
  getScanLists,
} from "@/lib/actions/scan-lists";
import {
  bulkUpdateFromScanList,
  getScanListBulkTarget,
  type BulkTarget,
} from "@/lib/actions/scan-list-bulk";
import type { Tone } from "@/lib/scan/audio";

/**
 * Building a list of units, and running one change over everything on it.
 *
 * The models and the read screens already existed — `ScanList`, `ScanListItem`,
 * `/dashboard/audits?tab=scan-lists` and the list record — and **nothing in the
 * app could write to them.** `createScanList` and `addToListByBarcode` were
 * ported and called from nowhere. This is the missing half, not a new feature:
 * the record stays where it is and stays the place you read a list.
 *
 * This is the safe mode, and the other three offer it when they refuse. Adding
 * a barcode to a list has no commercial consequence, so nothing here asks a
 * question mid-scan: a duplicate is a warn tone and an unknown barcode is saved
 * as unregistered, exactly as the ported action already decided.
 *
 * The bulk action is where the care goes, and the reason is in the schema.
 * **Rates live on `Asset`, not `AssetUnit`.** Scanning three of forty RTX 5090s
 * and setting a daily rate changes it on all forty and on every future quote
 * that prices one. The person is holding three boxes and thinking about three
 * boxes, so the confirmation states the blast radius in numbers before anything
 * is written. Shipping this without that sentence would be the most dangerous
 * thing on the scan surface.
 */

const LOG_CAP = 200;

type List = { id: string; name: string; items: number };

/** What the ported `getScanLists` returns, narrowed to what this needs. */
type ListRow = { id: string; name: string; _count: { items: number } };

function toList(row: ListRow): List {
  return { id: row.id, name: row.name, items: row._count.items };
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function ListMode() {
  const [lists, setLists] = useState<List[]>([]);
  const [list, setList] = useState<List | null>(null);
  const [newName, setNewName] = useState("");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [added, setAdded] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [target, setTarget] = useState<BulkTarget | null>(null);
  const [rate, setRate] = useState("");
  const [tier, setTier] = useState<"dailyRate" | "weeklyRate" | "monthlyRate">("monthlyRate");
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);

  const loadLists = useCallback(async () => {
    const rows = (await getScanLists()) as ListRow[];
    setLists(rows.map(toList));
  }, []);

  // Set inside the promise callback, not straight out of the effect body — and
  // guarded, so a list that arrives after the mode was switched away is dropped
  // rather than setting state on a surface nobody is looking at.
  useEffect(() => {
    let alive = true;
    void getScanLists().then((rows) => {
      if (alive) setLists((rows as ListRow[]).map(toList));
    });
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback(
    async (code: string): Promise<Tone> => {
      if (!list) return "error";
      const key = `list-${seq.current++}`;
      setEntries((current) =>
        [{ key, code, state: "pending" as const }, ...current].slice(0, LOG_CAP),
      );
      setPending((count) => count + 1);

      const result = await addToListByBarcode(list.id, code);

      let tone: Tone = "ok";
      let message = "Added.";
      if (!result.success) {
        // ScanResult is shared with check-out, so its failure arm can carry an
        // over-scan conflict. Adding to a list never produces one — there is no
        // quantity to exceed — but the type allows it, so narrow rather than
        // assume.
        const reason = "error" in result ? result.error : "Could not add it.";
        // "Already on this list" is not a failure — the unit is on the list,
        // which is what the person wanted. A warn tone says "heard you, nothing
        // changed" without reading as a fault.
        const duplicate = /already on this list/i.test(reason);
        tone = duplicate ? "warn" : "error";
        message = reason;
      } else if (result.warning) {
        tone = "warn";
        message = result.warning;
        setAdded((count) => count + 1);
      } else {
        setAdded((count) => count + 1);
      }

      setEntries((current) =>
        current.map((entry) =>
          entry.key === key
            ? { ...entry, state: "done" as const, tone, message }
            : entry,
        ),
      );
      setPending((count) => Math.max(0, count - 1));
      return tone;
    },
    [list],
  );

  async function make() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = (await createScanList({ name })) as { id: string; name: string };
      setList({ id: created.id, name: created.name, items: 0 });
      setNewName("");
      await loadLists();
    } catch (cause) {
      setNotice({
        tone: "error",
        message: cause instanceof Error ? cause.message : "Could not create it.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!list) return;
    setBusy(true);
    setTarget(await getScanListBulkTarget(list.id));
    setBusy(false);
  }

  async function apply() {
    if (!list) return;
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) {
      setNotice({ tone: "error", message: "Enter a rate of zero or more." });
      return;
    }
    setBusy(true);
    const outcome = await bulkUpdateFromScanList(list.id, { [tier]: value });
    setBusy(false);
    setNotice({
      tone: outcome.status === "ok" ? "ok" : "error",
      message: outcome.message,
    });
    if (outcome.status === "ok") {
      setTarget(null);
      setRate("");
    }
  }

  if (!list) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div>
          <h2 className="text-card-title">Which list?</h2>
          <p className="text-detail text-ink-muted">
            A saved list of units you can come back to, and run one change over.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") make();
            }}
            placeholder="Name a new list, e.g. Shelf 4 audit"
            className="h-9 flex-1 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={make}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-40"
          >
            Start it
          </button>
        </div>

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lists.length === 0 ? (
            <p className="py-6 text-detail text-ink-muted">
              No lists yet. Name one above and start scanning into it.
            </p>
          ) : (
            <ul className="flex flex-col gap-[2px]">
              {lists.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setList(row)}
                    className="flex w-full items-center gap-3 rounded-row px-2 py-2 text-left transition-colors hover:bg-row-hover"
                  >
                    <span className="flex-1 truncate text-detail font-bold">
                      {row.name}
                    </span>
                    <span className="flex-none text-detail text-ink-muted">
                      {row.items} {row.items === 1 ? "item" : "items"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-card-title">{list.name}</h2>
          <span className="text-detail text-ink-muted">
            {added} added this session
          </span>
          <Link
            href={`/dashboard/audits/scan-lists/${list.id}`}
            className="ml-auto text-detail text-accent-text hover:underline"
          >
            Open the list
          </Link>
        </div>

        <ScanField
          onCommit={commit}
          pending={pending}
          placeholder={`Scan items onto ${list.name}`}
        />

        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={preview}
            className="rounded-pill bg-sunken px-4 py-2 text-pill text-ink transition-colors hover:bg-row-hover disabled:opacity-40"
          >
            Change the rate on everything here
          </button>
          <button
            type="button"
            onClick={() => {
              setList(null);
              setEntries([]);
              setAdded(0);
              setTarget(null);
              setNotice(null);
              void loadLists();
            }}
            className="ml-auto text-detail text-ink-muted hover:text-ink"
          >
            Another list
          </button>
        </div>

        {target ? (
          <div
            role="alertdialog"
            aria-label="What this would change"
            className="rounded-bubble bg-accent-tint p-3"
          >
            {target.models.length === 0 ? (
              <p className="text-detail text-accent-on-tint">
                Nothing on this list resolves to a model yet.
              </p>
            ) : (
              <>
                <p className="text-card-title text-accent-on-tint">
                  This changes {target.models.length}{" "}
                  {target.models.length === 1 ? "model" : "models"}
                </p>
                {/* The sentence this whole panel exists for. */}
                <p className="mt-1 text-detail text-accent-on-tint">
                  Rates are set on the model, not the unit. Those models cover{" "}
                  {target.models.reduce((sum, m) => sum + m.inFleet, 0)} units in
                  the fleet, and {target.unitsNotOnList} of them are not on this
                  list — they change too.
                  {target.unresolved > 0
                    ? ` ${target.unresolved} scanned ${target.unresolved === 1 ? "code matches" : "codes match"} no unit and can carry no change.`
                    : ""}
                </p>

                <ul className="mt-3 flex flex-col gap-[2px]">
                  {target.models.map((model) => (
                    <li
                      key={model.assetId}
                      className="flex items-center gap-2 rounded-row bg-panel px-2 py-1 text-detail"
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                      <span className="flex-none text-ink-muted">
                        {model.onList} of {model.inFleet}
                      </span>
                      <span className="w-[92px] flex-none text-right tabular-nums text-ink-muted">
                        {model.monthlyRate === null
                          ? "—"
                          : `${MONEY.format(model.monthlyRate)}/mo`}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-[3px]">
                    <span className="text-micro uppercase text-accent-on-tint">
                      Tier
                    </span>
                    <select
                      value={tier}
                      onChange={(event) =>
                        setTier(event.target.value as typeof tier)
                      }
                      className="h-9 rounded-well border-0 bg-panel px-2 text-detail text-ink outline-none"
                    >
                      <option value="dailyRate">Daily</option>
                      <option value="weeklyRate">Weekly</option>
                      <option value="monthlyRate">Monthly</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-[3px]">
                    <span className="text-micro uppercase text-accent-on-tint">
                      New rate
                    </span>
                    <input
                      value={rate}
                      inputMode="decimal"
                      onChange={(event) => setRate(event.target.value)}
                      placeholder="0.00"
                      className="h-9 w-[120px] rounded-well border-0 bg-panel px-3 text-right text-detail tabular-nums text-ink outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || rate.trim() === ""}
                    onClick={apply}
                    className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-40"
                  >
                    Change them
                  </button>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    className="h-9 px-2 text-detail text-accent-on-tint underline-offset-2 hover:underline"
                  >
                    Leave them alone
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
        <header className="flex items-baseline gap-2 px-4 pb-2">
          <h2 className="text-card-title">This session</h2>
          {entries.length ? (
            <span className="text-detail text-ink-muted">
              {entries.length} scanned
            </span>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ScanLog entries={entries} />
        </div>
      </section>
    </div>
  );
}
