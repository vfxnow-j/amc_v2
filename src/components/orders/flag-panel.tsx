"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardEmpty } from "@/components/record/record-card";
import { FlagDialog } from "@/components/orders/flag-dialog";
import { closeFlag, toggleFlagStep, updateFlagTracking } from "@/lib/actions/order-flags";
import { OUTCOMES, outcomeDef } from "@/lib/flags/catalog";
import { canClose, isStale } from "@/lib/flags/rules";
import type { FlagOutcome } from "@/generated/prisma/client";
import type { FlagView, OrderUnitOption } from "@/lib/queries/order-flags";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const FIELD = "h-8 min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none";

const TONE = { CRITICAL: "text-danger", ATTENTION: "text-warning", INFO: "text-ink-muted" } as const;

/**
 * The cases on an order: open ones as working cards (playbook checklist,
 * carrier and claim fields, affected units, close control), closed ones
 * collapsed beneath with their outcome.
 */
export function FlagPanel({
  reservationId,
  open,
  closed,
  staff,
  unitsOut,
  canEdit,
}: {
  reservationId: string;
  open: FlagView[];
  closed: FlagView[];
  staff: { id: string; name: string }[];
  unitsOut: OrderUnitOption[];
  canEdit: boolean;
}) {
  if (open.length === 0 && closed.length === 0 && !canEdit) return null;
  return (
    <Card
      title="Flags"
      meta={open.length ? `${open.length} open` : undefined}
      action={canEdit ? <FlagDialog reservationId={reservationId} staff={staff} unitsOut={unitsOut} /> : undefined}
    >
      {open.length === 0 && closed.length === 0 ? (
        <CardEmpty>Nothing flagged. Use Flag to open a case when something needs following up.</CardEmpty>
      ) : null}
      <div className="flex flex-col gap-3 px-4 pb-4">
        {open.map((flag) => (
          <OpenCase key={flag.id} flag={flag} staff={staff} canEdit={canEdit} />
        ))}
        {closed.length ? (
          <details className="text-detail">
            <summary className="cursor-pointer text-ink-muted">Closed cases ({closed.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {closed.map((flag) => (
                <li key={flag.id} className="rounded-well bg-sunken p-2">
                  <p className="font-bold">{flag.label}</p>
                  <p className="text-ink-muted">
                    {flag.outcome ? outcomeDef(flag.outcome).label : "Cleared"}
                    {flag.outcomeAmount ? ` · ${MONEY.format(flag.outcomeAmount)}` : ""}
                    {" · "}
                    {flag.resolvedAt ? DAY.format(new Date(flag.resolvedAt)) : ""}
                    {flag.resolvedByName ? ` · ${flag.resolvedByName}` : ""}
                  </p>
                  {flag.resolutionNote ? <p className="whitespace-pre-line text-ink-muted">{flag.resolutionNote}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function OpenCase({ flag, staff, canEdit }: { flag: FlagView; staff: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [carrier, setCarrier] = useState(flag.carrier ?? "");
  const [tracking, setTracking] = useState(flag.trackingNumber ?? "");
  const [claim, setClaim] = useState(flag.claimNumber ?? "");
  const [outcome, setOutcome] = useState<FlagOutcome | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [resolves, setResolves] = useState<string[]>(flag.units.filter((u) => !u.foundAt).map((u) => u.assetUnitId));

  const stale = isStale({ nextActionDate: flag.nextActionDate ? new Date(flag.nextActionDate) : null, resolvedAt: null }, new Date());
  const system = flag.source === "SYSTEM";
  const openUnits = flag.units.filter((u) => !u.foundAt);
  const verdict = canClose({
    outcome: outcome || null,
    amount: amount ? Number(amount) : null,
    stepsOpen: flag.steps.filter((s) => !s.doneAt).length,
    unitsStillMissing: openUnits.filter((u) => !resolves.includes(u.assetUnitId)).length,
  });

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError("");
    startTransition(async () => {
      const r = await work();
      if (!r.ok) setError(r.message ?? "That did not work.");
      else router.refresh();
    });
  }

  return (
    <article className="rounded-well bg-sunken p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-body font-bold">{flag.label}</h3>
        <span className={`text-micro uppercase ${TONE[flag.severity]}`}>{flag.severity.toLowerCase()}</span>
        {system ? <span className="text-micro uppercase text-ink-faint">automatic</span> : null}
        {flag.exposure > 0 ? <span className="ml-auto text-detail font-bold tabular-nums">{MONEY.format(flag.exposure)} at risk</span> : null}
      </header>
      <p className="text-detail text-ink-muted">
        {flag.categoryLabel} · raised {DAY.format(new Date(flag.raisedAt))}
        {flag.raisedByName ? ` by ${flag.raisedByName}` : ""}
        {flag.ownerName ? ` · owner ${flag.ownerName}` : ""}
        {flag.nextActionDate ? (
          <span className={stale ? "font-bold text-danger" : ""}> · next action {DAY.format(new Date(flag.nextActionDate))}</span>
        ) : null}
      </p>
      {flag.note ? <p className="mt-1 whitespace-pre-line text-detail">{flag.note}</p> : null}

      {canEdit && !system ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className={FIELD}
            aria-label="Owner"
            value={flag.ownerId ?? ""}
            disabled={busy}
            onChange={(e) => run(() => updateFlagTracking(flag.id, { ownerId: e.target.value || null }))}
          >
            <option value="">No owner</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Next action date"
            className={FIELD}
            defaultValue={flag.nextActionDate ? flag.nextActionDate.slice(0, 10) : ""}
            disabled={busy}
            onChange={(e) => run(() => updateFlagTracking(flag.id, { nextActionDate: e.target.value || null }))}
          />
        </div>
      ) : null}

      <ul className="mt-2 flex flex-col gap-px">
        {flag.steps.map((step) => (
          <li key={step.id} className="text-detail">
            <label className="flex items-center gap-2 rounded-row px-1 py-[3px] odd:bg-row-alt">
              <input
                type="checkbox"
                checked={!!step.doneAt}
                disabled={!canEdit || busy}
                onChange={(e) => run(() => toggleFlagStep(step.id, e.target.checked))}
              />
              <span className={step.doneAt ? "text-ink-muted line-through" : ""}>{step.label}</span>
              {step.doneAt ? <span className="ml-auto text-micro text-ink-faint">{DAY.format(new Date(step.doneAt))}</span> : null}
            </label>
          </li>
        ))}
      </ul>

      {canEdit && !system && (flag.carrier !== null || flag.trackingNumber !== null || flag.units.length > 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={FIELD} placeholder="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          <input className={FIELD} placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          <input className={FIELD} placeholder="Claim number" value={claim} onChange={(e) => setClaim(e.target.value)} />
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateFlagTracking(flag.id, { carrier, trackingNumber: tracking, claimNumber: claim }))}
            className="h-8 rounded-pill bg-panel px-3 text-pill text-ink"
          >
            Save
          </button>
        </div>
      ) : null}

      {flag.units.length ? (
        <ul className="mt-2 text-detail text-ink-muted">
          {flag.units.map((u) => (
            <li key={u.id}>
              <span className="font-bold text-ink">{u.barcode}</span> {u.assetName}
              {u.foundAt ? ` · found ${DAY.format(new Date(u.foundAt))}` : " · missing"}
            </li>
          ))}
        </ul>
      ) : null}

      {flag.timeline.length ? (
        <details className="mt-2 text-detail">
          <summary className="cursor-pointer text-ink-muted">Timeline ({flag.timeline.length})</summary>
          <ul className="mt-1 text-ink-muted">
            {flag.timeline.map((t, i) => (
              <li key={i}>{DAY.format(new Date(t.at))}: {t.text}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {canEdit && !system ? (
        <div className="mt-3 border-t border-hairline pt-2">
          <p className="text-micro uppercase text-ink-muted">Close case</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select className={FIELD} value={outcome} onChange={(e) => setOutcome(e.target.value as FlagOutcome | "")}>
              <option value="">Choose an outcome</option>
              {OUTCOMES.map((o) => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            {outcome && outcomeDef(outcome).needsAmount ? (
              <input className={`${FIELD} w-24`} inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            ) : null}
            <input className={`${FIELD} flex-1`} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {openUnits.length > 1 ? (
            <div className="mt-1 text-detail">
              <span className="text-ink-muted">This resolves: </span>
              {openUnits.map((u) => (
                <label key={u.id} className="mr-3 inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={resolves.includes(u.assetUnitId)}
                    onChange={(e) =>
                      setResolves((r) => (e.target.checked ? [...r, u.assetUnitId] : r.filter((x) => x !== u.assetUnitId)))
                    }
                  />
                  {u.barcode}
                </label>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !verdict.ok}
              onClick={() =>
                run(() =>
                  closeFlag({
                    flagId: flag.id,
                    outcome: outcome as FlagOutcome,
                    amount: amount ? Number(amount) : undefined,
                    note,
                    unitIds: resolves,
                  }),
                )
              }
              className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy ? "Working…" : "Close case"}
            </button>
            {!verdict.ok ? <span className="text-detail text-ink-muted">{verdict.message}</span> : null}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-detail text-destructive">{error}</p> : null}
    </article>
  );
}
