import Link from "next/link";
import type { ReservationStatus } from "@/generated/prisma/client";
import { getIncoming, getOutgoing } from "@/lib/queries/today";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Order · Client · Units · When */
const COLUMNS = "grid-cols-[112px_1fr_44px_78px]";

const STATUS_LABEL: Partial<Record<ReservationStatus, string>> = {
  APPROVED: "Approved",
  PREPARING: "Preparing",
  SHIPPED: "Shipped",
};

function lateness(daysLate: number, fallback: string) {
  if (daysLate === 0) return fallback;
  return daysLate === 1 ? "1d late" : `${daysLate}d late`;
}

function QueueCard({
  title,
  pill,
  children,
  footer,
}: {
  title: string;
  pill?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">{title}</h2>
        {pill ? (
          <span className="rounded-pill bg-accent-tint-strong px-2 py-px text-pill text-accent-on-tint">
            {pill}
          </span>
        ) : null}
      </header>
      {children}
      {footer ? (
        <p className="px-4 py-3 text-detail text-ink-muted">{footer}</p>
      ) : null}
    </section>
  );
}

function ColumnHeads({ units, when }: { units: string; when: string }) {
  return (
    <div
      className={`grid ${COLUMNS} gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
    >
      <span>Order</span>
      <span>Client</span>
      <span className="text-right">{units}</span>
      <span>{when}</span>
    </div>
  );
}

function Row({
  href,
  order,
  client,
  project,
  units,
  when,
  late,
  zebra,
}: {
  href: string;
  order: string;
  client: string;
  project: string | null;
  units: number;
  when: string;
  late: boolean;
  zebra: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`grid ${COLUMNS} items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${
          late ? "bg-accent-tint" : zebra ? "bg-row-alt" : ""
        } hover:bg-row-hover`}
      >
        <span className="truncate font-bold">{order}</span>
        <span className="truncate">
          {client}
          {project ? (
            <span className="text-ink-faint"> · {project}</span>
          ) : null}
        </span>
        <span className="text-right tabular-nums">{units}</span>
        <span className={late ? "font-bold text-accent-text" : "text-ink-muted"}>
          {when}
        </span>
      </Link>
    </li>
  );
}

/**
 * Orders that should be out of the door. Rows open the order, which is where
 * units get scanned out — this card only says which ones need hands.
 */
export async function OutgoingCard() {
  const now = new Date();
  const { rows, total, late, upcoming, units } = await getOutgoing(now);

  return (
    <QueueCard
      title="Going out"
      pill={late > 0 ? `${late} past its ship date` : undefined}
      footer={
        rows.length === 0
          ? undefined
          : [
              rows.length === total
                ? `All ${total} shown · ${units} units to pull`
                : `${rows.length} of ${total} shown · scroll for the rest`,
              upcoming > 0
                ? `${upcoming} more ${upcoming === 1 ? "order starts" : "orders start"} later`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          Nothing is waiting to go out.{" "}
          {upcoming > 0 ? (
            <>
              {upcoming === 1
                ? "One order starts later"
                : `${upcoming} orders start later`}{" "}
              — open{" "}
              <Link
                href="/dashboard/orders"
                className="text-accent-text hover:underline"
              >
                Reservations
              </Link>{" "}
              to prep one early.
            </>
          ) : (
            "Every approved order has had its units pulled."
          )}
        </p>
      ) : (
        <>
          <ColumnHeads units="Pull" when="Ship by" />
          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
            {rows.map((row, index) => (
              <Row
                key={row.reservationId}
                href={`/dashboard/orders/${row.reservationId}`}
                order={row.reservationNumber}
                client={row.clientName}
                project={row.projectName}
                units={row.units}
                when={lateness(
                  row.daysLate,
                  STATUS_LABEL[row.status] ?? "Today",
                )}
                late={row.daysLate > 0}
                zebra={index % 2 === 1}
              />
            ))}
          </ul>
        </>
      )}
    </QueueCard>
  );
}

/** Orders with units still out and their return date reached or passed. */
export async function IncomingCard() {
  const now = new Date();
  const { rows, total, units, lateUnits } = await getIncoming(now);

  return (
    <QueueCard
      title="Coming back"
      pill={lateUnits > 0 ? `${lateUnits} units late` : undefined}
      footer={
        rows.length === 0
          ? undefined
          : [
              rows.length === total
                ? `All ${total} shown · ${units} units to receive`
                : `${rows.length} of ${total} shown · scroll for the rest`,
              // Said out loud because it is the difference between 35 and 213.
              "Recurring orders excluded — their end date is a billing date",
            ].join(" · ")
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          Nothing is due back — every unit on rent is still inside its window.
          Check again when the next order ends.
        </p>
      ) : (
        <>
          <ColumnHeads units="Out" when="Due" />
          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
            {rows.map((row, index) => (
              <Row
                key={row.reservationId}
                href={`/dashboard/orders/${row.reservationId}`}
                order={row.reservationNumber}
                client={row.clientName}
                project={row.projectName}
                units={row.units}
                when={lateness(row.daysLate, DAY.format(row.due))}
                late={row.daysLate > 0}
                zebra={index % 2 === 1}
              />
            ))}
          </ul>
        </>
      )}
    </QueueCard>
  );
}

export function QueueCardSkeleton({ title }: { title: string }) {
  return (
    <section className="flex min-h-0 flex-col rounded-card bg-panel pt-[14px] shadow-sm">
      <div className="px-4 pb-3">
        <h2 className="text-card-title text-ink-muted">{title}</h2>
      </div>
      <div className="flex flex-col gap-[2px] px-2">
        {Array.from({ length: 8 }, (_, index) => (
          // 30px is the real row height — the queue must not reflow.
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}
