import { Tile, TileHeader } from "@/components/dashboard/tile";
import { Empty, Excludes } from "@/components/dashboard/tiles/parts";
import { getCalendarMonth, type CalendarDay } from "@/lib/queries/operate";
import { CalendarEntry, dayEntries } from "@/components/calendar-entry";

/**
 * This week, in and out — the Calendar's month grid at one week's zoom.
 *
 * **Built on `getCalendarMonth`, and deliberately not on `lib/actions/calendar.ts`.**
 * That module is still in the tree and is not to be revived here: it emits raw
 * hex per status, which walks straight through the token layer and would render
 * the same colour in all six themes; it does an unbounded `include` over every
 * reservation in the range; and it treats every `endDate` as a return, which is
 * the recurring-order mistake that once reported 214 units overdue against a
 * real 35. `getCalendarMonth` already excludes recurring orders from the
 * "coming back" side for exactly that reason, and gets its colours from the
 * accent tokens like everything else.
 *
 * **The week is sliced out of the month grid rather than queried separately,
 * and that is what keeps this tile and the Calendar screen honest.** The grid
 * runs Sunday-to-Saturday around the month, so the week containing today is
 * always wholly inside it — one query, one set of buckets, and the strip cannot
 * disagree with the screen it links to about which day an order moves.
 *
 * **A seam worth knowing about, and not silently resolved here.**
 * `getCalendarMonth` buckets on local calendar components (`getDate()`), while
 * `lib/pricing/periods.ts` does all of its term arithmetic on UTC components
 * and its header states it "runs on a UTC server" — which this box is not; it
 * runs in America/Los_Angeles. An order stored at UTC midnight therefore falls
 * on the previous day here: 35 of 149 orders start at exactly 00:00Z and 30 end
 * there, so the Calendar places them one day early. Picking a side is a change
 * to `getCalendarMonth` that moves the Calendar screen too, so this tile
 * deliberately inherits that module's convention rather than choosing a second
 * one — two calendars a day apart would be worse than one that is a day out.
 */
export async function CalendarStripTile() {
  const now = new Date();
  const { days } = await getCalendarMonth(now.getFullYear(), now.getMonth());

  const todayIndex = days.findIndex((day) => isSameDay(day.date, now));
  // The grid is Sunday-aligned, so the week is a whole row of it. Guarded
  // anyway: a month grid that somehow did not contain today should render the
  // first week rather than throw on a dashboard.
  const weekStart = todayIndex < 0 ? 0 : Math.floor(todayIndex / 7) * 7;
  const week = days.slice(weekStart, weekStart + 7);

  const going = week.reduce((sum, day) => sum + day.going.length, 0);
  const coming = week.reduce((sum, day) => sum + day.coming.length, 0);
  const expiring = week.reduce((sum, day) => sum + day.expiring.length, 0);
  const shipping = week.reduce((sum, day) => sum + day.shipping.length, 0);

  const laterInMonth = days
    .slice(weekStart + 7)
    .reduce(
      (sum, day) =>
        sum + (day.inMonth ? day.going.length + day.coming.length : 0),
      0,
    );

  return (
    <Tile className="flex min-h-0 flex-col">
      <TileHeader
        title="This week"
        meta={
          shipping + going + coming + expiring === 0
            ? "nothing moves"
            : `${shipping > 0 ? `${shipping} to ship · ` : ""}${going} out · ${coming} back${
                expiring > 0 ? ` · ${expiring} expiring` : ""
              }`
        }
        href="/dashboard/calendar"
        hrefLabel="Calendar →"
      />

      {shipping + going + coming + expiring === 0 ? (
        <Empty>
          Nothing goes out or comes back this week. Orders appear here on the day
          they start and the day they are due back — the Calendar shows the
          whole month.
        </Empty>
      ) : (
        <div className="grid min-h-0 grid-cols-7 gap-1">
          {week.map((day) => (
            <DayColumn key={day.date.toISOString()} day={day} now={now} />
          ))}
        </div>
      )}

      <Excludes>
        Recurring orders appear on the day they start and never on the day they
        &ldquo;end&rdquo; — that date is a billing-period boundary, not a return.
        {laterInMonth > 0
          ? ` ${laterInMonth} more ${
              laterInMonth === 1 ? "movement" : "movements"
            } fall later this month.`
          : ""}
      </Excludes>
    </Tile>
  );
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * One day. Two orders per kind, then a count — a column that listed
 * fifteen stops being glanceable, and the day's real work is on the order.
 */
function DayColumn({ day, now }: { day: CalendarDay; now: Date }) {
  const today = isSameDay(day.date, now);
  const { shown, hidden } = dayEntries(day);

  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-row p-2 ${
        day.inMonth ? "bg-row-alt" : "bg-row-alt opacity-60"
      }`}
    >
      <span
        className={`text-detail tabular-nums ${
          today ? "font-bold text-accent-text" : "text-ink-muted"
        }`}
      >
        {WEEKDAY.format(day.date)} {day.date.getDate()}
      </span>
      {day.holiday ? (
        <span className="-mt-1 truncate text-micro text-ink-faint" title={day.holiday.name}>
          {day.holiday.name}
          {day.holiday.carrierClosed ? " · no shipping" : ""}
        </span>
      ) : null}

      {shown.map(({ order, kind }) => (
        <CalendarEntry key={`${kind}-${order.id}`} order={order} kind={kind} />
      ))}

      {hidden > 0 ? (
        <span className="px-1 text-micro text-ink-faint">+{hidden}</span>
      ) : null}
    </div>
  );
}
