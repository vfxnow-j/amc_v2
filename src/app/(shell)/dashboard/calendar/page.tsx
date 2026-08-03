import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { getCalendarMonth, type CalendarDay } from "@/lib/queries/operate";

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
                href={`/dashboard/reservations/${order.id}`}
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
                href={`/dashboard/reservations/${order.id}`}
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

/**
 * Operate → Calendar: the month view of what leaves and what comes back.
 *
 * Recurring orders appear on the day they start but never on the day they
 * "end": their `endDate` is a billing-period boundary, not a return date.
 * Treating it as a return is the mistake that read 214 units overdue instead of
 * 35 when the Overview first shipped, and a calendar full of returns that
 * aren't returns is worse than no calendar.
 *
 * Two per direction per day, then a count — a cell that lists fifteen orders
 * stops being glanceable, and the day's real work is on the order anyway.
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
        blurb="What goes out and what comes back, by day"
      />

      <Suspense key={`${year}-${safeMonth}`} fallback={<MonthSkeleton />}>
        <Month year={year} month={safeMonth} />
      </Suspense>
    </>
  );
}
