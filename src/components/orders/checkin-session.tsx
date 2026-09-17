"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageCheck, X } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  commitCheckin,
  lookupReturn,
  type CommitOutcome,
} from "@/lib/actions/checkin-session";
import type { OutUnit } from "@/lib/queries/checkin";
import type { CheckinCondition } from "@/lib/actions/desk";

const CONDITIONS: { value: CheckinCondition; label: string }[] = [
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "DAMAGED", label: "Damaged" },
];

type Scanned = OutUnit & { condition: CheckinCondition; damageNotes: string };

type LogEntry = {
  id: number;
  message: string;
  order?: { id: string; reservationNumber: string };
};

/**
 * Check-in on the order record, as a session.
 *
 * Start → scan everything that came back → Complete check-in → review in a
 * dialog, where each unit's condition is set with the unit in view and what did
 * not come back is listed beside it → confirm. Nothing is written until the
 * confirm (see lib/actions/checkin-session.ts): all back completes the order,
 * anything still out is recorded as a partial return to follow up.
 */
export function CheckinSession({
  reservationId,
  out,
}: {
  reservationId: string;
  /** Units out on the order when the page rendered. */
  out: OutUnit[];
}) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [scanned, setScanned] = useState<Scanned[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<Extract<CommitOutcome, { status: "ok" }> | null>(null);
  const [error, setError] = useState("");
  // How many scans are still being looked up. A scanner fires faster than a
  // lookup returns, so scans are never dropped for being early — each runs on
  // its own and lands when it lands.
  const [pending, setPending] = useState(0);
  const inFlight = useRef(new Set<string>());
  const [committing, startCommit] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const scannedIds = new Set(scanned.map((unit) => unit.assetUnitId));
  const stillOut = out.filter((unit) => !scannedIds.has(unit.assetUnitId));
  const partial = stillOut.length > 0;

  function note(message: string, order?: LogEntry["order"]) {
    setLog((entries) => [{ id: nextId.current++, message, order }, ...entries].slice(0, 4));
  }

  function start() {
    setActive(true);
    setResult(null);
    setError("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setActive(false);
    setScanned([]);
    setLog([]);
    setBarcode("");
  }

  function scan(event: React.FormEvent) {
    event.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setBarcode("");
    const key = code.toLowerCase();
    if (
      inFlight.current.has(key) ||
      scanned.some((unit) => unit.barcode.toLowerCase() === key)
    ) {
      note(`${code} is already scanned.`);
      return;
    }
    inFlight.current.add(key);
    setPending((n) => n + 1);
    lookupReturn(reservationId, code)
      .then((found) => {
        if (found.status === "ok") {
          setScanned((units) =>
            units.some((unit) => unit.assetUnitId === found.unit.assetUnitId)
              ? units
              : [{ ...found.unit, condition: "GOOD", damageNotes: "" }, ...units],
          );
        } else if (found.status === "wrong-order") {
          note(found.message, found.order);
        } else {
          note(found.message);
        }
      })
      .catch(() => note(`${code} couldn't be checked — scan it again.`))
      .finally(() => {
        inFlight.current.delete(key);
        setPending((n) => n - 1);
      });
  }

  function update(assetUnitId: string, patch: Partial<Scanned>) {
    setScanned((units) =>
      units.map((unit) => (unit.assetUnitId === assetUnitId ? { ...unit, ...patch } : unit)),
    );
  }

  function confirm() {
    setError("");
    startCommit(async () => {
      const outcome = await commitCheckin(
        reservationId,
        scanned.map((unit) => ({
          barcode: unit.barcode,
          condition: unit.condition,
          damageNotes: unit.condition === "DAMAGED" ? unit.damageNotes : undefined,
        })),
      );
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      setResult(outcome);
      setReviewing(false);
      setActive(false);
      setScanned([]);
      setLog([]);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Check in</h2>
        <span className="text-detail text-ink-muted">
          {out.length} {out.length === 1 ? "unit" : "units"} out with the client
        </span>
      </header>

      {result ? (
        <div className="px-4 pb-3">
          <Notice tone="ok">
            {result.message}
            {result.workOrders.map((workOrder) => (
              <Link
                key={workOrder.id}
                href={`/dashboard/service/work-orders/${workOrder.id}`}
                className="ml-2 text-accent-text hover:underline"
              >
                Open {workOrder.number} →
              </Link>
            ))}
          </Notice>
          {result.failed.length > 0 ? (
            <Notice tone="error" className="mt-2">
              Not checked in: {result.failed.map((f) => `${f.barcode} (${f.message})`).join("; ")}
            </Notice>
          ) : null}
        </div>
      ) : null}

      {!active ? (
        out.length > 0 ? (
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={start}
              className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid"
            >
              Start check-in
            </button>
          </div>
        ) : null
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <form onSubmit={scan}>
            <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
              <PackageCheck className="size-4 flex-none text-ink-faint" aria-hidden />
              <input
                id="checkin-barcode"
                ref={inputRef}
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Scan or type a barcode"
                aria-label="Unit barcode"
                className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
              />
              {pending > 0 ? (
                <span className="flex-none text-detail text-ink-faint">Checking {pending}…</span>
              ) : null}
            </label>
          </form>

          {log.map((entry) => (
            <p key={entry.id} className="text-detail text-destructive">
              {entry.message}
              {entry.order ? (
                <Link
                  href={`/dashboard/orders/${entry.order.id}`}
                  className="ml-1 text-accent-text hover:underline"
                >
                  Open {entry.order.reservationNumber} →
                </Link>
              ) : null}
            </p>
          ))}

          {scanned.length > 0 ? (
            <ul className="flex flex-col gap-px">
              {scanned.map((unit) => (
                <li
                  key={unit.assetUnitId}
                  className="grid grid-cols-[96px_minmax(0,1fr)_20px] items-center gap-2 rounded-row px-2 py-[5px] text-detail hover:bg-row-hover"
                >
                  <span className="truncate font-bold">{unit.barcode}</span>
                  <span className="truncate text-ink-muted">{unit.assetName}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${unit.barcode}`}
                    onClick={() =>
                      setScanned((units) => units.filter((u) => u.assetUnitId !== unit.assetUnitId))
                    }
                    className="rounded-well text-ink-faint hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-detail text-ink-muted">
              Scan each unit as it comes out of the case. Nothing is checked in
              until you complete and confirm.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={scanned.length === 0 || pending > 0}
              onClick={() => setReviewing(true)}
              className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
            >
              Complete check-in
            </button>
            <button
              type="button"
              onClick={cancel}
              className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover"
            >
              Cancel
            </button>
            <span className="ml-auto text-detail tabular-nums text-ink-muted">
              {scanned.length} of {out.length} scanned
            </span>
          </div>
        </div>
      )}

      <Modal
        open={reviewing}
        onOpenChange={setReviewing}
        wide
        title={partial ? "Confirm partial return" : "Confirm check-in"}
        blurb={
          partial
            ? `${scanned.length} of ${out.length} units came back. ${
                scanned.length === 1 ? "It is" : "They are"
              } checked in, ${
                stillOut.length === 1 ? "the 1 still out is" : `the ${stillOut.length} still out are`
              } recorded against the order as a partial return to follow up, and the order stays open.`
            : `All ${out.length} units are back. Confirming checks them in and completes the order.`
        }
        footer={
          <>
            {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
            <ModalCancel>Keep scanning</ModalCancel>
            <ModalConfirm onClick={confirm} disabled={committing}>
              {committing
                ? "Checking in…"
                : partial
                  ? "Confirm partial return"
                  : "Confirm & complete order"}
            </ModalConfirm>
          </>
        }
      >
        <h3 className="mb-1 text-micro uppercase text-ink-muted">Coming back · {scanned.length}</h3>
        <ul className="flex flex-col gap-1">
          {scanned.map((unit) => (
            <li key={unit.assetUnitId} className="rounded-well bg-row-alt px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/dashboard/units/${unit.assetUnitId}`}
                    className="font-bold hover:underline"
                  >
                    {unit.barcode}
                  </Link>{" "}
                  <Link
                    href={`/dashboard/assets/${unit.assetId}`}
                    className="text-detail text-ink-muted hover:underline"
                  >
                    {unit.assetName}
                  </Link>
                </span>
                <select
                  id={`condition-${unit.assetUnitId}`}
                  aria-label={`Condition of ${unit.barcode}`}
                  value={unit.condition}
                  onChange={(event) =>
                    update(unit.assetUnitId, { condition: event.target.value as CheckinCondition })
                  }
                  className={`h-8 rounded-well border-0 px-2 text-detail outline-none ${
                    unit.condition === "DAMAGED"
                      ? "bg-destructive/10 font-bold text-destructive"
                      : "bg-sunken text-ink"
                  }`}
                >
                  {CONDITIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {unit.condition === "DAMAGED" ? (
                <input
                  id={`damage-${unit.assetUnitId}`}
                  value={unit.damageNotes}
                  onChange={(event) => update(unit.assetUnitId, { damageNotes: event.target.value })}
                  placeholder="What's wrong with it? A work order is raised and the unit comes off the shelf."
                  aria-label={`Damage on ${unit.barcode}`}
                  className="mt-2 h-8 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint"
                />
              ) : null}
            </li>
          ))}
        </ul>

        {partial ? (
          <>
            <h3 className="mb-1 mt-4 text-micro uppercase text-destructive">
              Still out · {stillOut.length}
            </h3>
            <ul className="flex flex-col gap-px">
              {stillOut.map((unit) => (
                <li
                  key={unit.assetUnitId}
                  className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 rounded-row px-3 py-[5px] text-detail"
                >
                  <Link href={`/dashboard/units/${unit.assetUnitId}`} className="font-bold hover:underline">
                    {unit.barcode}
                  </Link>
                  <Link
                    href={`/dashboard/assets/${unit.assetId}`}
                    className="truncate text-ink-muted hover:underline"
                  >
                    {unit.assetName}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Modal>
    </section>
  );
}
