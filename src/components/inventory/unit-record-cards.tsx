import Link from "next/link";
import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { Figure } from "@/components/inventory/record-cards";
import { dayYear, money } from "@/lib/format";
import {
  getUnitCoverage,
  getUnitMovements,
  getUnitOwnership,
  getUnitService,
  getUnitTransfers,
} from "@/lib/queries/unit-record";
import { WORK_ORDER_LABEL } from "@/lib/queries/service";

/**
 * The cards the unit record is built from.
 *
 * A unit is the only thing in Inventory somebody can physically hold, so these
 * are ordered around the questions asked while holding one: where has it been,
 * what has been done to it, who pays if it breaks, and what is it worth.
 */

const CHECKOUT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Out",
  RETURNED: "Returned",
  OVERDUE: "Overdue",
  CANCELLED: "Canceled",
};

const CONDITION_LABEL: Record<string, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  FAIR: "Fair",
  DAMAGED: "Damaged",
};

const COVERAGE_LABEL: Record<string, string> = {
  LICENSE: "License",
  SUPPORT_CONTRACT: "Support contract",
  EXTENDED_WARRANTY: "Extended warranty",
  SERVICE_PLAN: "Service plan",
  SUBSCRIPTION: "Subscription",
};

const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  PREVENTIVE: "Preventive",
  CORRECTIVE: "Corrective",
  DAMAGE_REPAIR: "Damage repair",
  INSPECTION: "Inspection",
  CALIBRATION: "Calibration",
};

const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Done",
  CANCELLED: "Canceled",
};

/**
 * Every time this unit has gone out.
 *
 * The row shows out and back as two dates rather than a duration, because the
 * gap between "due" and "back" is the fact worth reading and a duration would
 * hide it. A canceled booking is shown grayed rather than dropped — it is a
 * thing that happened to this unit, and hiding it would make this log disagree
 * with the order that still holds the row.
 */
export async function MovementsCard({ id }: { id: string }) {
  const { rows, total } = await getUnitMovements(id);

  if (total === 0) {
    return (
      <Card title="Movements">
        <CardEmpty>
          This unit has never been checked out. Movements are written when it is
          scanned out on an order — until then its whole history is the day it
          was registered.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Movements"
      meta={
        total > rows.length
          ? `${rows.length} of ${total} shown`
          : `all ${total} shown`
      }
      className="min-h-0"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_96px_78px_78px_84px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Client</span>
        <span>Order</span>
        <span>Out</span>
        <span>Back</span>
        <span>State</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {rows.map((row) => {
          const cells = (
            <>
              <span className="truncate">{row.clientName}</span>
              <span className="truncate tabular-nums text-ink-muted">
                {row.orderNumber ?? <Unset>No order</Unset>}
              </span>
              <span className="tabular-nums text-ink-muted">
                {dayYear(row.out)}
              </span>
              <span className="tabular-nums text-ink-muted">
                {row.back ? dayYear(row.back) : <Unset>Still out</Unset>}
              </span>
              <span className="truncate">
                {row.damaged ? (
                  <span className="font-bold text-destructive">Damaged</span>
                ) : row.condition ? (
                  <span className="text-ink-muted">
                    {CONDITION_LABEL[row.condition] ?? row.condition}
                  </span>
                ) : (
                  <span
                    className={
                      row.status === "CANCELLED"
                        ? "text-ink-faint"
                        : "text-ink-muted"
                    }
                  >
                    {CHECKOUT_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                )}
              </span>
            </>
          );

          const className =
            "grid grid-cols-[minmax(0,1fr)_96px_78px_78px_84px] items-center gap-2 rounded-row px-2 py-[6px] text-detail";

          return (
            <li key={row.id}>
              {row.orderId ? (
                <Link
                  href={`/dashboard/orders/${row.orderId}`}
                  className={`${className} hover:bg-row-hover`}
                >
                  {cells}
                </Link>
              ) : (
                <div className={className}>{cells}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Work orders and maintenance records as one history.
 *
 * A closing work order writes a maintenance record, so these two models overlap
 * on purpose. Splitting them into two cards would show one repair twice and read
 * as two jobs.
 */
export async function ServiceHistoryCard({ id }: { id: string }) {
  const { workOrders, maintenance } = await getUnitService(id);
  const count = workOrders.length + maintenance.length;

  if (count === 0) {
    return (
      <Card title="Service history">
        <CardEmpty>
          Nothing has been done to this unit. Raise a work order from the order
          it came back on, and the repair and its QC runs land here.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card title="Service history" meta={`${count} on record`}>
      <ul className="flex flex-col gap-px px-2 pb-3">
        {workOrders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/dashboard/service/work-orders/${order.id}`}
              className="grid grid-cols-[92px_minmax(0,1fr)_96px_78px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="truncate font-bold tabular-nums">
                {order.number}
              </span>
              <span className="truncate">{order.fault}</span>
              <span className="truncate text-ink-muted">
                {WORK_ORDER_LABEL[order.status] ?? order.status}
              </span>
              <span className="text-right tabular-nums text-ink-faint">
                {dayYear(order.closedAt ?? order.openedAt)}
              </span>
            </Link>
          </li>
        ))}
        {maintenance.map((record) => (
          <li
            key={record.id}
            className="grid grid-cols-[92px_minmax(0,1fr)_96px_78px] items-center gap-2 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="truncate text-ink-muted">
              {MAINTENANCE_TYPE_LABEL[record.type] ?? record.type}
            </span>
            <span className="truncate">{record.description}</span>
            <span className="truncate text-ink-muted">
              {MAINTENANCE_STATUS_LABEL[record.status] ?? record.status}
              {record.totalCost ? ` · ${money(record.totalCost)}` : ""}
            </span>
            <span className="text-right tabular-nums text-ink-faint">
              {dayYear(record.at)}
            </span>
          </li>
        ))}
      </ul>
      {maintenance.length > 0 && workOrders.length === 0 ? (
        <p className="px-4 pb-3 text-detail text-ink-muted">
          {/* Worth saying, because the Service center queue will look empty for
              this unit while this card is full. */}
          All from the maintenance log, which pre-dates the Service center — no
          work order has been raised against this unit.
        </p>
      ) : null}
    </Card>
  );
}

/** Warranty and service contracts: if this breaks, who pays. */
export async function CoverageCard({ id }: { id: string }) {
  const coverage = await getUnitCoverage(id);
  const live = coverage.coverages.filter((row) => row.live).length;

  if (coverage.coverages.length === 0 && !coverage.warrantyExpiry) {
    return (
      <Card title="Coverage">
        <CardEmpty>
          No warranty date and no service contract on this unit. If it fails,
          nothing on the record says the repair is anyone else&rsquo;s to pay
          for — add the warranty expiry from the purchase order.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Coverage"
      meta={
        coverage.coverages.length === 0
          ? undefined
          : `${live} of ${coverage.coverages.length} live`
      }
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Warranty">
          {coverage.warrantyExpiry ? (
            <span
              className={coverage.warrantyLive ? "" : "text-ink-muted"}
            >
              {coverage.warrantyLive ? "Until " : "Expired "}
              {dayYear(coverage.warrantyExpiry)}
            </span>
          ) : (
            <Unset>None on file</Unset>
          )}
        </Field>
        <Field label="Bought from">
          {coverage.vendor ? (
            <Link
              href={`/dashboard/vendors/${coverage.vendor.id}`}
              className="text-accent-text hover:underline"
            >
              {coverage.vendor.name}
            </Link>
          ) : (
            <Unset>Unrecorded</Unset>
          )}
        </Field>
      </div>
      {coverage.coverages.length > 0 ? (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {coverage.coverages.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_112px_84px] items-center gap-2 rounded-row px-2 py-[6px] text-detail"
            >
              <span className="truncate">
                <span className="font-bold">{row.name}</span>
                {row.provider ? (
                  <span className="text-ink-faint"> · {row.provider}</span>
                ) : null}
              </span>
              <span className="truncate text-ink-muted">
                {COVERAGE_LABEL[row.type] ?? row.type}
              </span>
              <span
                className={`text-right tabular-nums ${row.live ? "text-ink-muted" : "text-ink-faint"}`}
              >
                {row.live ? "to " : "ended "}
                {dayYear(row.endDate)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * Where it sits, and every move that put it there.
 *
 * `AssetTransfer` has no status column — a row is a move that already happened,
 * not one waiting for approval — so this is a log and is labeled one, the same
 * as the Locations screen.
 */
export async function TransfersCard({
  id,
  location,
}: {
  id: string;
  location: { id: string; name: string } | null;
}) {
  const { rows, total } = await getUnitTransfers(id);

  return (
    <Card
      title="Location & transfers"
      meta={total > 0 ? `${total} ${total === 1 ? "move" : "moves"}` : undefined}
    >
      <div className="px-4 pb-3">
        <Field label="Sits at">
          {location ? (
            <Link
              href={`/dashboard/locations/${location.id}`}
              className="text-accent-text hover:underline"
            >
              {location.name}
            </Link>
          ) : (
            <Unset>No location set</Unset>
          )}
        </Field>
      </div>
      {total === 0 ? (
        <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
          {location
            ? "This unit has never been moved between locations. A transfer is recorded when it physically moves; it is not an approval step."
            : "This unit has no location and has never been transferred, so nothing on the record says where it lives when it is not with a client."}
        </p>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-row px-2 py-[6px] text-detail"
            >
              <span className="tabular-nums text-ink-muted">
                {dayYear(row.transferDate)}
              </span>
              <span className="truncate text-ink-muted">
                <Link
                  href={`/dashboard/locations/${row.fromLocation.id}`}
                  className="hover:underline"
                >
                  {row.fromLocation.name}
                </Link>
              </span>
              <span className="truncate">
                →{" "}
                <Link
                  href={`/dashboard/locations/${row.toLocation.id}`}
                  className="text-accent-text hover:underline"
                >
                  {row.toLocation.name}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * What was paid, how it was funded, and what it is worth now.
 *
 * The lease block only appears when the unit is actually on one. `loanAmount`
 * is the whole facility, not this unit's share — 765 units sit under 20 leases
 * — so it is labeled as the lease's amount rather than as this unit's debt,
 * which is a number nothing in the schema holds.
 */
export async function OwnershipCard({ id }: { id: string }) {
  const own = await getUnitOwnership(id);
  if (!own) return null;

  // 1,017 units carry a purchase price of exactly 0 and 182 carry none at all.
  // Both mean "nobody costed this", and both must read that way rather than as
  // hardware that was free — a $0 book value is a claim, an unknown one isn't.
  const uncosted = own.purchasePrice === null || own.purchasePrice <= 0;

  return (
    <Card
      title="Ownership & value"
      meta={own.ownershipType.toLowerCase().replace(/_/g, " ")}
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Figure
          label="Book value"
          value={own.book ? money(own.book.book) : "—"}
          note={
            own.book
              ? own.book.fullyDepreciated
                ? "fully depreciated"
                : `${own.book.monthsOwned} of ${own.book.usefulLifeMonths} months`
              : uncosted
                ? "nothing paid on record"
                : "no schedule for this method"
          }
          loud
        />
        <Figure
          label="Paid"
          value={uncosted ? "—" : money(own.purchasePrice!)}
          note={
            uncosted
              ? `bought ${dayYear(own.purchaseDate)}, price unrecorded`
              : dayYear(own.purchaseDate)
          }
        />
        <Figure label="Earned" value={money(own.revenue)} note="lifetime" />
        <Figure
          label="Maintenance"
          value={money(own.maintenanceCost)}
          note="charged to this unit"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-hairline px-4 pt-3 pb-4">
        <Field label="Bought from">
          {own.vendor ? (
            <Link
              href={`/dashboard/vendors/${own.vendor.id}`}
              className="text-accent-text hover:underline"
            >
              {own.vendor.name}
            </Link>
          ) : (
            <Unset>Unrecorded</Unset>
          )}
        </Field>
        <Field label="Received">
          {own.receivedDate ? (
            dayYear(own.receivedDate)
          ) : (
            <Unset>Not logged</Unset>
          )}
        </Field>
      </div>

      {own.lease || own.loanName ? (
        <div className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          Financed by {own.fundingBusiness ?? own.lease?.lender ?? "a lender"}
          {own.lease ? ` on lease ${own.lease.leaseNumber}` : ""}
          {own.loanName && !own.lease ? ` · ${own.loanName}` : ""}
          {own.loanAmount ? ` · facility ${money(own.loanAmount)}` : ""}
          {own.amortizationEndDate
            ? `, paid down to ${dayYear(own.amortizationEndDate)}`
            : ""}
          .{" "}
          {/* The facility covers many units; apportioning it per unit would be
              an invented figure, so it is named as the lease's total. */}
          {own.loanAmount
            ? "That figure is the whole facility, not this unit's share."
            : ""}
        </div>
      ) : null}

      {own.soldAt ? (
        <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          Sold {dayYear(own.soldAt)}
          {own.soldPrice === null ? "" : ` for ${money(own.soldPrice)}`}
          {own.soldNotes ? ` — ${own.soldNotes}` : ""}.
        </p>
      ) : null}

      {own.retiredAt ? (
        <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
          Retired {dayYear(own.retiredAt)}
          {own.retirementReason
            ? ` · ${own.retirementReason.toLowerCase()}`
            : ""}
          {own.retiredTo ? ` to ${own.retiredTo}` : ""}.
        </p>
      ) : null}
    </Card>
  );
}
