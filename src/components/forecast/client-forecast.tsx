import Link from "next/link";
import { Card, CardEmpty } from "@/components/record/record-card";
import { money, moneyCompact } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/reservations/status";
import { BOOKED, KINDS, KIND_LABEL, getForecast, type Forecast, type ForecastClient, type ForecastOrder } from "@/lib/queries/forecast";

/**
 * The forecast split by client — the same counted orders as Accounting →
 * Forecast, so the clients add up to its totals (leads aside: they have no
 * client yet). Booked is what's set; expected is open quotes weighted by stage.
 */

const sum = (keys: string[], ...rows: Record<string, number>[]) =>
  keys.reduce((s, k) => s + rows.reduce((t, r) => t + (r[k] ?? 0), 0), 0);

const isBookedOrder = (o: ForecastOrder) => (BOOKED as readonly string[]).includes(o.status);

/** What an order adds in month `k`: booked in full, a quote at its weight. */
const orderAt = (o: ForecastOrder, k: string) => (o.byMonth[k] ?? 0) * (isBookedOrder(o) ? 1 : o.weight);

const statusOf = (o: ForecastOrder) => STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status;

/** "Rental $228,441 · Sale $81,463 expected" — what the client's money is, biggest first. */
function kindSummary(c: ForecastClient): string {
  return KINDS.map((k) => ({ k, ...c.byKind[k] }))
    .filter((x) => x.booked + x.expected >= 0.5)
    .sort((a, b) => b.booked + b.expected - (a.booked + a.expected))
    .map((x) =>
      [
        x.booked >= 0.5 ? `${KIND_LABEL[x.k]} ${money(x.booked)}` : null,
        x.expected >= 0.5 ? `${x.booked >= 0.5 ? "+ " : `${KIND_LABEL[x.k]} `}${money(x.expected)} expected` : null,
      ].filter(Boolean).join(" "),
    )
    .join(" · ");
}

/* ── Accounting → Forecast: every client ───────────────────────────────── */

const SHOWN = 25;

export function ClientsCard({ f }: { f: Forecast }) {
  const keys = f.months.map((m) => m.key);
  const grand = f.clients.reduce((s, c) => s + sum(keys, c.booked, c.expected), 0);
  const cols = `minmax(170px,1.6fr) repeat(${keys.length}, minmax(60px,1fr)) minmax(84px,1.1fr) 48px`;
  const top = f.clients.slice(0, SHOWN);
  const rest = f.clients.slice(SHOWN);

  return (
    <Card
      title="By client"
      meta={`${f.clients.length} clients · booked + expected (weighted) · click a client for its orders`}
      className="shrink-0"
    >
      {f.clients.length === 0 ? (
        <CardEmpty>No client has anything billing in the next twelve months.</CardEmpty>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="min-w-[1120px] px-2 text-detail">
            <div className="grid gap-x-1 px-2 pb-[6px] text-colhead uppercase text-ink-muted" style={{ gridTemplateColumns: cols }}>
              <span>Client</span>
              {f.months.map((m) => (
                <span key={m.key} className="text-right">{m.short}</span>
              ))}
              <span className="text-right">12 mo</span>
              <span className="text-right">Share</span>
            </div>
            <ul className="flex flex-col gap-px">
              {top.map((c) => (
                <ClientRow key={c.clientId} c={c} keys={keys} cols={cols} grand={grand} />
              ))}
            </ul>
            {rest.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer px-2 py-[6px] text-ink-muted">
                  {rest.length} more clients · {money(rest.reduce((s, c) => s + sum(keys, c.booked, c.expected), 0))}
                </summary>
                <ul className="flex flex-col gap-px">
                  {rest.map((c) => (
                    <ClientRow key={c.clientId} c={c} keys={keys} cols={cols} grand={grand} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}

function ClientRow({ c, keys, cols, grand }: { c: ForecastClient; keys: string[]; cols: string; grand: number }) {
  const total = sum(keys, c.booked, c.expected);
  return (
    <li>
      <details className="group">
        <summary
          className="grid cursor-pointer list-none items-baseline gap-x-1 rounded-row px-2 py-[6px] hover:bg-row-hover"
          style={{ gridTemplateColumns: cols }}
        >
          <span className="min-w-0">
            <span className="block truncate font-bold">
              <span className="mr-1 inline-block text-ink-faint transition-transform group-open:rotate-90">›</span>
              {c.client}
            </span>
            <span className="block truncate pl-3 font-normal text-ink-faint" title={kindSummary(c)}>
              {kindSummary(c)}
            </span>
          </span>
          {keys.map((k) => (
            <Amount key={k} value={c.booked[k] + c.expected[k]} soft={c.booked[k] < 0.5} />
          ))}
          <Amount value={total} strong />
          <span className="text-right tabular-nums text-ink-muted">{grand > 0 ? `${Math.round((total / grand) * 100)}%` : "—"}</span>
        </summary>
        <ul className="mb-1 flex flex-col gap-px">
          {c.orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/dashboard/orders/${o.id}`}
                className={`grid items-baseline gap-x-1 rounded-row px-2 py-[4px] hover:bg-row-hover ${isBookedOrder(o) ? "" : "text-ink-muted"}`}
                style={{ gridTemplateColumns: cols }}
              >
                <span className="truncate pl-4">
                  {o.number} · {KIND_LABEL[o.kind]} · {statusOf(o)}
                  {isBookedOrder(o) ? "" : ` × ${Math.round(o.weight * 100)}%`}
                </span>
                {keys.map((k) => (
                  <Amount key={k} value={orderAt(o, k)} />
                ))}
                <Amount value={keys.reduce((s, k) => s + orderAt(o, k), 0)} />
                <span />
              </Link>
            </li>
          ))}
          <li className="px-2 pb-1 pl-6 text-ink-faint">
            <Link href={`/dashboard/clients/${c.clientId}`} className="hover:underline">
              Open the account →
            </Link>
          </li>
        </ul>
      </details>
    </li>
  );
}

function Amount({ value, strong, soft }: { value: number; strong?: boolean; soft?: boolean }) {
  const zero = Math.abs(value) < 0.5;
  return (
    <span className={`text-right tabular-nums ${zero ? "text-ink-faint" : soft ? "text-ink-muted" : ""} ${strong ? "font-bold" : ""}`}>
      {zero ? "—" : money(value)}
    </span>
  );
}

/* ── Clients → Account: one client ─────────────────────────────────────── */

export async function ClientForecastCard({ clientId }: { clientId: string }) {
  const f = await getForecast();
  const keys = f.months.map((m) => m.key);
  const c = f.clients.find((x) => x.clientId === clientId);
  const booked = c ? sum(keys, c.booked) : 0;
  const expected = c ? sum(keys, c.expected) : 0;
  const grand = f.clients.reduce((s, x) => s + sum(keys, x.booked, x.expected), 0);

  return (
    <Card
      title="Forecast"
      meta={
        <Link href="/dashboard/forecast" className="hover:underline">
          next 12 months · ex-tax
        </Link>
      }
    >
      {!c ? (
        <CardEmpty>Nothing booked or in play bills in the next twelve months.</CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 px-4 pb-3">
            <Figure label="Booked" value={moneyCompact(booked)} />
            <Figure label="Expected" value={moneyCompact(expected)} soft />
            <Figure label="Share of all" value={grand > 0 ? `${Math.round(((booked + expected) / grand) * 100)}%` : "—"} />
          </div>
          <ul className="mb-3 flex flex-col gap-px px-2 text-detail">
            <li className="grid grid-cols-[1fr_84px_84px] gap-2 px-2 pb-[4px] text-colhead uppercase text-ink-muted">
              <span>What it is</span>
              <span className="text-right">Booked</span>
              <span className="text-right">Expected</span>
            </li>
            {KINDS.filter((k) => c.byKind[k].booked + c.byKind[k].expected >= 0.5).map((k) => (
              <li key={k} className="grid grid-cols-[1fr_84px_84px] gap-2 px-2 py-[2px]">
                <span className="font-bold">{KIND_LABEL[k]}</span>
                <Amount value={c.byKind[k].booked} />
                <Amount value={c.byKind[k].expected} soft />
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-px px-2 text-detail">
            <li className="grid grid-cols-[1fr_84px_84px] gap-2 px-2 pb-[4px] text-colhead uppercase text-ink-muted">
              <span>Month</span>
              <span className="text-right">Booked</span>
              <span className="text-right">Expected</span>
            </li>
            {f.months.map((m) => (
              <li key={m.key} className="grid grid-cols-[1fr_84px_84px] gap-2 rounded-row px-2 py-[3px] hover:bg-row-hover">
                <span>{m.label}</span>
                <Amount value={c.booked[m.key]} />
                <Amount value={c.expected[m.key]} soft />
              </li>
            ))}
          </ul>
          <ul className="mt-2 flex flex-col gap-px border-t border-hairline px-2 pb-3 pt-2 text-detail">
            {c.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/dashboard/orders/${o.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-row px-2 py-[4px] hover:bg-row-hover">
                  <span className="min-w-0">
                    <span className={`block truncate ${isBookedOrder(o) ? "font-bold" : "text-ink-muted"}`}>
                      {o.number} · {KIND_LABEL[o.kind]} · {statusOf(o)}
                      {o.name ? ` · ${o.name}` : ""}
                    </span>
                    <span className="block truncate text-ink-faint">
                      {o.term}
                      {o.monthly ? ` · ${money(o.monthly)}/mo` : ""}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {money(keys.reduce((s, k) => s + orderAt(o, k), 0))}
                    {isBookedOrder(o) ? null : (
                      <span className="block text-micro text-ink-faint">
                        {money(o.inWindow)} × {Math.round(o.weight * 100)}%
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Figure({ label, value, soft }: { label: string; value: string; soft?: boolean }) {
  return (
    <div>
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p className={`text-[20px] font-bold tabular-nums ${soft ? "text-ink-muted" : ""}`}>{value}</p>
    </div>
  );
}
