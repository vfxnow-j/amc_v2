"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ServiceKind } from "@/generated/prisma/enums";
import { Notice } from "@/components/feedback/notice";
import {
  createServiceEntry,
  deleteServiceEntry,
  updateServiceEntry,
} from "@/lib/actions/pricing";

export type ServiceDraft = {
  id: string;
  name: string;
  description: string | null;
  defaultRate: number;
  unit: string;
  kind: ServiceKind;
  active: boolean;
  usedOnOrders: number;
};

/**
 * What kind of work it is, as opposed to how it is charged.
 *
 * The two were the same column until 2026-09-09, and could not be: "Per Day"
 * says nothing about whether a day is an engineer's or a van's. Logistics has
 * no rows yet — an order's delivery and return costs live on the order itself —
 * so the value is here ahead of the work that will use it.
 */
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  PROFESSIONAL: "Professional services",
  MANAGED: "Managed services",
  LOGISTICS: "Logistics",
  OTHER: "Other",
};

const KINDS: ServiceKind[] = [
  "PROFESSIONAL",
  "MANAGED",
  "LOGISTICS",
  "OTHER",
];

/**
 * The four units a service is charged in.
 *
 * `Service.unit` is a free-text column and the six rows in the database use
 * only "Flat" and "Per Day", so this is a picker over the values that exist
 * rather than a migration to an enum. Kept as strings on purpose: the column is
 * read straight onto the order line and rendered as-is, so a value this list
 * doesn't know would still display correctly if one ever arrives.
 */
const UNITS = ["Flat", "Per Hour", "Per Day", "Per Session"] as const;

const FIELD =
  "h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

/**
 * One service, created or edited.
 *
 * `createService` and `updateService` were ported months ago and reachable from
 * nothing — Operate → Services listed the catalogue and offered no way to add
 * to it, so the six rows in the database are the six that came over from v1.
 *
 * The default rate is a starting figure, not a price. Adding a service to an
 * order copies it onto the line and the line is what charges, so changing it
 * here never moves an order that already carries the service. Worth saying on
 * the form, because "default" is doing quiet work in that sentence.
 *
 * Withdrawing rather than deleting is the normal end of a service's life, and
 * the server enforces it: `deleteService` refuses while any order line still
 * references the row, because deleting it would leave those lines pointing at
 * nothing. The button says so before you press it.
 */
export function ServiceForm({
  service,
  canDelete,
}: {
  service: ServiceDraft | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [rate, setRate] = useState(String(service?.defaultRate ?? ""));
  const [unit, setUnit] = useState(service?.unit ?? "Flat");
  const [kind, setKind] = useState<ServiceKind>(service?.kind ?? "OTHER");
  const [active, setActive] = useState(service?.active ?? true);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      defaultRate: Number(rate) || 0,
      unit,
      kind,
      active,
    };

    startTransition(async () => {
      const outcome = service
        ? await updateServiceEntry(service.id, payload)
        : await createServiceEntry(payload);
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      router.push("/dashboard/pricing/services");
      router.refresh();
    });
  }

  function remove() {
    if (!service) return;
    setError("");
    startTransition(async () => {
      const outcome = await deleteServiceEntry(service.id);
      if (outcome.status === "error") {
        setError(outcome.message);
        setConfirming(false);
        return;
      }
      router.push("/dashboard/pricing/services");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. On-site support, day"
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Kind</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as ServiceKind)}
          className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {SERVICE_KIND_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">
          Note — optional
        </span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={FIELD}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">
            Default rate
          </span>
          <input
            value={rate}
            inputMode="decimal"
            onChange={(event) => setRate(event.target.value)}
            placeholder="0.00"
            className={`${FIELD} text-right tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Charged</span>
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {UNITS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-micro text-ink-faint">
        A starting figure. Adding this to an order copies the rate onto the line,
        and the line is what charges — changing it here never moves an order that
        already carries the service.
      </p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="size-4 rounded-[4px] accent-accent-solid"
        />
        <span className="text-detail text-ink">Offered on new orders</span>
      </label>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill font-bold text-accent-on-solid disabled:opacity-50"
        >
          {service ? "Save" : "Add service"}
        </button>

        {service && canDelete ? (
          confirming ? (
            <>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="h-9 rounded-pill bg-[var(--danger)] px-3 text-pill font-bold text-[var(--danger-on)] disabled:opacity-50"
              >
                Delete for good
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-9 rounded-pill px-2 text-pill text-ink-muted hover:text-ink"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy || service.usedOnOrders > 0}
              title={
                service.usedOnOrders > 0
                  ? `On ${service.usedOnOrders} order ${
                      service.usedOnOrders === 1 ? "line" : "lines"
                    } — withdraw it instead`
                  : undefined
              }
              className="h-9 rounded-pill px-3 text-pill text-ink-muted hover:text-ink disabled:opacity-40"
            >
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
