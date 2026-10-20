import { money } from "@/lib/format";
import { PERIOD_LABEL, type ExportPeriod } from "@/lib/forecast/period";
import { KINDS, KIND_LABEL, type Forecast, type Kind } from "@/lib/queries/forecast";

/**
 * The forecast as a document: every line of business, booked and expected
 * side by side, month by month. Reads the same Forecast the dashboard does, so
 * the two never disagree. Printed (or saved as PDF) from the browser; the
 * print rules in globals.css strip the app chrome and set the page landscape.
 */

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });
const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));

export function ForecastReport({ f, period, monthKeys }: { f: Forecast; period: ExportPeriod; monthKeys: string[] }) {
  const months = f.months.filter((m) => monthKeys.includes(m.key));
  const keys = months.map((m) => m.key);
  const gone = monthKeys.length - months.length;
  if (months.length === 0)
    return (
      <article data-print-report className="rounded-card bg-panel p-6 shadow-sm">
        {PERIOD_LABEL[period]} is already past — there is no forecast for it. Pick a later period.
      </article>
    );
  const sum = (row: Record<string, number>) => keys.reduce((s, k) => s + (row[k] ?? 0), 0);

  const lines = KINDS.map((k: Kind) => {
    const booked = f.revenue[k];
    const expected = f.expectedByKind[k];
    return { key: k, label: KIND_LABEL[k], booked, expected, b: sum(booked), e: sum(expected) };
  }).filter((l) => l.b + l.e >= 0.5);
  const prospects = { booked: {}, expected: f.revenue.leads, b: 0, e: sum(f.revenue.leads) } as const;

  const bookedTotal = lines.reduce((s, l) => s + l.b, 0);
  const expectedTotal = lines.reduce((s, l) => s + l.e, 0) + prospects.e;
  const grand = bookedTotal + expectedTotal;
  const share = (v: number) => (grand > 0 ? `${Math.round((v / grand) * 100)}%` : "—");

  const monthTotal = (k: string, which: "booked" | "expected") =>
    lines.reduce((s, l) => s + (l[which][k] ?? 0), 0) + (which === "expected" ? (prospects.expected[k] ?? 0) : 0);

  const a = f.attention;
  const flagged = new Set([...a.staleBooked, ...a.nothingOut, ...a.rolling, ...a.noBillableLines].map((o) => o.id)).size;

  const first = months[0];
  const last = months[months.length - 1];
  const th = "px-2 py-[6px] text-right text-colhead uppercase text-ink-muted";
  const td = "px-2 py-[6px] text-right tabular-nums";

  return (
    <article data-print-report className="rounded-card bg-panel p-6 shadow-sm print:p-0 print:shadow-none">
      <header className="flex items-end justify-between border-b border-hairline pb-3">
        <div>
          <p className="text-micro uppercase text-ink-muted">VFXnow · Revenue forecast</p>
          <h2 className="text-page-title">
            {PERIOD_LABEL[period]}: {first.label}
            {last !== first ? ` – ${last.label}` : ""}
          </h2>
        </div>
        <p className="text-right text-detail text-ink-muted">
          Prepared {DATE.format(f.generatedAt)}
          <br />
          Ex-tax, priced as invoiced
        </p>
      </header>

      <section className="mt-4 grid grid-cols-3 gap-3">
        <Figure label="Booked" value={money(bookedTotal)} note="approved and live orders" />
        <Figure label="Expected, weighted" value={money(expectedTotal)} note="open quotes and leads, by stage" soft />
        <Figure label="Booked + expected" value={money(grand)} note={PERIOD_LABEL[period].toLowerCase()} />
      </section>

      <h3 className="mb-1 mt-6 text-micro uppercase text-ink-muted">By line of business</h3>
      <table className="w-full text-detail">
        <thead>
          <tr className="border-b border-hairline">
            <th className={`${th} text-left`}>Line</th>
            <th className={th}>Booked</th>
            <th className={th}>Expected</th>
            <th className={th}>Total</th>
            <th className={th}>Share</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b border-hairline">
              <td className="px-2 py-[6px]">{l.label}</td>
              <td className={td}>{dash(l.b)}</td>
              <td className={`${td} text-ink-muted`}>{dash(l.e)}</td>
              <td className={`${td} font-bold`}>{money(l.b + l.e)}</td>
              <td className={`${td} text-ink-muted`}>{share(l.b + l.e)}</td>
            </tr>
          ))}
          {prospects.e >= 0.5 ? (
            <tr className="border-b border-hairline">
              <td className="px-2 py-[6px]">Prospects — leads, no order yet</td>
              <td className={td}>—</td>
              <td className={`${td} text-ink-muted`}>{money(prospects.e)}</td>
              <td className={`${td} font-bold`}>{money(prospects.e)}</td>
              <td className={`${td} text-ink-muted`}>{share(prospects.e)}</td>
            </tr>
          ) : null}
          <tr className="bg-sunken font-bold">
            <td className="px-2 py-[6px]">Total</td>
            <td className={td}>{money(bookedTotal)}</td>
            <td className={td}>{money(expectedTotal)}</td>
            <td className={td}>{money(grand)}</td>
            <td className={td}>100%</td>
          </tr>
        </tbody>
      </table>

      <h3 className="mb-1 mt-6 text-micro uppercase text-ink-muted">Month by month — booked + expected</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-hairline">
            <th className={`${th} text-left`} />
            {months.map((m) => (
              <th key={m.key} className={th}>
                {m.short}
              </th>
            ))}
            <th className={th}>{keys.length === 12 ? "12 mo" : "Total"}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b border-hairline">
              <td className="px-2 py-[5px]">{l.label}</td>
              {keys.map((k) => (
                <td key={k} className={`${td} !py-[5px]`}>
                  {dash((l.booked[k] ?? 0) + (l.expected[k] ?? 0))}
                </td>
              ))}
              <td className={`${td} !py-[5px] font-bold`}>{money(l.b + l.e)}</td>
            </tr>
          ))}
          {prospects.e >= 0.5 ? (
            <tr className="border-b border-hairline">
              <td className="px-2 py-[5px]">Prospects</td>
              {keys.map((k) => (
                <td key={k} className={`${td} !py-[5px]`}>
                  {dash(prospects.expected[k] ?? 0)}
                </td>
              ))}
              <td className={`${td} !py-[5px] font-bold`}>{money(prospects.e)}</td>
            </tr>
          ) : null}
          <tr className="text-ink-muted">
            <td className="px-2 py-[5px]">of which booked</td>
            {keys.map((k) => (
              <td key={k} className={`${td} !py-[5px]`}>
                {dash(monthTotal(k, "booked"))}
              </td>
            ))}
            <td className={`${td} !py-[5px]`}>{money(bookedTotal)}</td>
          </tr>
          <tr className="bg-sunken font-bold">
            <td className="px-2 py-[5px]">Total</td>
            {keys.map((k) => (
              <td key={k} className={`${td} !py-[5px]`}>
                {dash(monthTotal(k, "booked") + monthTotal(k, "expected"))}
              </td>
            ))}
            <td className={`${td} !py-[5px]`}>{money(grand)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-4 text-detail text-ink-muted">
        Booked is revenue from approved or live orders, billed on each order&rsquo;s schedule. Expected is open quotes
        weighted by stage (quote sent 60%, draft or revision 40%) and leads at 10–50%; it is not committed.
        {gone > 0 ? ` ${gone} month${gone > 1 ? "s" : ""} of this period already gone, so not forecast and not shown.` : ""}
        {flagged > 0
          ? ` ${flagged} orders are flagged for review on the Forecast page and may move these figures.`
          : ""}
      </p>
    </article>
  );
}

function Figure({ label, value, note, soft }: { label: string; value: string; note: string; soft?: boolean }) {
  return (
    <div className="rounded-well bg-sunken px-4 py-3">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p className={`text-[24px] font-bold tabular-nums tracking-[-0.02em] ${soft ? "text-ink-muted" : ""}`}>{value}</p>
      <p className="text-detail text-ink-faint">{note}</p>
    </div>
  );
}
