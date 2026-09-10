import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import {
  IncomingCard,
  OutgoingCard,
  QueueCardSkeleton,
} from "@/components/today/movement-cards";
import { getCalendarMonth, type CalendarDay } from "@/lib/queries/operate";
import { getTodayStats } from "@/lib/queries/today";

export const metadata = { title: "Calendar" };

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isToday(date: Date, today: Date) {
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function DayCell({ day, today }: { day: CalendarDay; today: Date }) {
  const movements = day.going.length + day.coming.length;

  return (
    <div
      className={`flex min-h-[92px] flex-col gap-1 rounded-row p-2 ${
        day.inMonth ? "bg-row-alt" : "opacity-40"
      }`}
    >
      <span
        className={`text-detail tabular-nums ${
          isToday(day.date, today)
            ? "font-bold text-accent-text"
            : "text-ink-muted"
        }`}
      >
        {day.date.getDate()}
      </span>

      {movements === 0 ? null : (
        <ul className="flex flex-col gap-[2px]">
          {day.going.slice(0, 2).map((order) => (
            <li key={`out-${order.id}`}>
              <Link
                href={`/dashboard/orders/${order.id}`}
                title={`Out: ${order.reservationNumber} · ${order.clientName}`}
                className="block truncate rounded-[4px] bg-accent-tint px-1 text-micro text-accent-on-tint hover:underline"
              >
                ↗ {order.clientName}
              </Link>
            </li>
          ))}
          {day.coming.slice(0, 2).map((order) => (
            <li key={`in-${order.id}`}>
              <Link
                href={`/dashboard/orders/${order.id}`}
                title={`Back: ${order.reservationNumber} · ${order.clientName}`}
                className="block truncate rounded-[4px] bg-sunken px-1 text-micro text-ink-muted hover:underline"
              >
                ↘ {order.clientName}
              </Link>
            </li>
          ))}
          {movements > 4 ? (
            <li className="px-1 text-micro text-ink-faint">
              +{movements - 4} more
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

async function Month({ year, month }: { year: number; month: number }) {
  const { days, monthStart } = await getCalendarMonth(year, month);
  const today = new Date();

  const going = days.reduce((sum, day) => sum + (day.inMonth ? day.going.length : 0), 0);
  const coming = days.reduce((sum, day) => sum + (day.inMonth ? day.coming.length : 0), 0);

  const previous = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const href = (date: Date) =>
    `/dashboard/calendar?y=${date.getFullYear()}&m=${date.getMonth() + 1}`;

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel p-[14px] shadow-sm">
      <header className="flex items-center gap-3 px-2 pb-3">
        <h2 className="text-card-title">{MONTH_LABEL.format(monthStart)}</h2>
        <span className="text-detail text-ink-muted">
          {going} out · {coming} back
        </span>
        <span className="ml-auto flex items-center gap-2 text-detail">
          <Link href={href(previous)} className="text-accent-text hover:underline">
            ← {MONTH_LABEL.format(previous).split(" ")[0]}
          </Link>
          <Link href="/dashboard/calendar" className="text-ink-muted hover:underline">
            Today
          </Link>
          <Link href={href(next)} className="text-accent-text hover:underline">
            {MONTH_LABEL.format(next).split(" ")[0]} →
          </Link>
        </span>
      </header>

      <div className="grid grid-cols-7 gap-1 px-2 pb-1 text-colhead uppercase text-ink-muted">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 gap-1 overflow-y-auto px-2">
        {days.map((day) => (
          <DayCell key={day.date.toISOString()} day={day} today={today} />
        ))}
      </div>
    </section>
  );
}

function MonthSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-card bg-panel p-[14px] shadow-sm">
      <div className="grid flex-1 grid-cols-7 gap-1 px-2 pt-8">
        {Array.from({ length: 35 }, (_, index) => (
          <div
            key={index}
            className="min-h-[92px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}

async function HeaderBlurb() {
  const { toPull, toReceive } = await getTodayStats();

  if (toPull === 0 && toReceive === 0) {
    return <>Nothing waiting in either direction</>;
  }

  return (
    <>
      {toPull} {toPull === 1 ? "unit" : "units"} to pull ·{" "}
      {toReceive} {toReceive === 1 ? "unit" : "units"} to receive
    </>
  );
}

/**
 * Operate → Calendar: when things move, and what needs hands about it now.
 *
 * Today's movements was its own screen until 2026-09-09 and was folded in here
 * on the owner's call — the two answered the same question at two zoom levels
 * and neither was complete alone. The month grid says a return is due Friday;
 * the queues below say that six units of it are already late and nobody has
 * pulled them. Reading one without the other was the redundancy.
 *
 * The queue cards are reused exactly as they were, not reimplemented. They take
 * no arguments, each fetches its own side, and each keeps its own Suspense
 * boundary so a slow return query never holds up the pull list — or the grid.
 *
 * Recurring orders appear on the day they start but never on the day they
 * "end": their `endDate` is a billing-period boundary, not a return date.
 * Treating it as a return is the mistake that read 214 units overdue instead of
 * 35 when the Overview first shipped, and a calendar full of returns that
 * aren't returns is worse than no calendar.
 *
 * Two per direction per day in the grid, then a count — a cell that lists
 * fifteen orders stops being glanceable, and the day's real work is on the
 * order anyway.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.y) || now.getFullYear();
  // Months are 1-indexed in the URL and 0-indexed in Date.
  const month = params.m ? Number(params.m) - 1 : now.getMonth();
  const safeMonth = Number.isInteger(month) && month >= 0 && month <= 11 ? month : now.getMonth();

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Calendar"
        blurb={
          <Suspense fallback="Counting what needs hands…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <Link
            href="/dashboard/orders"
            className="rounded-pill bg-sunken px-[14px] py-2 text-pill text-ink transition-colors hover:bg-row-hover"
          >
            All orders
          </Link>
        }
      />

      <Suspense key={`${year}-${safeMonth}`} fallback={<MonthSkeleton />}>
        <Month year={year} month={safeMonth} />
      </Suspense>

      {/* The grid says when; these say what is late and what is waiting. Every
          row opens its order — this is still not a scanner, for the reason
          Today's movements gave: check-out and check-in happen on the order,
          where the lines, the units and the sign-off already are. */}
      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <Suspense fallback={<QueueCardSkeleton title="Going out" />}>
          <OutgoingCard />
        </Suspense>
        <Suspense fallback={<QueueCardSkeleton title="Coming back" />}>
          <IncomingCard />
        </Suspense>
      </div>
    </>
  );
}
