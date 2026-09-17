"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { usePricingFeedback } from "@/components/pricing/pricing-feedback";
import { setAssetRatesBulk } from "@/lib/actions/pricing";
import {
  applyBulkChange,
  bulkChangeProblem,
  type BulkRateChange,
} from "@/lib/pricing/bulk-rates";
import { moneyExact } from "@/lib/format";
import type { RateTier } from "@/lib/queries/pricing";

/**
 * Bulk edit on Operate → Pricing: one set of figures for several models.
 *
 * The inline cell is right for turning 400 into 425 on one model and wrong for
 * a price rise across a category, which is forty blurs and forty chances to
 * mistype one. So the catalogue has a mode: switch it on, tick the models, and
 * one dialog takes the new figures, previews every old → new, and saves them in
 * a single action.
 *
 * Unlike the inline cell this one does ask first. A single price change shows
 * its result in the cell it was typed into; a change across forty rows, some of
 * them on another page of the table, does not, and a percentage is easy to get
 * wrong by a factor of ten. The preview is the confirmation.
 *
 * The pieces sit in different parts of the page — the switch in the header,
 * the checkboxes inside server-rendered rows, the bar and the dialog above the
 * table — so they share state through a provider wrapping the whole screen,
 * the same arrangement `PricingFeedback` uses for the cells.
 *
 * The selection holds each model's name and rates as they were rendered, not
 * just its id, so it survives paging and searching: ticking models on page one
 * and page three and then opening the dialog still lists all of them. The
 * snapshot is only used for the preview. The action reads the real rates in
 * its own transaction and adjusts from those.
 */

export type BulkRow = {
  id: string;
  name: string;
  rates: Record<RateTier, number | null>;
};

export type BulkTier = { tier: RateTier; label: string };

type BulkState = {
  tiers: BulkTier[];
  active: boolean;
  selected: Map<string, BulkRow>;
  start: () => void;
  stop: () => void;
  toggle: (row: BulkRow) => void;
  /** Adds every row when `on`, removes every row otherwise. */
  setMany: (rows: BulkRow[], on: boolean) => void;
  /** Refreshes a snapshot after its row re-renders with new rates. */
  sync: (row: BulkRow) => void;
};

const BulkContext = createContext<BulkState | null>(null);

function useBulk(): BulkState | null {
  return useContext(BulkContext);
}

export function BulkRatesProvider({
  tiers,
  children,
}: {
  tiers: BulkTier[];
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Map<string, BulkRow>>(new Map());

  const state: BulkState = {
    tiers,
    active,
    selected,
    start: () => setActive(true),
    stop: () => {
      setActive(false);
      setSelected(new Map());
    },
    toggle: (row) =>
      setSelected((current) => {
        const next = new Map(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.set(row.id, row);
        return next;
      }),
    setMany: (rows, on) =>
      setSelected((current) => {
        const next = new Map(current);
        for (const row of rows) {
          if (on) next.set(row.id, row);
          else next.delete(row.id);
        }
        return next;
      }),
    sync: (row) =>
      setSelected((current) => {
        const held = current.get(row.id);
        if (!held || sameRow(held, row)) return current;
        const next = new Map(current);
        next.set(row.id, row);
        return next;
      }),
  };

  return <BulkContext value={state}>{children}</BulkContext>;
}

function sameRow(a: BulkRow, b: BulkRow): boolean {
  if (a.name !== b.name) return false;
  return (Object.keys(a.rates) as RateTier[]).every(
    (tier) => a.rates[tier] === b.rates[tier],
  );
}

/** The header switch. Reads "Bulk edit" off, "Done" on. */
export function BulkEditToggle() {
  const bulk = useBulk();
  if (!bulk) return null;

  return (
    <button
      type="button"
      aria-pressed={bulk.active}
      onClick={bulk.active ? bulk.stop : bulk.start}
      className={`rounded-pill px-4 py-[6px] text-pill transition-colors duration-[160ms] ${
        bulk.active
          ? "bg-accent-solid text-accent-on-solid"
          : "bg-sunken text-ink hover:bg-row-hover"
      }`}
    >
      {bulk.active ? "Done" : "Bulk edit"}
    </button>
  );
}

/**
 * The tick box at the start of a row. Renders nothing outside bulk mode, so
 * the table looks exactly as it did until somebody asks for this.
 */
export function BulkSelectCheck({ row }: { row: BulkRow }) {
  const bulk = useBulk();
  const sync = bulk?.sync;

  // A router refresh after an inline edit re-renders the row with its new
  // rates; a held snapshot should follow, or the preview shows the old figure.
  useEffect(() => {
    sync?.(row);
    // `row` is rebuilt every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.name, JSON.stringify(row.rates)]);

  if (!bulk?.active) return null;

  return (
    <input
      type="checkbox"
      checked={bulk.selected.has(row.id)}
      onChange={() => bulk.toggle(row)}
      aria-label={`Select ${row.name}`}
      className="size-4 flex-none accent-[var(--color-accent-solid)]"
    />
  );
}

/**
 * The strip above the table while bulk mode is on: select the visible rows,
 * the running count, and the way into the dialog.
 */
export function BulkSelectionBar({ rows }: { rows: BulkRow[] }) {
  const bulk = useBulk();
  const [open, setOpen] = useState(false);

  if (!bulk?.active) return null;

  const count = bulk.selected.size;
  const visibleSelected = rows.filter((row) =>
    bulk.selected.has(row.id),
  ).length;
  const allVisible = rows.length > 0 && visibleSelected === rows.length;
  const hiddenSelected = count - visibleSelected;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-card bg-panel px-4 py-2 shadow-sm">
      <label className="flex items-center gap-2 text-detail text-ink">
        <input
          type="checkbox"
          checked={allVisible}
          ref={(input) => {
            if (input) input.indeterminate = visibleSelected > 0 && !allVisible;
          }}
          disabled={rows.length === 0}
          onChange={() => bulk.setMany(rows, !allVisible)}
          className="size-4 flex-none accent-[var(--color-accent-solid)]"
        />
        Select all {rows.length} shown
      </label>

      <span className="text-detail text-ink-muted" aria-live="polite">
        {count} selected
        {hiddenSelected > 0 ? (
          <span className="text-ink-faint">
            {" "}
            · {hiddenSelected} not on this page
          </span>
        ) : null}
      </span>

      <span className="ml-auto flex items-center gap-2">
        {count > 0 ? (
          <button
            type="button"
            onClick={() => bulk.setMany([...bulk.selected.values()], false)}
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
          >
            Clear
          </button>
        ) : null}
        <button
          type="button"
          onClick={bulk.stop}
          className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={count === 0}
          onClick={() => setOpen(true)}
          className="rounded-pill bg-accent-solid px-4 py-1 text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          Edit rates
        </button>
      </span>

      {open ? (
        <BulkRateDialog
          rows={[...bulk.selected.values()]}
          tiers={bulk.tiers}
          onClose={() => setOpen(false)}
          onDone={bulk.stop}
        />
      ) : null}
    </div>
  );
}

type Mode = BulkRateChange["mode"];

/**
 * Turns the typed fields into the request the action takes. A blank field is
 * no change for that tier; a field that is not a number is reported against
 * its tier and blocks the whole save.
 */
function readFields(
  tiers: BulkTier[],
  mode: Mode,
  fields: Partial<Record<RateTier, string>>,
) {
  const changes: Partial<Record<RateTier, BulkRateChange>> = {};
  const problems: Partial<Record<RateTier, string>> = {};

  for (const { tier } of tiers) {
    const raw = fields[tier]?.trim() ?? "";
    if (raw === "") continue;
    const number = Number(raw);
    const change: BulkRateChange =
      mode === "set" ? { mode, value: number } : { mode, percent: number };
    const problem = Number.isNaN(number)
      ? "That isn't a number."
      : bulkChangeProblem(change);
    if (problem) problems[tier] = problem;
    else changes[tier] = change;
  }

  return { changes, problems };
}

function showRate(value: number | null): string {
  return value === null ? "—" : moneyExact(value);
}

function BulkRateDialog({
  rows,
  tiers,
  onClose,
  onDone,
}: {
  rows: BulkRow[];
  tiers: BulkTier[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const { report } = usePricingFeedback();
  const [mode, setMode] = useState<Mode>("set");
  const [fields, setFields] = useState<Partial<Record<RateTier, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const { changes, problems } = readFields(tiers, mode, fields);
  const changing = tiers.filter(({ tier }) => changes[tier]);
  const invalid = Object.keys(problems).length > 0;

  // Models the save would actually move, so the button can say how many.
  const moving = rows.filter((row) =>
    changing.some(
      ({ tier }) =>
        applyBulkChange(row.rates[tier], changes[tier]!) !== row.rates[tier],
    ),
  ).length;

  // The preview shows what is about to change; with nothing typed yet it shows
  // what the selection is priced at now, which is what a percentage starts from.
  const shown = changing.length > 0 ? changing : tiers;
  const tracks = `minmax(0,1fr) repeat(${shown.length}, ${changing.length > 0 ? "9.5rem" : "6rem"})`;

  function confirm() {
    if (invalid || changing.length === 0) return;
    setError(null);
    startTransition(async () => {
      const outcome = await setAssetRatesBulk({
        assetIds: rows.map((row) => row.id),
        changes,
      });
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      report(outcome);
      onClose();
      onDone();
      router.refresh();
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      wide
      title={`Edit rates on ${rows.length} ${rows.length === 1 ? "model" : "models"}`}
      blurb="Leave a field blank to keep that rate as it is. Orders already quoted keep the rates they were quoted at."
      footer={
        <>
          <span className="mr-auto text-detail text-ink-muted">
            {invalid
              ? "Fix the figure marked above — nothing saves until it is."
              : changing.length === 0
                ? "Nothing entered yet."
                : moving === 0
                  ? "These figures change nothing."
                  : `${moving} of ${rows.length} will change.`}
          </span>
          <ModalCancel />
          <ModalConfirm
            disabled={busy || invalid || changing.length === 0 || moving === 0}
            onClick={confirm}
          >
            {busy
              ? "Saving…"
              : `Update ${moving || rows.length} ${(moving || rows.length) === 1 ? "model" : "models"}`}
          </ModalConfirm>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="How to change the rates"
          className="inline-flex gap-px self-start rounded-pill bg-segmented-track p-[3px]"
        >
          {(
            [
              ["set", "Set to"],
              ["adjust", "Adjust by %"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
                mode === value
                  ? "bg-segmented-thumb text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiers.map(({ tier, label }) => (
            <label key={tier} className="flex flex-col gap-1">
              <span className="text-micro uppercase text-ink-muted">
                {label}
              </span>
              <span className="flex items-center gap-1 rounded-well bg-sunken px-[10px] py-2">
                {mode === "set" ? (
                  <span className="text-detail text-ink-faint" aria-hidden>
                    $
                  </span>
                ) : null}
                <input
                  value={fields[tier] ?? ""}
                  inputMode="decimal"
                  placeholder="Unchanged"
                  aria-invalid={problems[tier] ? true : undefined}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      [tier]: event.target.value,
                    }))
                  }
                  className="w-full min-w-0 border-0 bg-transparent text-right text-detail tabular-nums text-ink outline-none placeholder:text-left placeholder:text-ink-faint"
                />
                {mode === "adjust" ? (
                  <span className="text-detail text-ink-faint" aria-hidden>
                    %
                  </span>
                ) : null}
              </span>
              {problems[tier] ? (
                <span className="text-micro text-destructive">
                  {problems[tier]}
                </span>
              ) : null}
            </label>
          ))}
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex flex-col gap-[2px]">
          <div
            className="grid gap-2 px-2 pb-[2px] text-colhead uppercase text-ink-muted"
            style={{ gridTemplateColumns: tracks }}
          >
            <span>Model</span>
            {shown.map(({ tier, label }) => (
              <span key={tier} className="text-right">
                {label}
              </span>
            ))}
          </div>
          <ul className="flex flex-col gap-[2px]">
            {rows.map((row, index) => (
              <li
                key={row.id}
                className={`grid items-center gap-2 rounded-row p-2 text-detail ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
                style={{ gridTemplateColumns: tracks }}
              >
                <span className="truncate font-bold">{row.name}</span>
                {shown.map(({ tier }) => {
                  const before = row.rates[tier];
                  const change = changes[tier];
                  if (!change) {
                    return (
                      <span
                        key={tier}
                        className="text-right tabular-nums text-ink-muted"
                      >
                        {showRate(before)}
                      </span>
                    );
                  }
                  const after = applyBulkChange(before, change);
                  const moves = after !== before;
                  return (
                    <span
                      key={tier}
                      className="truncate text-right tabular-nums"
                    >
                      <span className="text-ink-faint">{showRate(before)}</span>
                      {moves ? (
                        <>
                          {" → "}
                          <span className="font-bold text-ink">
                            {showRate(after)}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-faint"> · same</span>
                      )}
                    </span>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
