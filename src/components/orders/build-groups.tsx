"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Plus } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import {
  addBuildGroup,
  duplicateBuildGroup,
  moveLineToBuild,
  moveOrderLine,
  setBuildGroupQuantity,
  setBuildPartQuantity,
  setHideBuildPartPrices,
} from "@/lib/actions/build-groups";
import { setLineRate, type StageOutcome } from "@/lib/actions/order-stage";

/**
 * The controls on a sales order's builds (lib/pricing/build-groups).
 *
 * A build is a named heading that hosts priced parts: "Threadripper PRO
 * Workstation", times two, with a CPU, a board and some RAM under it. These sit
 * in the same grid cells as the line editor — a quantity cell, then a price
 * cell — so a build row reads like any other line, and edits commit on blur the
 * same way (and for the same reason: every save reprices the order).
 */

const CELL =
  "w-full rounded-row border-0 bg-transparent px-1 py-0 text-right tabular-nums text-ink outline-none hover:bg-row-hover focus:bg-sunken disabled:opacity-50";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Start a new build on the order. */
export function AddBuildGroup({
  reservationId,
  packageId,
}: {
  reservationId: string;
  packageId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [machines, setMachines] = useState("1");
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const result = await addBuildGroup(reservationId, name, Number(machines), packageId);
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(false);
        setName("");
        setMachines("1");
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        <Plus className="size-[13px]" aria-hidden />
        Add a build
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <span className="min-w-0 flex-1">
        <span className="mb-[6px] block text-micro uppercase text-ink-muted">Build</span>
        <input
          autoFocus
          value={name}
          aria-label="Build name"
          placeholder="e.g. Threadripper PRO Workstation"
          onChange={(event) => setName(event.target.value)}
          className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint"
        />
      </span>
      <span>
        <span className="mb-[6px] block text-micro uppercase text-ink-muted">Machines</span>
        <input
          value={machines}
          inputMode="numeric"
          aria-label="Machines"
          onChange={(event) => setMachines(event.target.value)}
          className="h-9 w-16 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
        />
      </span>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={add}
        className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add build"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
      >
        Cancel
      </button>
      {outcome && outcome.status === "error" ? (
        <Notice tone="error" className="w-full">
          {outcome.message}
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * A build row's two middle cells: how many machines, and what one costs. The
 * price is the sum of the parts, so it is shown rather than edited.
 */
export function BuildGroupEditor({
  reservationId,
  groupId,
  machines,
  perMachine,
  structure,
}: {
  reservationId: string;
  groupId: string;
  machines: number;
  /** What one machine comes to: the parts per machine, added up. */
  perMachine: number;
  /** Whether the build can still be reshaped (before the order is prepared). */
  structure: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(machines));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function done(result: StageOutcome, revert?: () => void) {
    if (result.status === "error") {
      setError(result.message);
      revert?.();
    } else {
      setError("");
      router.refresh();
    }
  }

  function commit() {
    const next = Number(qty);
    if (next === machines) return;
    startTransition(async () => {
      done(await setBuildGroupQuantity(reservationId, groupId, next), () => setQty(String(machines)));
    });
  }

  return (
    <>
      {structure ? (
        <input
          value={qty}
          inputMode="numeric"
          disabled={busy}
          aria-label="Machines in this build"
          onChange={(event) => setQty(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setQty(String(machines));
              event.currentTarget.blur();
            }
          }}
          className={CELL}
        />
      ) : (
        <span className="text-right tabular-nums text-ink-muted">×{machines}</span>
      )}
      <span className="flex items-baseline justify-end gap-2 text-right tabular-nums text-ink-muted">
        {structure ? (
          <button
            type="button"
            disabled={busy}
            title="Copy this build with its parts"
            aria-label="Duplicate this build"
            onClick={() => startTransition(async () => done(await duplicateBuildGroup(reservationId, groupId)))}
            className="flex-none self-center rounded-well p-1 text-ink-faint hover:bg-row-hover hover:text-ink disabled:opacity-50"
          >
            <Copy className="size-[13px]" aria-hidden />
          </button>
        ) : null}
        <span>
          {MONEY.format(perMachine)}
          <span className="text-ink-faint"> each</span>
        </span>
      </span>
      {error ? (
        <Notice tone="error" className="col-span-full mt-1">
          {error}
        </Notice>
      ) : null}
    </>
  );
}

/**
 * A part under a build: quantity per machine and price each. The stored
 * quantity is that times the machines; the "×8" beside it says what the order
 * actually holds.
 */
export function BuildPartEditor({
  reservationId,
  partId,
  perMachine,
  stored,
  rate,
  unit,
  structure,
}: {
  reservationId: string;
  partId: string;
  perMachine: number;
  /** The quantity the order holds, machines included. */
  stored: number;
  rate: number;
  /** Rental parts are priced per period ("/day"); a sale's are "each". */
  unit?: string;
  structure: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(perMachine));
  const [amount, setAmount] = useState(rate.toFixed(2));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function done(result: StageOutcome, revert: () => void) {
    if (result.status === "error") {
      setError(result.message);
      revert();
    } else {
      setError("");
      router.refresh();
    }
  }

  function commitQuantity() {
    const next = Number(qty);
    if (next === perMachine) return;
    startTransition(async () => {
      done(await setBuildPartQuantity(reservationId, partId, next), () => setQty(String(perMachine)));
    });
  }

  function commitRate() {
    const next = Number(amount);
    if (next === rate) return;
    startTransition(async () => {
      done(await setLineRate(reservationId, partId, next), () => setAmount(rate.toFixed(2)));
    });
  }

  const onKeys = (revert: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      revert();
      event.currentTarget.blur();
    }
  };

  return (
    <>
      <span className="flex items-baseline justify-end gap-1">
        {structure ? (
          <input
            value={qty}
            inputMode="numeric"
            disabled={busy}
            aria-label="Quantity per machine"
            onChange={(event) => setQty(event.target.value)}
            onBlur={commitQuantity}
            onKeyDown={onKeys(() => setQty(String(perMachine)))}
            className={`${CELL} w-9`}
          />
        ) : (
          <span className="tabular-nums text-ink-faint">×{perMachine}</span>
        )}
        {stored !== perMachine ? <span className="text-micro text-ink-faint">({stored} in all)</span> : null}
      </span>
      <span className="flex items-baseline justify-end gap-1">
        <input
          value={amount}
          inputMode="decimal"
          disabled={busy || !structure}
          aria-label="Price each"
          onChange={(event) => setAmount(event.target.value)}
          onBlur={commitRate}
          onKeyDown={onKeys(() => setAmount(rate.toFixed(2)))}
          className={`${CELL} w-[68px]`}
        />
        <span className="text-micro text-ink-faint">{unit ?? "each"}</span>
      </span>
      {error ? (
        <Notice tone="error" className="col-span-full mt-1">
          {error}
        </Notice>
      ) : null}
    </>
  );
}

/**
 * Move a line into a build, or a part out of one. A select rather than drag:
 * it works from the keyboard and there are rarely more than a few builds.
 */
export function MoveToBuild({
  reservationId,
  itemId,
  current,
  builds,
}: {
  reservationId: string;
  itemId: string;
  /** The build the line is in now; null for a plain line. */
  current: string | null;
  builds: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col">
      <select
        value={current ?? ""}
        disabled={busy}
        aria-label="Which build this line is in"
        onChange={(event) =>
          startTransition(async () => {
            const result = await moveLineToBuild(reservationId, itemId, event.target.value || null);
            if (result.status === "error") setError(result.message);
            else {
              setError("");
              router.refresh();
            }
          })
        }
        className="max-w-[160px] rounded-row border-0 bg-transparent text-micro text-ink-faint outline-none hover:bg-row-hover"
      >
        <option value="">{current ? "Take out of build" : "Not in a build"}</option>
        {builds.map((build) => (
          <option key={build.id} value={build.id}>
            {current === build.id ? `In ${build.name}` : `Put in ${build.name}`}
          </option>
        ))}
      </select>
      {error ? <span className="text-micro text-destructive">{error}</span> : null}
    </span>
  );
}

/** Whether the client sees each part's price, or the parts as a spec list under the build's total. */
export function HidePartPrices({ reservationId, hidden }: { reservationId: string; hidden: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-detail text-ink-muted">
      <input
        type="checkbox"
        checked={hidden}
        disabled={busy}
        onChange={(event) =>
          startTransition(async () => {
            const result = await setHideBuildPartPrices(reservationId, event.target.checked);
            if (result.status === "error") setError(result.message);
            else {
              setError("");
              router.refresh();
            }
          })
        }
      />
      Hide part prices on the quote
      {error ? <span className="text-destructive">{error}</span> : null}
    </label>
  );
}

/**
 * Up and down arrows for a line or a build part. A line moves among the order's
 * lines (its parts travel with it); a part moves among its build's parts. The
 * ends are disabled rather than hidden so the column does not jump.
 */
export function MoveLineArrows({
  reservationId,
  itemId,
  canUp,
  canDown,
}: {
  reservationId: string;
  itemId: string;
  canUp: boolean;
  canDown: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function go(direction: "up" | "down") {
    startTransition(async () => {
      const result = await moveOrderLine(reservationId, itemId, direction);
      if (result.status === "error") setError(result.message);
      else {
        setError("");
        router.refresh();
      }
    });
  }

  const button =
    "rounded-well p-[2px] text-ink-faint hover:bg-row-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <span className="inline-flex items-center align-middle" title={error || undefined}>
      <button type="button" aria-label="Move up" disabled={busy || !canUp} onClick={() => go("up")} className={button}>
        <ArrowUp className="size-[12px]" aria-hidden />
      </button>
      <button type="button" aria-label="Move down" disabled={busy || !canDown} onClick={() => go("down")} className={button}>
        <ArrowDown className="size-[12px]" aria-hidden />
      </button>
      {error ? <span className="ml-1 text-micro text-destructive">{error}</span> : null}
    </span>
  );
}
