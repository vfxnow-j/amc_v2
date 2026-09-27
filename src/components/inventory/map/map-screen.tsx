"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  MAP_KIND_LABEL,
  MAP_KINDS,
  UNPLACED_REASON_LABEL,
  type MapData,
  type MapKind,
  type MapPlace,
  type ReachRow,
} from "@/lib/map/types";
import { KIND_TOKEN } from "./map-colors";
import { PinForm } from "./pin-form";
import type { MapSelection } from "./map-canvas";

/**
 * Inventory → Map. The server page renders the header and hands this the whole
 * reading; every control writes the URL so the server re-queries and the view
 * is shareable — the same rule as the list screens' filter strips.
 *
 * The coverage line is never hidden. The map is mostly empty until delivery
 * addresses are filled in, and the screen must never imply full coverage.
 */

const MapCanvas = dynamic(() => import("./map-canvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-sunken" />,
});

type Projection = "globe" | "mercator";

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);

/** "units" → "1 unit". The nouns on this screen are simple plurals. */
function count(n: number, noun: string) {
  const word = n === 1 && noun.endsWith("s") ? noun.slice(0, -1) : noun;
  return `${fmt(n)} ${word}`;
}

/* ── Small controls ─────────────────────────────────────────────────────── */

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              selected
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  anyLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-[30px] max-w-[220px] rounded-pill border-0 px-3 text-pill outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        value
          ? "bg-accent-tint-strong text-accent-on-tint"
          : "bg-sunken text-ink-muted"
      }`}
    >
      <option value="">{anyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-[6px] text-micro uppercase text-ink-faint">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-[30px] rounded-pill border-0 px-3 text-pill normal-case tracking-normal outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value
            ? "bg-accent-tint-strong text-accent-on-tint"
            : "bg-sunken text-ink-muted"
        }`}
      />
    </label>
  );
}

function KindDot({ kind }: { kind: MapKind }) {
  return (
    <span
      aria-hidden
      className="inline-block size-[9px] shrink-0 rounded-full"
      style={{ background: KIND_TOKEN[kind] }}
    />
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export function MapScreen({
  data,
  canPin = false,
}: {
  data: MapData;
  /** Editors can pin an address the geocoder couldn't place. */
  canPin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<"map" | "unplaced">("map");
  const [projection, setProjection] = useState<Projection>("globe");

  // Canvas reports, tied to the reading they came from so a new query resets
  // them without an effect.
  const [view, setView] = useState<{ for: MapData; ids: string[] } | null>(null);
  const [picked, setPicked] = useState<{ for: MapData; sel: MapSelection } | null>(
    null,
  );
  const viewIds = view?.for === data ? view.ids : null;
  const selection = picked?.for === data ? picked.sel : null;

  const { filters } = data;
  const isClients = filters.layer === "clients";

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      const isDefault =
        !value ||
        (key === "layer" && value === "inventory") ||
        (key === "mode" && value === "now");
      if (isDefault) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  const placeById = useMemo(
    () => new Map(data.places.map((place) => [place.id, place])),
    [data.places],
  );

  const kindsPresent = useMemo(() => {
    const present = new Set(data.places.map((place) => place.kind));
    return MAP_KINDS.filter((kind) => present.has(kind));
  }, [data.places]);

  const listed: MapPlace[] = useMemo(() => {
    const ids = selection?.placeIds ?? viewIds;
    const places = ids
      ? ids.flatMap((id) => placeById.get(id) ?? [])
      : data.places;
    return [...places].sort((a, b) => b.weight - a.weight);
  }, [selection, viewIds, placeById, data.places]);

  const panelTitle = selection
    ? selection.placeIds.length === 1
      ? `At ${selection.label}`
      : "In this cluster"
    : "In view";

  const empty = data.places.length === 0;

  return (
    <div
      className={`flex flex-col gap-3 transition-opacity ${pending ? "opacity-70" : ""}`}
      aria-busy={pending}
    >
      {/* Control strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Layer"
          value={filters.layer}
          options={[
            { value: "inventory", label: "Inventory" },
            { value: "clients", label: "Clients" },
          ]}
          onChange={(layer) =>
            update(layer === "clients" ? { layer, mode: null } : { layer })
          }
        />
        {isClients ? null : (
          <Segmented
            label="Mode"
            value={filters.mode}
            options={[
              { value: "now", label: "Now" },
              { value: "reach", label: "Reach" },
            ]}
            onChange={(mode) => update({ mode })}
          />
        )}
        <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
        <FilterSelect
          label="Order type"
          anyLabel="All types"
          value={filters.type ?? ""}
          options={data.options.types}
          onChange={(type) => update({ type })}
        />
        <FilterSelect
          label="Status"
          anyLabel="All statuses"
          value={filters.status ?? ""}
          options={data.options.statuses}
          onChange={(status) => update({ status })}
        />
        <FilterSelect
          label="Client"
          anyLabel="All clients"
          value={filters.clientId ?? ""}
          options={data.options.clients.map((client) => ({
            value: client.id,
            label: client.name,
          }))}
          onChange={(client) => update({ client })}
        />
        <DateInput
          label="From"
          value={filters.from ?? ""}
          onChange={(from) => update({ from })}
        />
        <DateInput
          label="To"
          value={filters.to ?? ""}
          onChange={(to) => update({ to })}
        />
        {pending ? (
          <span className="text-detail text-ink-faint">Updating…</span>
        ) : null}
      </div>

      {/* Coverage — always visible */}
      <p className="flex flex-wrap items-center gap-2 rounded-row bg-sunken px-3 py-2 text-body text-ink-muted">
        <span className="rounded-pill bg-panel px-2 py-[2px] text-pill text-ink tabular-nums">
          {fmt(data.coverage.placed)}
          <span className="text-ink-faint"> / {fmt(data.coverage.total)}</span>
        </span>
        <span>{data.coverage.text}</span>
      </p>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Map view"
        className="inline-flex w-fit gap-px rounded-pill bg-segmented-track p-[3px]"
      >
        {(
          [
            ["map", "Map"],
            ["unplaced", `Unplaced (${fmt(data.unplaced.length)})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              tab === value
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "map" ? (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            {/* Map */}
            <div className="relative h-[calc(100vh-260px)] min-h-[420px] overflow-hidden rounded-card bg-sunken shadow-sm">
              <MapCanvas
                geojson={data.geojson}
                projection={projection}
                weightNoun={data.weightNoun}
                onViewChange={(ids) => setView({ for: data, ids })}
                onSelect={(sel) => setPicked({ for: data, sel })}
              />
              <div className="absolute left-3 top-3 z-10">
                <div className="rounded-pill bg-panel/90 shadow-sm backdrop-blur">
                  <Segmented
                    label="Projection"
                    value={projection}
                    options={[
                      { value: "globe", label: "Globe" },
                      { value: "mercator", label: "Flat" },
                    ]}
                    onChange={setProjection}
                  />
                </div>
              </div>
              {kindsPresent.length > 0 ? (
                <ul
                  aria-label="Legend"
                  className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap gap-x-3 gap-y-1 rounded-row bg-panel/90 px-3 py-2 text-detail text-ink-muted shadow-sm backdrop-blur"
                >
                  {kindsPresent.map((kind) => (
                    <li key={kind} className="flex items-center gap-[6px]">
                      <KindDot kind={kind} />
                      {MAP_KIND_LABEL[kind]}
                    </li>
                  ))}
                </ul>
              ) : null}
              {empty ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm rounded-card bg-panel p-4 text-center shadow-sm">
                    <p className="text-card-title">Nothing to pin yet</p>
                    <p className="mt-1 text-body text-balance text-ink-muted">
                      Nothing on this layer can be placed yet — no row has an
                      address the map can locate.
                    </p>
                    {data.unplaced.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setTab("unplaced")}
                        className="mt-3 rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid"
                      >
                        See the {fmt(data.unplaced.length)} unplaced
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Side panel */}
            <section className="flex max-h-[calc(100vh-260px)] min-h-[420px] flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
              <header className="flex items-center gap-2 px-4 pb-3">
                <h2 className="truncate text-card-title">{panelTitle}</h2>
                <span className="shrink-0 text-detail text-ink-muted">
                  {count(listed.length, "places")}
                </span>
                {selection ? (
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="ml-auto shrink-0 text-detail text-accent-text hover:underline"
                  >
                    Show all in view
                  </button>
                ) : null}
              </header>
              {listed.length === 0 ? (
                <p className="px-4 pb-4 text-body text-balance text-ink-muted">
                  {empty
                    ? "Nothing is placed on this layer yet."
                    : "Nothing in view. Zoom out or pan to see places."}
                </p>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
                  {listed.map((place) => (
                    <li key={place.id}>
                      <div className="flex items-baseline gap-2 px-2 pb-1">
                        <span className="truncate text-micro uppercase text-ink-faint">
                          {place.label}
                        </span>
                        <span className="ml-auto shrink-0 text-detail text-ink-faint tabular-nums">
                          {count(place.weight, data.weightNoun)}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-[2px]">
                        {place.items.map((item) => (
                          <li key={item.id} className="group relative">
                            <div className="flex items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] group-hover:bg-row-hover">
                              <KindDot kind={item.kind} />
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={item.href}
                                  className="block truncate text-body text-ink before:absolute before:inset-0 before:rounded-row before:content-[''] hover:underline"
                                >
                                  {item.title}
                                </Link>
                                <div className="truncate text-detail text-ink-muted">
                                  {item.subtitle}
                                </div>
                              </div>
                              <span className="shrink-0 text-detail text-ink-muted tabular-nums">
                                {count(item.weight, data.weightNoun)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <ReachStrip data={data} />
        </>
      ) : (
        <UnplacedList data={data} isClients={isClients} canPin={canPin} />
      )}
    </div>
  );
}

/* ── Reach strip ────────────────────────────────────────────────────────── */

function ReachStrip({ data }: { data: MapData }) {
  const columns: [string, ReachRow[]][] = [
    ["Countries", data.reach.countries],
    ["States & provinces", data.reach.regions],
    ["Cities", data.reach.cities],
  ];
  return (
    <section className="rounded-card bg-panel p-4 shadow-sm">
      <header className="flex flex-wrap items-baseline gap-2 pb-3">
        <h2 className="text-card-title">Reach</h2>
        <span className="text-detail text-ink-muted">
          From placed rows only — unplaced rows aren&apos;t counted.
        </span>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {columns.map(([title, rows]) => (
          <div key={title} className="min-w-0">
            <h3 className="pb-2 text-micro uppercase text-ink-faint">{title}</h3>
            {rows.length === 0 ? (
              <p className="text-detail text-ink-faint">None placed yet.</p>
            ) : (
              <ul className="flex flex-col gap-[2px]">
                {rows.slice(0, 8).map((row) => (
                  <li
                    key={row.key}
                    className="flex items-baseline gap-2 rounded-row px-2 py-1 odd:bg-row-alt"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                      {row.label}
                    </span>
                    <span className="shrink-0 text-detail text-ink-muted tabular-nums">
                      {count(row.records, data.recordNoun)} ·{" "}
                      {count(row.weight, data.weightNoun)}
                    </span>
                  </li>
                ))}
                {rows.length > 8 ? (
                  <li className="px-2 pt-1 text-detail text-ink-faint">
                    +{fmt(rows.length - 8)} more
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Unplaced tab ───────────────────────────────────────────────────────── */

function UnplacedList({
  data,
  isClients,
  canPin,
}: {
  data: MapData;
  isClients: boolean;
  canPin: boolean;
}) {
  const tracks = "minmax(0,1.4fr) minmax(0,0.6fr) minmax(0,1fr) minmax(0,1.4fr)";
  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="px-4 pb-3">
        <h2 className="text-card-title">Unplaced</h2>
        <p className="mt-1 text-body text-ink-muted">
          {isClients
            ? "Open the client and fill in its address to place it."
            : "Hardware is pinned only at a real delivery address. Open the order and fill in its Shipping address to place it."}
        </p>
      </header>
      {data.unplaced.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          Everything on this layer is placed.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div
              className="grid gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted"
              style={{ gridTemplateColumns: tracks }}
            >
              <span>Record</span>
              <span className="text-right">{data.weightNoun}</span>
              <span>Why</span>
              <span>Address</span>
            </div>
            <ul className="flex flex-col gap-[2px] px-2 pb-3">
              {data.unplaced.map((row, index) => (
                <li key={row.id} className="group relative">
                  <div
                    className={`grid items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] group-hover:bg-row-hover ${
                      index % 2 === 1 ? "bg-row-alt" : ""
                    }`}
                    style={{ gridTemplateColumns: tracks }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <KindDot kind={row.kind} />
                      <div className="min-w-0">
                        <Link
                          href={row.href}
                          className="block truncate text-body text-ink before:absolute before:inset-0 before:rounded-row before:content-[''] hover:underline"
                        >
                          {row.title}
                        </Link>
                        <div className="truncate text-detail text-ink-muted">
                          {row.subtitle}
                        </div>
                      </div>
                    </div>
                    <span className="text-right text-body tabular-nums">
                      {fmt(row.weight)}
                    </span>
                    <span className="truncate text-detail text-ink-muted">
                      {UNPLACED_REASON_LABEL[row.reason]}
                    </span>
                    <div className="min-w-0 text-detail text-ink-muted">
                      <span className="block truncate">{row.address || "—"}</span>
                      {row.reason === "NOT_FOUND" && row.address && canPin ? (
                        <PinForm address={row.address} />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
