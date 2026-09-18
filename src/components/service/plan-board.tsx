"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CoverageEnrollmentStatus } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { setEnrollmentStatus } from "@/lib/actions/coverage-enrollments";
import { ENROLLMENT_STATUS_LABEL, ENROLLMENT_STATUSES } from "@/lib/coverage/labels";

const SELECT =
  "h-7 rounded-well border border-hairline bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });

export type BoardModel = {
  assetId: string;
  assetName: string;
  rows: {
    id: string;
    name: string;
    provider: string | null;
    status: CoverageEnrollmentStatus;
    endDate: Date | null;
    covers: boolean;
    purchaseOrder: { id: string; poNumber: string } | null;
    unit: { id: string; barcode: string; serialNumber: string | null };
  }[];
};

const STATUS_TONE: Record<CoverageEnrollmentStatus, string> = {
  PURCHASED: "text-accent-text",
  ENROLLED: "",
  NOT_ENROLLED: "text-destructive",
  CANCELLED: "text-ink-faint",
};

/**
 * Coverage & RMA → per unit. One block per model, one row per unit, so the
 * question the owner asks — which of these Macs are actually on AppleCare+ —
 * is answered unit by unit rather than by what the model "comes with". A
 * status can be set on one row, or on a whole model at once after checking a
 * PO's worth of serials.
 */
export function PlanBoard({ models }: { models: BoardModel[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
      {models.map((model) => (
        <ModelBlock key={model.assetId} model={model} />
      ))}
    </div>
  );
}

function ModelBlock({ model }: { model: BoardModel }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const tally = ENROLLMENT_STATUSES.map((status) => [status, model.rows.filter((row) => row.status === status).length] as const).filter(
    ([, count]) => count > 0,
  );

  function set(ids: string[], status: CoverageEnrollmentStatus) {
    setError("");
    startTransition(async () => {
      const result = await setEnrollmentStatus(ids, status);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-px">
      <header className="flex flex-wrap items-center gap-2 px-2 pb-1 text-detail">
        <Link href={`/dashboard/assets/${model.assetId}`} className="font-bold hover:underline">
          {model.assetName}
        </Link>
        <span className="text-ink-muted">
          {model.rows.length} {model.rows.length === 1 ? "unit" : "units"} ·{" "}
          {tally.map(([status, count]) => `${count} ${ENROLLMENT_STATUS_LABEL[status].toLowerCase()}`).join(" · ")}
        </span>
        <label className="ml-auto flex items-center gap-1 text-ink-muted">
          Set all
          <select
            aria-label={`Set every ${model.assetName} plan to`}
            value=""
            disabled={busy}
            onChange={(event) => {
              const status = event.target.value as CoverageEnrollmentStatus;
              if (!status) return;
              if (window.confirm(`Set all ${model.rows.length} ${model.assetName} plans to "${ENROLLMENT_STATUS_LABEL[status]}"?`)) {
                set(model.rows.map((row) => row.id), status);
              }
            }}
            className={SELECT}
          >
            <option value="">…</option>
            {ENROLLMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ENROLLMENT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error ? <Notice tone="error" className="mx-2">{error}</Notice> : null}
      <ul className="flex flex-col gap-px">
        {model.rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_104px_150px] items-center gap-2 rounded-row px-2 py-[3px] text-detail odd:bg-row-alt"
          >
            <Link href={`/dashboard/units/${row.unit.id}`} className="truncate font-bold hover:underline">
              {row.unit.barcode}
            </Link>
            <span className="truncate text-ink-muted">{row.unit.serialNumber ?? "no serial"}</span>
            <span className="truncate">
              {row.name}
              {row.provider ? <span className="text-ink-faint"> · {row.provider}</span> : null}
              {row.purchaseOrder ? (
                <>
                  <span className="text-ink-faint"> · </span>
                  <Link href={`/dashboard/purchase-orders/${row.purchaseOrder.id}`} className="text-accent-text hover:underline">
                    {row.purchaseOrder.poNumber}
                  </Link>
                </>
              ) : null}
            </span>
            <span className={`truncate ${row.endDate && !row.covers ? "text-ink-faint" : "text-ink-muted"}`}>
              {row.endDate ? `${row.covers ? "to" : "ended"} ${DAY.format(row.endDate)}` : "end unknown"}
            </span>
            <select
              aria-label={`${row.unit.barcode} ${row.name} status`}
              value={row.status}
              disabled={busy}
              onChange={(event) => set([row.id], event.target.value as CoverageEnrollmentStatus)}
              className={`${SELECT} ${STATUS_TONE[row.status]}`}
            >
              {ENROLLMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ENROLLMENT_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
