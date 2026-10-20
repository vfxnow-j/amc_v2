"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import type { Kind } from "@/lib/queries/forecast";

const axisMoney = (v: number) =>
  v === 0 ? "$0" : v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;

/**
 * Six months earned, then twelve months set — one bar per month.
 *
 * Two encodings, never mixed up. **Colour is what it is** — rental, sale,
 * cloud… in a fixed order (the dataviz reference palette, validated light and
 * dark). **Fill is how firm it is**: booked orders solid; open quotes, weighted
 * by stage, a pale hatch of the same colour; leads — prospects with no order
 * yet and no type — an empty dashed box on top. Earned history is neutral ink:
 * a different measure (accrual, not billing), so it must not look like a forecast.
 */

export type ChartMonth = {
  key: string;
  short: string;
  past: boolean;
  earned: number;
  booked: Record<Kind, number>;
  expected: Record<Kind, number>;
  prospects: number;
  target: number;
};

export const CHART_KINDS: { key: Kind; label: string }[] = [
  { key: "rental", label: "Rental" },
  { key: "sale", label: "Sale" },
  { key: "oneTime", label: "One-time rental" },
  { key: "cloud", label: "Cloud" },
  { key: "rto", label: "Rent-to-own" },
  { key: "flow", label: "Flow" },
];

const VARS = {
  "--fc-rental": "light-dark(#2a78d6, #3987e5)",
  "--fc-sale": "light-dark(#eb6834, #d95926)",
  "--fc-oneTime": "light-dark(#1baf7a, #199e70)",
  "--fc-cloud": "light-dark(#eda100, #c98500)",
  "--fc-rto": "light-dark(#e87ba4, #d55181)",
  "--fc-flow": "light-dark(#008300, #008300)",
  "--fc-earned": "light-dark(var(--color-surface-6), var(--color-surface-7))",
} as React.CSSProperties;

const solid = (k: Kind) => ({ background: `var(--fc-${k})` });
const hatched = (k: Kind) => ({
  background: `color-mix(in srgb, var(--fc-${k}) 28%, transparent)`,
  backgroundImage: `repeating-linear-gradient(45deg, var(--fc-${k}) 0 1.5px, transparent 1.5px 5px)`,
});
const PROSPECT = "border border-dashed border-ink-muted bg-transparent";

const sumOf = (r: Record<Kind, number>) => CHART_KINDS.reduce((s, k) => s + (r[k.key] ?? 0), 0);

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

export function ForecastChart({ months }: { months: ChartMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = months.map((m) => (m.past ? m.earned : sumOf(m.booked) + sumOf(m.expected) + m.prospects));
  const max = niceMax(Math.max(...totals, ...months.map((m) => m.target)));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const firstFuture = months.findIndex((m) => !m.past);
  const h = hover === null ? null : months[hover];
  const present = CHART_KINDS.filter((k) => months.some((m) => !m.past && (m.booked[k.key] > 0 || m.expected[k.key] > 0)));

  return (
    <div style={VARS} className="px-4 pb-4">
      <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2 text-detail text-ink-muted">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <li className="text-micro uppercase text-ink-faint">What it is</li>
          {present.map((k) => (
            <li key={k.key} className="flex items-center gap-[6px]">
              <span className="size-[10px] rounded-[2px]" style={solid(k.key)} />
              {k.label}
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <li className="text-micro uppercase text-ink-faint">How firm</li>
          <li className="flex items-center gap-[6px]">
            <span className="size-[10px] rounded-[2px]" style={{ background: "var(--fc-earned)" }} />
            Earned (actual)
          </li>
          <li className="flex items-center gap-[6px]">
            <span className="size-[10px] rounded-[2px] bg-ink-muted" />
            Booked orders
          </li>
          <li className="flex items-center gap-[6px]">
            <span
              className="size-[10px] rounded-[2px]"
              style={{
                background: "color-mix(in srgb, currentColor 25%, transparent)",
                backgroundImage: "repeating-linear-gradient(45deg, currentColor 0 1.5px, transparent 1.5px 4px)",
              }}
            />
            Quotes in play (weighted)
          </li>
          <li className="flex items-center gap-[6px]">
            <span className={`size-[10px] rounded-[2px] ${PROSPECT}`} />
            Prospects — leads (weighted)
          </li>
        </ul>
      </div>

      <div className="relative mt-4 grid grid-cols-[44px_1fr] gap-2">
        <div className="relative h-[240px] text-micro tabular-nums text-ink-faint">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / max) * 100}%`, transform: "translateY(50%)" }}>
              {axisMoney(t)}
            </span>
          ))}
        </div>
        <div className="relative h-[240px]" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-hairline" style={{ bottom: `${(t / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {months.map((m, i) => {
              const pct = (v: number) => `${(v / max) * 100}%`;
              // Top of the stack first (flex column): prospects, then quotes, then booked at the base.
              const segments = m.past
                ? []
                : [
                    ...(m.prospects > 0 ? [{ id: "p", grow: m.prospects, className: PROSPECT, style: {} }] : []),
                    ...[...CHART_KINDS].reverse().filter((k) => m.expected[k.key] > 0)
                      .map((k) => ({ id: `e-${k.key}`, grow: m.expected[k.key], className: "", style: hatched(k.key) })),
                    ...[...CHART_KINDS].reverse().filter((k) => m.booked[k.key] > 0)
                      .map((k) => ({ id: `b-${k.key}`, grow: m.booked[k.key], className: "", style: solid(k.key) })),
                  ];
              return (
                <button
                  type="button"
                  key={m.key}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${m.short}: ${money(totals[i])}`}
                  className={`relative flex h-full flex-1 flex-col justify-end rounded-t-[4px] outline-none ${
                    hover === i ? "bg-row-hover" : ""
                  } ${i === firstFuture ? "ml-2" : ""}`}
                >
                  {m.target > 0 ? (
                    <span className="absolute inset-x-[2px] border-t-2 border-dashed border-ink-muted" style={{ bottom: pct(m.target) }} />
                  ) : null}
                  {m.past ? (
                    <span className="mx-[3px] rounded-t-[4px]" style={{ height: pct(m.earned), background: "var(--fc-earned)" }} />
                  ) : (
                    <span className="mx-[3px] flex flex-col gap-[2px]" style={{ height: pct(totals[i]) }}>
                      {segments.map((s, j) => (
                        <span
                          key={s.id}
                          className={`min-h-[1px] ${j === 0 ? "rounded-t-[4px]" : ""} ${s.className}`}
                          style={{ flexGrow: s.grow, ...s.style }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {h ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-[230px] rounded-well bg-popover p-3 text-detail shadow-md"
              style={
                hover! < months.length / 2
                  ? { left: `calc(${((hover! + 1) / months.length) * 100}% + 6px)` }
                  : { right: `calc(${((months.length - hover!) / months.length) * 100}% + 6px)` }
              }
            >
              <p className="font-bold">{h.short}{h.past ? " · earned" : " · forecast"}</p>
              {h.past ? (
                <Row label="Earned" value={h.earned} strong />
              ) : (
                <>
                  <Group title="Booked orders" values={h.booked} kind="solid" />
                  <Group title="Quotes in play (weighted)" values={h.expected} kind="hatched" />
                  {h.prospects > 0 ? (
                    <p className="mt-2 flex items-center justify-between gap-2 text-ink-muted">
                      <span className="flex items-center gap-[6px]">
                        <span className={`size-[8px] rounded-[2px] ${PROSPECT}`} />
                        Prospects — leads
                      </span>
                      <span className="tabular-nums text-ink">{money(h.prospects)}</span>
                    </p>
                  ) : null}
                  <Row label="Total" value={totals[hover!]} strong />
                  {h.target > 0 ? <Row label="Target" value={h.target} /> : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[44px_1fr] gap-2">
        <span />
        <div className="flex gap-[3px] text-micro text-ink-muted">
          {months.map((m, i) => (
            <span key={m.key} className={`flex-1 text-center ${i === firstFuture ? "ml-2 font-bold text-ink" : ""}`}>
              {m.short}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Group({ title, values, kind }: { title: string; values: Record<Kind, number>; kind: "solid" | "hatched" }) {
  const rows = CHART_KINDS.filter((k) => values[k.key] >= 0.5);
  if (!rows.length) return null;
  return (
    <div className="mt-2">
      <p className="flex justify-between gap-2 font-bold">
        <span>{title}</span>
        <span className="tabular-nums">{money(sumOf(values))}</span>
      </p>
      {rows.map((k) => (
        <p key={k.key} className="mt-[2px] flex items-center justify-between gap-2 text-ink-muted">
          <span className="flex items-center gap-[6px]">
            <span className="size-[8px] rounded-[2px]" style={kind === "solid" ? solid(k.key) : hatched(k.key)} />
            {k.label}
          </span>
          <span className="tabular-nums text-ink">{money(values[k.key])}</span>
        </p>
      ))}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <p className={`mt-2 flex justify-between gap-2 ${strong ? "font-bold" : "text-ink-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums text-ink">{money(value)}</span>
    </p>
  );
}
