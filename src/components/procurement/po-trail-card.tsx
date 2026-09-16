import Link from "next/link";
import { Card, CardEmpty } from "@/components/record/record-card";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { dayYear } from "@/lib/format";
import { getAssetTrail } from "@/lib/procurement/po-queries";

/**
 * Where a model's units came from — the purchase orders that bought them, the
 * funding requests behind those orders, and the loans that paid.
 *
 * The unit record answers this for one unit; this answers it for the model, so
 * "which PO were our RTX 5090s on" is one screen, not a walk through every
 * barcode. Units with no PO are counted and named as such — most of the fleet
 * was here before receiving recorded the PO on a unit.
 */
export async function AssetTrailCard({ id }: { id: string }) {
  const trail = await getAssetTrail(id);
  if (!trail) return null;

  if (trail.orders.length === 0) {
    return (
      <Card title="Bought on">
        <CardEmpty>
          {trail.total === 0
            ? "No units yet, and no purchase order created this model. Receive a PO against it and the order shows here."
            : `${trail.total === 1 ? "Its one unit was not" : `None of its ${trail.total} units was`} received against a purchase order — added by hand, imported, or received before the PO was recorded on each unit.`}
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Bought on"
      meta={`${trail.traced} of ${trail.total} units traced to a PO`}
    >
      <ul className="flex flex-col gap-px px-2 pb-2">
        {trail.orders.map((order) => (
          <li key={order.id} className="rounded-row px-2 py-[6px] text-detail">
            <p className="flex items-baseline gap-2">
              <Link
                href={`/dashboard/purchase-orders/${order.id}`}
                className="font-bold tabular-nums text-accent-text hover:underline"
              >
                {order.poNumber}
              </Link>
              <span className="truncate text-ink-muted">
                {order.vendor.name} · {dayYear(order.orderDate)} ·{" "}
                {PO_STATUS_LABEL[order.status]}
              </span>
              <span className="ml-auto flex-none tabular-nums text-ink-muted">
                {order.units === 0
                  ? "no units"
                  : `${order.units} ${order.units === 1 ? "unit" : "units"}`}
              </span>
            </p>
            <p className="text-ink-faint">
              {order.createdModel ? "Created this model. " : ""}
              {order.fundingRequests.length > 0 ? (
                <>
                  Funding:{" "}
                  {order.fundingRequests.map((request, index) => (
                    <span key={request.id}>
                      {index > 0 ? ", " : ""}
                      <Link
                        href={`/dashboard/funding/${request.id}`}
                        className="text-accent-text hover:underline"
                      >
                        {request.requestNumber}
                      </Link>
                    </span>
                  ))}
                  .{" "}
                </>
              ) : (
                "No funding request. "
              )}
              {order.lease ? (
                <>
                  Loan:{" "}
                  <Link
                    href={`/dashboard/leases/${order.lease.id}`}
                    className="text-accent-text hover:underline"
                  >
                    {order.lease.leaseName}
                  </Link>
                  .
                </>
              ) : (
                "Not on a loan."
              )}
            </p>
          </li>
        ))}
      </ul>
      {trail.untraced > 0 ? (
        <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
          {trail.untraced} {trail.untraced === 1 ? "unit was" : "units were"} not
          received against a purchase order — added by hand, imported, or received
          before the PO was recorded on each unit.
        </p>
      ) : null}
    </Card>
  );
}
