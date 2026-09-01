import { money } from "@/lib/format";
import { getBillingBook } from "@/lib/queries/orders";

/**
 * Operate → Orders: how the live book bills.
 *
 * The type cards say where the money comes from. This says how it arrives —
 * which is the difference between an order that keeps earning on its own and
 * one that only earns when somebody remembers to raise an invoice. Both are on
 * the same list and until now looked identical on it.
 *
 * Two of the four readings are faults rather than figures, and they earn their
 * place by being the ones nothing else surfaces: a recurring order with no next
 * billing date is skipped by the billing run forever, and a committed one-time
 * order with no invoice against it is revenue nobody has asked for yet.
 */
export async function BillingBook() {
  const book = await getBillingBook();
  const total = book.recurring.count + book.oneTime.count + book.notBilled.count;

  if (total === 0) {
    return (
      <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
        <h2 className="text-card-title">How the book bills</h2>
        <p className="pt-1 text-detail text-ink-muted">
          Nothing is committed yet. Approve an order and its billing terms show
          up here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex items-baseline gap-2 pb-2">
        <h2 className="text-card-title">How the book bills</h2>
        <span className="text-detail text-ink-muted">
          {total} committed {total === 1 ? "order" : "orders"} · contract value,
          not per cycle
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Cell
          label="Recurring"
          value={money(book.recurring.value)}
          detail={
            book.recurring.count === 0
              ? "Nothing recurring"
              : `${book.recurring.count} ${book.recurring.count === 1 ? "order" : "orders"} · ${
                  book.recurring.dueSoon > 0
                    ? `${book.recurring.dueSoon} bill within a week`
                    : "none due this week"
                }`
          }
          warn={
            book.recurring.stalled > 0
              ? `${book.recurring.stalled} ${
                  book.recurring.stalled === 1 ? "has" : "have"
                } no next billing date, so the run skips ${
                  book.recurring.stalled === 1 ? "it" : "them"
                }`
              : null
          }
        />
        <Cell
          label="One time"
          value={money(book.oneTime.value)}
          detail={
            book.oneTime.count === 0
              ? "Nothing one-off"
              : `${book.oneTime.count} ${book.oneTime.count === 1 ? "order" : "orders"}, billed by hand`
          }
          warn={
            book.oneTime.uninvoiced > 0
              ? `${book.oneTime.uninvoiced} with nothing raised yet — ${money(
                  book.oneTime.uninvoicedValue,
                )} uninvoiced`
              : null
          }
        />
        <Cell
          label="Never billed"
          value={money(book.notBilled.value)}
          detail={
            book.notBilled.count === 0
              ? "None"
              : `${book.notBilled.count} ${
                  book.notBilled.count === 1 ? "order" : "orders"
                } marked not billed — evaluations and goodwill kit`
          }
          warn={null}
        />
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  detail,
  warn,
}: {
  label: string;
  value: string;
  detail: string;
  warn: string | null;
}) {
  return (
    <div className="flex flex-col rounded-bubble bg-sunken p-3">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="mt-1 text-kpi">{value}</span>
      <span className="mt-1 text-detail text-ink-muted">{detail}</span>
      {warn ? (
        <span className="mt-1 text-detail text-destructive">{warn}</span>
      ) : null}
    </div>
  );
}

export function BillingBookSkeleton() {
  return (
    <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="h-[17px] w-44 animate-pulse rounded-row bg-row-alt" />
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-[92px] animate-pulse rounded-bubble bg-sunken" />
        ))}
      </div>
    </section>
  );
}
