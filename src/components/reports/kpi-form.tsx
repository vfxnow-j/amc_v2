"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveKpiTargets, type KpiTargets } from "@/lib/actions/reports";

/**
 * The month's target, expenses and payroll.
 *
 * The build plan lists "revenue vs target" as a data gap needing a product
 * decision, on the grounds that no target exists in the schema. It half does:
 * `Setting` rows keyed `kpi_YYYY-MM` hold all three figures and both
 * `getKpiTargets` and `saveKpiTargets` came across from v1 intact. What is
 * missing is not the mechanism, it is the numbers — nobody has ever set one.
 *
 * So this is the form that sets them, and until somebody does, the forecast
 * says the target is unset rather than dividing by a zero and printing "0% of
 * target". A target of nothing is not a target of zero.
 */
export function KpiForm({
  month,
  label,
  targets,
}: {
  /** `YYYY-MM`, the settings key without its prefix. */
  month: string;
  label: string;
  targets: KpiTargets | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [revenueTarget, setRevenueTarget] = useState(
    targets ? String(targets.revenueTarget) : "",
  );
  const [expenses, setExpenses] = useState(
    targets ? String(targets.expenses) : "",
  );
  const [payroll, setPayroll] = useState(targets ? String(targets.payroll) : "");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-detail text-accent-text hover:underline"
      >
        {targets ? "Change the target" : "Set a target"}
      </button>
    );
  }

  const field =
    "h-9 w-full min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(async () => {
          try {
            await saveKpiTargets(month, {
              revenueTarget: Number(revenueTarget) || 0,
              expenses: Number(expenses) || 0,
              payroll: Number(payroll) || 0,
            });
            setOpen(false);
            router.refresh();
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "That didn't save.",
            );
          }
        });
      }}
    >
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-well bg-destructive/10 px-2 py-1 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-[2px]">
          <span className="text-micro uppercase text-ink-muted">Target</span>
          <input
            type="number"
            min={0}
            value={revenueTarget}
            onChange={(event) => setRevenueTarget(event.target.value)}
            aria-label={`Revenue target for ${label}`}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-[2px]">
          <span className="text-micro uppercase text-ink-muted">Expenses</span>
          <input
            type="number"
            min={0}
            value={expenses}
            onChange={(event) => setExpenses(event.target.value)}
            aria-label={`Expenses for ${label}`}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-[2px]">
          <span className="text-micro uppercase text-ink-muted">Payroll</span>
          <input
            type="number"
            min={0}
            value={payroll}
            onChange={(event) => setPayroll(event.target.value)}
            aria-label={`Payroll for ${label}`}
            className={field}
          />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Save {label}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
