"use client";

import { useTransition } from "react";
import { setForecastChoice } from "@/lib/actions/forecast";
import type { ChoiceMode } from "@/lib/forecast/groups";

const OPTIONS: { value: ChoiceMode | ""; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "COUNT", label: "Count this" },
  { value: "SKIP", label: "Leave out" },
  { value: "SEPARATE", label: "Separate deal" },
];

/** The owner's call on one open order; "Auto" hands it back to the grouping. */
export function ChoiceSelect({ orderId, value }: { orderId: string; value: ChoiceMode | null }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="How the forecast treats this order"
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) => {
        const next = (e.target.value || null) as ChoiceMode | null;
        start(() => setForecastChoice(orderId, next));
      }}
      className={`rounded-pill border border-hairline bg-panel px-2 py-[2px] text-pill ${
        value ? "text-accent-text" : "text-ink-muted"
      } ${pending ? "opacity-50" : ""}`}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
