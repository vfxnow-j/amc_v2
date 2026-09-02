import Link from "next/link";
import { Card, CardSkeleton } from "@/components/record/record-card";
import { RemoveLine } from "@/components/orders/remove-line";
import { AddLine } from "@/components/orders/add-line";
import { LineEditor } from "@/components/orders/line-editor";
import {
  getReservationActivity,
  getReservationLines,
  type RecordUnit,
} from "@/lib/queries/reservation-record";

// Re-exported so the order record's existing imports keep working; the chrome
// itself now lives in components/record and is shared with every other record.
export { Card, CardSkeleton };

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
export async function LinesCard({
  id,
  editable = false,
  window,
}: {
  id: string;
  /** Whether lines can still be changed — false once the order is closed. */
  editable?: boolean;
  /** The order's dates, so added lines are checked against the right window. */
  window?: { start: string; end: string };
}) {
  const lines = await getReservationLines(id);
  const unitCount = lines.reduce((sum, line) => sum + line.units.length, 0);

  if (lines.length === 0) {
    return (
      <Card title="Lines">
        <p className="px-4 pb-3 text-body text-ink-muted">
          Nothing has been added to this order yet — add a line to price it, or
          scan a unit to add one as you pull it.
        </p>
        {editable && window ? (
          <AddLine reservationId={id} start={window.start} end={window.end} />
        ) : null}
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
            <div
              className={`grid items-baseline gap-2 px-1 ${
                editable
                  ? "grid-cols-[1fr_58px_96px_96px_20px]"
                  : "grid-cols-[1fr_58px_96px_96px]"
              }`}
            >
              <span className="truncate font-bold">
                {line.label}
                {line.packageName && line.packageName !== "Default" ? (
                  <span className="font-normal text-ink-faint">
                    {" "}
                    · {line.packageName}
                  </span>
                ) : null}
              </span>
              {editable ? (
                <LineEditor
                  reservationId={id}
                  itemId={line.id}
                  quantity={line.quantity}
                  rate={line.rate}
                  pricingType={line.pricingType}
                  isOneTime={line.isOneTime}
                />
              ) : (
                <>
                  <span className="text-right tabular-nums text-ink-muted">
                    ×{line.quantity}
                  </span>
                  <span className="text-right tabular-nums text-ink-muted">
                    {MONEY.format(line.rate)}
                    <span className="text-ink-faint">
                      {line.isOneTime
                        ? " once"
                        : ` /${line.pricingType.toLowerCase()}`}
                    </span>
                  </span>
                </>
              )}
              <span className="text-right font-bold tabular-nums">
                {MONEY.format(line.subtotal)}
              </span>
              {editable ? (
                <RemoveLine
                  reservationId={id}
                  itemId={line.id}
                  label={line.label}
                  unitsOut={Math.max(0, line.attachedOut)}
                />
              ) : null}
            </div>

            {/* What the SKU is configured with. An included part is the base
                spec — shown so the machine reads as what it is, charged
                nothing. Anything else carries its own rate on top, and the
                configured total is what the client is actually quoted. */}
            {line.components.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-px">
                {line.components.map((part) => (
                  <li
                    key={part.id}
                    className="grid grid-cols-[1fr_58px_96px_96px] items-baseline gap-2 rounded-row px-2 py-[5px] text-detail hover:bg-row-hover"
                  >
                    <span className="truncate text-ink-muted">
                      <span className="text-ink-faint">↳ </span>
                      {part.label}
                    </span>
                    <span className="text-right tabular-nums text-ink-faint">
                      ×{part.quantity}
                    </span>
                    <span className="text-right tabular-nums text-ink-faint">
                      {part.includedInParent
                        ? "included"
                        : `${MONEY.format(part.rate)}${part.isOneTime ? " once" : ` /${part.pricingType.toLowerCase()}`}`}
                    </span>
                    <span className="text-right tabular-nums text-ink-muted">
                      {part.includedInParent ? "—" : MONEY.format(part.subtotal)}
                    </span>
                  </li>
                ))}
                {line.components.some((part) => !part.includedInParent) ? (
                  <li className="grid grid-cols-[1fr_58px_96px_96px] items-baseline gap-2 px-2 pt-[3px] text-detail">
                    <span className="col-span-3 text-right text-ink-muted">
                      Configured
                    </span>
                    <span className="text-right font-bold tabular-nums">
                      {MONEY.format(
                        line.subtotal +
                          line.components.reduce(
                            (sum, part) => sum + part.subtotal,
                            0,
                          ),
                      )}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : null}

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
              <p className="mt-1 rounded-row bg-sunken px-2 py-1 text-detail text-ink-muted">
                {line.quantity === line.units.length * 2 &&
                line.countedOut === line.attachedOut * 2
                  ? `Ordered quantity and counters are both exactly double the ${line.units.length} units attached — this line was imported twice. The units are here; the quantity is what needs correcting.`
                  : `The line counter says ${line.countedOut} out, the attached units say ${line.attachedOut}. The units are the physical record; the counter is derived and has drifted.`}
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
      {editable && window ? (
        <AddLine reservationId={id} start={window.start} end={window.end} />
      ) : null}
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

