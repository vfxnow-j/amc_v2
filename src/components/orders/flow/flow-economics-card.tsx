import { Card, CardEmpty } from "@/components/record/record-card";
import { moneyExact } from "@/lib/format";
import { getFlowRecord } from "@/lib/queries/flow-record";

/**
 * Internal only: what the gear on a Flow order cost us, what it still owes on
 * its leases, and the deal placed against that (owner, 2026-09-26: "broken out
 * on cost for the hardware, then place the deal against it").
 *
 * Priced on every render from flowInputsForOrder(), so a lease's terms being
 * recorded or changed shows here at once. Funding never moves the client's
 * price — only these figures. Early-return figures are deliberately absent: the
 * engine's earlyReturn() is exact for one loan only, and gear here can sit on
 * several leases.
 */
export async function FlowEconomicsCard({ id }: { id: string }) {
  const record = await getFlowRecord(id);
  if (!record) return null;
  const view = record.economics;

  if (!view) {
    return (
      <Card title="The deal" meta={<InternalPill />}>
        <CardEmpty>{record.problem ?? "This Flow order cannot be priced yet."}</CardEmpty>
      </Card>
    );
  }

  const { deal, totals } = view;
  const leased = totals.leaseBalance > 0;

  return (
    <Card title="The deal" meta={<InternalPill />}>
      <h3 className="px-4 pb-1 text-micro uppercase text-ink-muted">Hardware</h3>
      <ul className="flex flex-col gap-px px-2 pb-2">
        {view.hardware.map((row) => (
          <li key={row.itemId} className="rounded-row bg-row-alt px-2 py-[6px] text-detail">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 break-words font-bold">
                {row.name}
                <span className="font-normal text-ink-muted"> ×{row.units}</span>
              </span>
              <span className="tabular-nums font-bold">{moneyExact(row.trueCost)}</span>
            </div>
            <div className="mt-[2px] grid grid-cols-2 gap-x-3 gap-y-[2px] text-ink-muted tabular-nums">
              <span>
                {row.trueCostEach != null ? `${moneyExact(row.trueCostEach)} each, true cost` : "not costed yet"}
              </span>
              {row.leaseBalance > 0 ? (
                <>
                  <span className="text-right">owes {moneyExact(row.leaseBalance)}</span>
                  <span>{moneyExact(row.leasePayment)}/mo lease</span>
                  <span className="text-right">{moneyExact(row.interestOverTerm)} interest over term</span>
                </>
              ) : (
                <span className="text-right">owned outright</span>
              )}
            </div>
            {row.leases.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {row.leases.map((lease) => (
                  <span
                    key={lease.label}
                    className="rounded-pill bg-sunken px-[6px] text-micro text-ink-muted"
                  >
                    {lease.label}
                  </span>
                ))}
                {row.assumed ? (
                  <span className="rounded-pill bg-[var(--warning)] px-[6px] text-micro text-[var(--warning-on)]">
                    lease terms missing — {view.assumption}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="mx-4 mb-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-[2px] border-t border-hairline pt-2 text-detail tabular-nums">
        <dt className="text-ink-muted">Hardware at true cost · {totals.units} units</dt>
        <dd className="text-right font-bold">{moneyExact(totals.trueCost)}</dd>
        <dt className="text-ink-muted">Still owed on its leases</dt>
        <dd className="text-right">{leased ? moneyExact(totals.leaseBalance) : "nothing"}</dd>
        {leased ? (
          <>
            <dt className="text-ink-muted">Lease payments</dt>
            <dd className="text-right">{moneyExact(totals.leasePayment)}/mo</dd>
          </>
        ) : null}
      </dl>

      <h3 className="px-4 pb-1 text-micro uppercase text-ink-muted">The deal against it</h3>
      <dl className="mx-4 mb-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-[2px] text-detail tabular-nums">
        <dt className="text-ink-muted">Contract</dt>
        <dd className="text-right">{moneyExact(deal.contract)}</dd>
        <dt className="text-ink-muted">Hardware at cost</dt>
        <dd className="text-right">−{moneyExact(deal.hardware)}</dd>
        <dt className="text-ink-muted">Finance allowance charged</dt>
        <dd className="text-right">{moneyExact(deal.financeAllowance)}</dd>
        <dt className="text-ink-muted">Interest it actually costs</dt>
        <dd className="text-right">−{moneyExact(deal.financeActual)}</dd>
        <dt className="text-ink-muted">{deal.financeGap >= 0 ? "Allowance to spare" : "Allowance short by"}</dt>
        <dd className={`text-right ${deal.financeGap < 0 ? "font-bold text-destructive" : ""}`}>
          {moneyExact(Math.abs(deal.financeGap))}
        </dd>
        <dt className="font-bold">Profit</dt>
        <dd className={`text-right font-bold ${deal.profit < 0 ? "text-destructive" : ""}`}>
          {moneyExact(deal.profit)}
        </dd>
        <dt className="text-ink-muted">Per month · of contract</dt>
        <dd className="text-right">
          {moneyExact(deal.profitPerMonth)} · {deal.marginOnContract}%
        </dd>
      </dl>
      <dl className="mx-4 mb-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-[2px] border-t border-hairline pt-2 text-detail tabular-nums">
        <dt className="text-ink-muted">Net cash, month 1</dt>
        <dd className={`text-right ${deal.monthOneNet < 0 ? "font-bold text-destructive" : ""}`}>
          {moneyExact(deal.monthOneNet)}
        </dd>
        <dt className="text-ink-muted">Thinnest month (month {deal.thinnestMonth})</dt>
        <dd className={`text-right ${deal.thinnestNet < 0 ? "font-bold text-destructive" : ""}`}>
          {moneyExact(deal.thinnestNet)}
        </dd>
        <dt className="text-ink-muted">Still owed at term end</dt>
        <dd className="text-right">{moneyExact(deal.stillOwedAtTermEnd)}</dd>
        <dt className="text-ink-muted">Gear worth at term end</dt>
        <dd className="text-right">{moneyExact(deal.gearValueAtTermEnd)}</dd>
      </dl>
      <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
        {leased
          ? `Net cash is the month's payment less ${moneyExact(deal.notePayment)}/mo on the leases behind this gear. Lease figures are for the units on this order, split from each lease by what they cost.`
          : "No gear on this order sits on a lease, so the payments are all cash in."}
        {view.flooredLines > 0
          ? ` ${view.flooredLines} ${view.flooredLines === 1 ? "line had its" : "lines had their"} basis below cost, raised to cost.`
          : ""}
      </p>
    </Card>
  );
}

function InternalPill() {
  return (
    <span className="rounded-pill bg-sunken px-[6px] text-micro uppercase text-ink-muted">
      Internal
    </span>
  );
}
