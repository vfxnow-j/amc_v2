import { Card, CardEmpty } from "@/components/record/record-card";
import { moneyExact } from "@/lib/format";
import { getFlowRecord } from "@/lib/queries/flow-record";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

/**
 * A Flow order's payment schedule, month by month, with the step marked.
 * Ported from v1's flow-schedule-table.
 *
 * An infeasible schedule has nothing billable in it — its rows can be $0 months
 * that read like a real payment plan — so it shows why instead of rows anybody
 * could quote from (v1 ffd0c77).
 */
export async function FlowScheduleCard({ id }: { id: string }) {
  const record = await getFlowRecord(id);
  if (!record) return null;
  const { schedule } = record;

  if (!schedule) {
    return (
      <Card title="Payment schedule">
        <CardEmpty>{record.problem ?? "This Flow order cannot be priced yet."}</CardEmpty>
      </Card>
    );
  }
  if (!schedule.feasible) {
    return (
      <Card title="Payment schedule">
        <p className="px-4 pb-4 text-body text-balance text-destructive">
          This schedule is not feasible, so there is nothing to bill. Adjust the
          term or the pricing, or give every line a cost basis above $0.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Payment schedule" meta={`${schedule.rows.length} months`}>
      <div className="max-h-[360px] overflow-y-auto px-2">
        <table className="w-full text-detail tabular-nums">
          <thead className="sticky top-0 bg-panel text-micro uppercase text-ink-muted">
            <tr>
              <th className="px-2 py-1 text-left font-normal">#</th>
              <th className="px-2 py-1 text-left font-normal">Month</th>
              <th className="px-2 py-1 text-right font-normal">Payment</th>
              <th className="px-2 py-1 text-right font-normal">Paid to date</th>
              <th className="px-2 py-1 text-right font-normal">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row) => (
              <tr
                key={row.month}
                className={`${row.step ? "border-t-2 border-accent-solid" : ""} ${
                  row.billed ? "text-ink-faint line-through" : ""
                } ${row.current ? "bg-row-alt" : ""}`}
              >
                <td className="px-2 py-[3px]">{row.month}</td>
                <td className="whitespace-nowrap px-2 py-[3px]">
                  {MONTH.format(row.date)}
                  {row.step ? (
                    <span className="ml-2 rounded-pill bg-accent-tint px-[6px] text-micro text-accent-on-tint">
                      step
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-[3px] text-right font-bold">{moneyExact(row.rate)}</td>
                <td className="px-2 py-[3px] text-right">{moneyExact(row.cumulative)}</td>
                <td className="px-2 py-[3px] text-right text-ink-muted">{moneyExact(row.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 pb-4 pt-2 text-detail text-balance text-ink-muted">
        The contract rate, before any discount or sales tax. It steps down at the
        12-month anniversary once the hardware is recovered.
      </p>
    </Card>
  );
}
