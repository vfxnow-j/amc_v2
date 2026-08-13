"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  createOrder,
  lookupAssets,
  lookupClients,
  lookupSubstitutes,
  type DraftLine,
} from "@/lib/actions/order-builder";
import type { AssetAvailability } from "@/lib/queries/order-builder";
import { Notice } from "@/components/feedback/notice";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

type Client = { id: string; name: string; companyName: string | null };

type Line = DraftLine & {
  /** Units free across the whole window when the line was added or last checked. */
  free: number;
  freeFrom: string | null;
};

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The new-order builder.
 *
 * The conflict pattern is the point of this screen, and it is the rule for the
 * whole app: a line that can't be filled is never a blocked save. It says what
 * is actually free, and offers substitute / move the window / book anyway —
 * priced, so the person choosing knows what they are choosing.
 *
 * One adaptation the design didn't have to account for: `ReservationItem`
 * carries no dates, so "start this line on Aug 2" cannot be stored per line.
 * The offer moves the whole order's window instead, and says so, rather than
 * pretending to a granularity the schema doesn't have.
 */
/**
 * `initialClient` is set when the builder is opened from an account record —
 * the client is already known, so asking for it again is a step backwards. It
 * is resolved on the server from the `client` query parameter, so an id that
 * doesn't exist arrives here as null and the picker appears as normal rather
 * than the screen half-filling with a phantom.
 */
export function OrderBuilder({
  initialClient = null,
}: {
  initialClient?: Client | null;
}) {
  const router = useRouter();
  const today = new Date();
  const [start, setStart] = useState(iso(today));
  const [end, setEnd] = useState(
    iso(new Date(today.getTime() + 7 * 86_400_000)),
  );
  const [projectName, setProjectName] = useState("");

  const [client, setClient] = useState<Client | null>(initialClient);
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<Client[]>([]);

  const [assetQuery, setAssetQuery] = useState("");
  const [assetHits, setAssetHits] = useState<AssetAvailability[]>([]);

  const [lines, setLines] = useState<Line[]>([]);
  const [subs, setSubs] = useState<Record<string, AssetAvailability[]>>({});
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const typed = useRef(false);

  useEffect(() => {
    // Clearing on an empty query happens on the same timer as a search, so the
    // effect never sets state synchronously and cascades a second render.
    const timer = setTimeout(() => {
      if (!clientQuery.trim()) setClientHits([]);
      else lookupClients(clientQuery).then(setClientHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [clientQuery]);

  useEffect(() => {
    if (!typed.current || !assetQuery.trim()) return;
    const timer = setTimeout(() => {
      lookupAssets(assetQuery, start, end).then(setAssetHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [assetQuery, start, end]);

  function addLine(asset: AssetAvailability) {
    setAssetQuery("");
    setAssetHits([]);
    setLines((current) => [
      ...current,
      {
        assetId: asset.assetId,
        name: asset.name,
        quantity: 1,
        rate: asset.rate,
        pricingType: asset.pricingType,
        free: asset.free,
        freeFrom: asset.freeFrom ? iso(new Date(asset.freeFrom)) : null,
      },
    ]);
  }

  function update(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function short(line: Line) {
    return Math.max(0, line.quantity - line.free);
  }

  async function offerSubstitutes(line: Line) {
    const found = await lookupSubstitutes(
      line.assetId,
      line.quantity,
      start,
      end,
    );
    setSubs((current) => ({ ...current, [line.assetId]: found }));
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await createOrder({
        clientId: client?.id ?? "",
        start,
        end,
        projectName,
        lines: lines.map(({ free, freeFrom, ...line }) => {
          void free;
          void freeFrom;
          return line;
        }),
      });
      if (result.status === "error") setError(result.message);
      else router.push(`/dashboard/reservations/${result.reservationId}`);
    });
  }

  const total = lines.reduce((sum, l) => sum + l.rate * l.quantity, 0);
  const unresolved = lines.filter((l) => short(l) > 0 && !l.overbooked);

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
        <header className="flex items-center gap-2 px-4 pb-3">
          <h2 className="text-card-title">Equipment</h2>
          <span className="text-detail text-ink-muted">
            Availability is checked across {DAY.format(new Date(start))} –{" "}
            {DAY.format(new Date(end))}
          </span>
        </header>

        <div className="px-4 pb-3">
          <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
            <Search className="size-4 flex-none text-ink-faint" aria-hidden />
            <input
              value={assetQuery}
              onChange={(event) => {
                typed.current = true;
                setAssetQuery(event.target.value);
              }}
              placeholder="Search assets to add"
              aria-label="Search assets"
              className="w-full border-0 bg-transparent text-body outline-none placeholder:text-ink-faint"
            />
          </label>

          {assetHits.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-px rounded-well bg-sunken p-1">
              {assetHits.map((asset) => (
                <li key={asset.assetId}>
                  <button
                    type="button"
                    onClick={() => addLine(asset)}
                    className="grid w-full grid-cols-[1fr_96px_80px] items-center gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="truncate">{asset.name}</span>
                    <span
                      className={
                        asset.free > 0 ? "text-ink-muted" : "text-accent-text"
                      }
                    >
                      {asset.free} of {asset.fleet} free
                    </span>
                    <span className="text-right tabular-nums">
                      {MONEY.format(asset.rate)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
          {lines.length === 0 ? (
            <li className="px-2 py-6 text-center text-body text-ink-muted">
              Nothing on this order yet — search above to add the first line.
            </li>
          ) : null}

          {lines.map((line, index) => {
            const missing = short(line);
            const substitutes = subs[line.assetId] ?? [];
            return (
              <li key={`${line.assetId}-${index}`} className="rounded-bubble bg-row-alt p-2">
                <div className="grid grid-cols-[1fr_64px_88px_88px_28px] items-center gap-2 px-1">
                  <span className="truncate font-bold">{line.name}</span>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    aria-label={`Quantity of ${line.name}`}
                    onChange={(event) =>
                      update(index, {
                        quantity: Math.max(1, Number(event.target.value) || 1),
                        // A changed quantity is a new question.
                        overbooked: false,
                      })
                    }
                    className="h-7 rounded-row border-0 bg-panel px-2 text-right text-detail tabular-nums outline-none"
                  />
                  <span className="text-right text-detail tabular-nums text-ink-muted">
                    {MONEY.format(line.rate)}
                    <span className="text-ink-faint">
                      /{line.pricingType.toLowerCase().slice(0, 2)}
                    </span>
                  </span>
                  <span className="text-right font-bold tabular-nums">
                    {MONEY.format(line.rate * line.quantity)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() =>
                      setLines((c) => c.filter((_, i) => i !== index))
                    }
                    className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>

                {missing > 0 && !line.overbooked ? (
                  <div className="mt-2 rounded-well bg-accent-tint p-2">
                    <p className="text-detail font-bold text-accent-on-tint">
                      {line.free === 0
                        ? `No ${line.name} is free for the whole window`
                        : `Only ${line.free} of ${line.quantity} ${line.name} are free for the whole window`}
                      {line.freeFrom
                        ? ` — the rest are out until ${DAY.format(new Date(line.freeFrom))}`
                        : ""}
                      .
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => offerSubstitutes(line)}
                        className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid"
                      >
                        Find a substitute
                      </button>
                      {line.freeFrom ? (
                        <button
                          type="button"
                          onClick={() => setStart(line.freeFrom!)}
                          className="rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover"
                        >
                          Start the order {DAY.format(new Date(line.freeFrom))}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => update(index, { overbooked: true })}
                        className="rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover"
                      >
                        Book anyway, flag ops
                      </button>
                    </div>

                    {line.freeFrom ? (
                      // Said out loud: ReservationItem has no dates, so a line
                      // cannot start on its own day.
                      <p className="mt-2 text-detail text-accent-on-tint">
                        Moving the start moves the whole order — a line can&rsquo;t
                        begin on its own date.
                      </p>
                    ) : null}

                    {substitutes.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-px">
                        {substitutes.map((sub) => (
                          <li key={sub.assetId}>
                            <button
                              type="button"
                              onClick={() => {
                                update(index, {
                                  assetId: sub.assetId,
                                  name: sub.name,
                                  rate: sub.rate,
                                  pricingType: sub.pricingType,
                                  free: sub.free,
                                  freeFrom: null,
                                  overbooked: false,
                                });
                                setSubs((c) => ({ ...c, [line.assetId]: [] }));
                              }}
                              className="grid w-full grid-cols-[1fr_88px_72px] items-center gap-2 rounded-row bg-panel px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                            >
                              <span className="truncate">
                                Substitute {sub.name}
                              </span>
                              <span className="text-ink-muted">
                                {sub.free} free
                              </span>
                              <span className="text-right tabular-nums">
                                {MONEY.format(sub.rate)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {line.overbooked ? (
                  <p className="mt-2 rounded-well bg-sunken px-2 py-1 text-detail text-ink-muted">
                    Booked over what&rsquo;s free. Ops will be flagged on this
                    order.{" "}
                    <button
                      type="button"
                      onClick={() => update(index, { overbooked: false })}
                      className="text-accent-text underline-offset-2 hover:underline"
                    >
                      Undo
                    </button>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="flex flex-col gap-3">
        <section className="rounded-card bg-panel px-4 py-[14px] shadow-sm">
          <h2 className="mb-3 text-card-title">Order</h2>

          <label className={LABEL} htmlFor="client">
            Client
          </label>
          {client ? (
            <div className="mb-3 flex items-center gap-2 rounded-well bg-sunken px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-body">
                {client.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setClient(null);
                  setClientQuery("");
                }}
                className="text-detail text-accent-text hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="mb-3">
              <input
                id="client"
                value={clientQuery}
                onChange={(event) => setClientQuery(event.target.value)}
                placeholder="Search clients"
                className={FIELD}
              />
              {clientHits.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-px rounded-well bg-sunken p-1">
                  {clientHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClient(hit);
                          setClientHits([]);
                        }}
                        className="w-full truncate rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                      >
                        {hit.name}
                        {hit.companyName ? (
                          <span className="text-ink-faint"> · {hit.companyName}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} htmlFor="start">
                Starts
              </label>
              <input
                id="start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="end">
                Ends
              </label>
              <input
                id="end"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className={FIELD}
              />
            </div>
          </div>

          <label className={LABEL} htmlFor="project">
            Project
          </label>
          <input
            id="project"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Optional"
            className={FIELD}
          />
        </section>

        <section className="rounded-card bg-panel px-4 py-[14px] shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-card-title">Per period</span>
            <span className="text-page-title text-[22px] tabular-nums">
              {MONEY.format(total)}
            </span>
          </div>
          <p className="mt-1 text-detail text-ink-muted">
            {lines.length === 0
              ? "Nothing added yet"
              : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · the record prices the full term`}
          </p>

          {error ? (
            <Notice tone="error" className="mt-3">
              {error}
            </Notice>
          ) : null}

          {unresolved.length > 0 ? (
            <Notice tone="ok" className="mt-3">
              {unresolved.length} {unresolved.length === 1 ? "line needs" : "lines need"}{" "}
              an answer before this can be saved — substitute, move the start, or
              book anyway.
            </Notice>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !client || lines.length === 0 || unresolved.length > 0}
            className="mt-3 h-10 w-full rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create draft order"}
          </button>
          <p className="mt-2 text-detail text-ink-muted">
            Saved as a draft, which holds no stock. Approving it is what commits
            the units.
          </p>
        </section>
      </aside>
    </div>
  );
}
