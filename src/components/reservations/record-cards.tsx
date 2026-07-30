import Link from "next/link";
import {
  getReservationActivity,
  getReservationInvoices,
  getReservationLines,
  type RecordUnit,
} from "@/lib/queries/reservation-record";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function Card({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm ${className}`}
    >
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">{title}</h2>
        {meta ? <span className="text-detail text-ink-muted">{meta}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Where a unit has got to on this order. One vocabulary, used everywhere. */
export function unitState(unit: RecordUnit): {
  label: string;
  tone: "back" | "out" | "ready" | "waiting";
} {
  if (unit.checkedInAt) return { label: "Back", tone: "back" };
  if (unit.checkedOutAt) return { label: "Out", tone: "out" };
  if (unit.assignedAt) return { label: "Assigned", tone: "ready" };
  return { label: "Not assigned", tone: "waiting" };
}

const TONE_CLASS = {
  back: "text-ink-muted",
  out: "font-bold text-accent-text",
  ready: "text-ink",
  waiting: "text-ink-faint",
} as const;

/** Line · units. The unit rows are the point — this is where the kit is. */
export async function LinesCard({ id }: { id: string }) {
  const lines = await getReservationLines(id);
  const unitCount = lines.reduce((sum, line) => sum + line.units.length, 0);

  if (lines.length === 0) {
    return (
      <Card title="Lines">
        <p className="px-4 pb-4 text-body text-ink-muted">
          Nothing has been added to this order yet — add a line to price it, or
          scan a unit to add one as you pull it.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Lines"
      meta={`${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${unitCount} ${unitCount === 1 ? "unit" : "units"} attached`}
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {lines.map((line) => (
          <li key={line.id} className="rounded-bubble bg-row-alt p-2">
            <div className="grid grid-cols-[1fr_58px_96px_96px] items-baseline gap-2 px-1">
              <span className="truncate font-bold">
                {line.label}
                {line.packageName && line.packageName !== "Default" ? (
                  <span className="font-normal text-ink-faint">
                    {" "}
                    · {line.packageName}
                  </span>
                ) : null}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                ×{line.quantity}
              </span>
              <span className="text-right tabular-nums text-ink-muted">
                {MONEY.format(line.rate)}
                <span className="text-ink-faint">
                  {line.isOneTime ? " once" : ` /${line.pricingType.toLowerCase()}`}
                </span>
              </span>
              <span className="text-right font-bold tabular-nums">
                {MONEY.format(line.subtotal)}
              </span>
            </div>

            {line.units.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-px">
                {line.units.map((unit) => {
                  const state = unitState(unit);
                  return (
                    <li
                      key={unit.id}
                      className="grid grid-cols-[104px_1fr_112px_84px] items-center gap-2 rounded-row px-2 py-[5px] text-detail hover:bg-row-hover"
                    >
                      <span className="truncate font-bold">{unit.barcode}</span>
                      <span className="truncate text-ink-muted">
                        {unit.serialNumber ?? "No serial recorded"}
                      </span>
                      <span className="truncate text-ink-faint">
                        {unit.locationName ?? "Location unknown"}
                      </span>
                      <span className={TONE_CLASS[state.tone]}>
                        {state.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {line.countedOut !== line.attachedOut ? (
              // Imported custody orders set the line counters without ever
              // creating the junction rows, so the two disagree. Say which is
              // which instead of quietly trusting one: only the attached units
              // can actually be checked back in.
              <p className="mt-1 rounded-row bg-accent-tint px-2 py-1 text-detail text-accent-on-tint">
                This line counts {line.countedOut} out, but only{" "}
                {line.attachedOut} {line.attachedOut === 1 ? "unit is" : "units are"}{" "}
                attached to it. Scan the missing{" "}
                {line.countedOut - line.attachedOut} to make the count real —
                until then they can&rsquo;t be checked back in.
              </p>
            ) : line.unassigned > 0 ? (
              <p className="mt-1 px-2 text-detail text-ink-muted">
                {line.unassigned} of {line.quantity} still to assign — scan a
                unit against this line to attach it.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function BillingCard({ id }: { id: string }) {
  const invoices = await getReservationInvoices(id);
  const billed = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const paid = invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0);

  return (
    <Card
      title="Billing"
      meta={
        invoices.length === 0
          ? undefined
          : `${MONEY.format(paid)} of ${MONEY.format(billed)} paid`
      }
    >
      {invoices.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          Nothing invoiced against this order yet. Invoices raised from it appear
          here.
        </p>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/dashboard/invoices/${invoice.id}`}
                className="grid grid-cols-[1fr_84px_90px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold">
                  {invoice.invoiceNumber}
                </span>
                <span className="truncate text-ink-muted">
                  {invoice.status.toLowerCase()}
                </span>
                <span className="text-right tabular-nums">
                  {MONEY.format(invoice.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function ActivityCard({ id }: { id: string }) {
  const entries = await getReservationActivity(id);

  return (
    <Card title="Activity">
      {entries.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          No state changes recorded. Approving, preparing or shipping this order
          will log here.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="flex items-baseline gap-2">
                <span className="truncate">{entry.what}</span>
                <span className="ml-auto flex-none text-ink-faint">
                  {STAMP.format(entry.at)}
                </span>
              </span>
              {entry.who || entry.notes ? (
                <span className="block truncate text-ink-faint">
                  {[entry.who, entry.notes].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CardSkeleton({ title, rows = 6 }: { title: string; rows?: number }) {
  return (
    <section className="flex min-h-0 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="px-4 pb-3">
        <h2 className="text-card-title text-ink-muted">{title}</h2>
      </div>
      <div className="flex flex-col gap-[2px] px-2 pb-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}
