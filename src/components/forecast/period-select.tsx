"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PERIODS, PERIOD_LABEL, type ExportPeriod } from "@/lib/forecast/period";

/** Picks the slice of the forecast every figure on the page, the report and the Excel export are cut to. */
export function PeriodSelect({ value, report }: { value: ExportPeriod; report: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Forecast period"
      onChange={(e) => {
        const q = new URLSearchParams({ period: e.target.value });
        if (report) q.set("view", "report");
        start(() => router.push(`/dashboard/forecast?${q}`));
      }}
      className={`rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink ${pending ? "opacity-50" : ""}`}
    >
      {PERIODS.map((p) => (
        <option key={p} value={p}>
          {PERIOD_LABEL[p]}
        </option>
      ))}
    </select>
  );
}
