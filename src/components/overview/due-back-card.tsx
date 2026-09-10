import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import { getDueBack } from "@/lib/queries/overview";

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Unit · Asset · Client · Due · State */
const COLUMNS = "grid-cols-[84px_1fr_128px_62px_74px]";

function daysLate(due: Date, now: Date) {
  const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  return days < 1 ? "Due today" : `${days}d late`;
}

export async function DueBackCard() {
  const now = new Date();
  const { rows, total, late } = await getDueBack(now);

  return (
    <Tile pad="flush" className="flex min-h-0 flex-col overflow-hidden">
      <TileHeader
        className="mb-0 items-center px-4 pb-3"
        title="Due back & overdue"
        badge={
          late > 0 ? (
            <span className="rounded-pill bg-accent-tint-strong px-2 py-px text-pill text-accent-on-tint">
              {late} late
            </span>
          ) : null
        }
        href="/dashboard/today"
        hrefLabel="Today’s movements →"
      />

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-body text-ink-muted">
          Nothing is due back — every unit on rent is inside its window. Check
          the desk when the next order ships.
        </p>
      ) : (
        <>
          <div
            className={`grid ${COLUMNS} gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
          >
            <span>Unit</span>
            <span>Asset</span>
            <span>Client</span>
            <span>Due</span>
            <span>State</span>
          </div>

          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
            {rows.map((row, index) => (
              <li key={row.id}>
                <Link
                  href={`/dashboard/orders/${row.reservationId}`}
                  className={`grid ${COLUMNS} items-center gap-2 rounded-row p-2 transition-colors duration-[160ms] ${
                    row.isLate
                      ? "bg-accent-tint"
                      : index % 2 === 1
                        ? "bg-row-alt"
                        : ""
                  } hover:bg-row-hover`}
                >
                  <span className="truncate font-bold">{row.unitLabel}</span>
                  <span className="truncate">{row.assetName}</span>
                  <span className="truncate text-ink-muted">
                    {row.clientName}
                  </span>
                  <span className="text-ink-muted">
                    {row.isLate ? DAY.format(row.due) : TIME.format(row.due)}
                  </span>
                  <span
                    className={
                      row.isLate ? "font-bold text-accent-text" : "text-ink-muted"
                    }
                  >
                    {daysLate(row.due, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="px-4 py-3 text-detail text-ink-muted">
            {rows.length === total
              ? `All ${total} shown`
              : `${rows.length} of ${total} shown · scroll for the rest`}
          </p>
        </>
      )}
    </Tile>
  );
}

export function DueBackCardSkeleton() {
  return (
    <Tile pad="flush" className="flex min-h-0 flex-col">
      <div className="px-4 pb-3">
        <div className="h-4 w-40 animate-pulse rounded-row bg-sunken" />
      </div>
      <div className="flex flex-col gap-[2px] px-2">
        {Array.from({ length: 8 }, (_, index) => (
          // 30px is the real row height — the table must not reflow.
          <div
            key={index}
            className="h-[30px] animate-pulse rounded-row bg-row-alt"
          />
        ))}
      </div>
    </Tile>
  );
}
