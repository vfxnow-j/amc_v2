import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { EditShipping } from "@/components/orders/shipping-edit";
import { dayYear, moneyExact } from "@/lib/format";
import { getOrderShipping, type ShippingLeg } from "@/lib/queries/order-shipping";
import type { ShippingDetails } from "@/lib/actions/order-stage";
import { CARRIED, METHOD_LABEL } from "@/lib/orders/shipping";

function Leg({ title, leg }: { title: string; leg: ShippingLeg }) {
  const carried = leg.method !== null && CARRIED.includes(leg.method);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-card-title">{title}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Method">
          {leg.method ? METHOD_LABEL[leg.method] : <Unset>Not decided</Unset>}
        </Field>
        <Field label="Date">
          {leg.date ? dayYear(leg.date) : <Unset />}
        </Field>
        <Field label="Carrier">
          {leg.courier ?? <Unset />}
        </Field>
        <Field label="Tracking">
          {leg.trackingNumber ? (
            <span className="tabular-nums">{leg.trackingNumber}</span>
          ) : carried ? (
            // Not a fault, and worth naming: no order in this database has ever
            // carried a tracking number, so this reads as the normal state until
            // somebody starts recording them.
            <Unset>None recorded</Unset>
          ) : (
            <Unset />
          )}
        </Field>
        <Field label="Cost">
          {leg.cost ? moneyExact(leg.cost) : <Unset />}
        </Field>
        <Field label="Charged">
          {leg.charged ? (
            <>
              {moneyExact(leg.charged)}
              {leg.charged !== leg.cost ? (
                <span className="text-ink-faint">
                  {" "}
                  · {moneyExact(leg.charged - leg.cost)} on top
                </span>
              ) : null}
            </>
          ) : (
            <Unset />
          )}
        </Field>
      </div>
    </div>
  );
}

/**
 * Shipping on the order record.
 *
 * These fourteen columns have been on `Reservation` since the port. The ported
 * `createReservation` writes them, `computeReservationFinancials` prices them,
 * and the quote portal, the delivery note, the order-detail PDF and the client
 * emails all read them — so a client has been able to read the delivery method
 * off their own quote while nobody on this side could see it, and correcting a
 * courier meant opening the order in v1.
 *
 * Cost and charged are shown as separate facts because they are. The shipping
 * margin applies to both legs at once — one setting, not one per direction —
 * and `applyShippingMargin` turns cost into charged. Showing only the charged
 * figure would hide whether shipping is being marked up at all; showing only
 * cost would disagree with the quote.
 *
 * There is no `Shipment` model behind this, and nothing here implies one. One
 * method, one carrier, one tracking number and one cost per direction per
 * order is the whole of what the schema holds — no parcels, no weights, no
 * dimensions, no carrier rates. A multi-box consignment is a feature, not a
 * field.
 */
export async function ShippingCard({
  id,
  canEdit,
}: {
  id: string;
  canEdit: boolean;
}) {
  const shipping = await getOrderShipping(id);
  if (!shipping) return null;

  const draft: ShippingDetails = {
    deliveryMethod: shipping.delivery.method,
    deliveryAddress: shipping.address ?? "",
    deliveryCourier: shipping.delivery.courier ?? "",
    deliveryTrackingNumber: shipping.delivery.trackingNumber ?? "",
    deliveryCost: shipping.delivery.cost,
    returnMethod: shipping.return.method,
    returnCourier: shipping.return.courier ?? "",
    returnTrackingNumber: shipping.return.trackingNumber ?? "",
    returnCost: shipping.return.cost,
    shippingMarginType: shipping.marginType,
    shippingMargin: shipping.margin,
    deliveryNotes: shipping.notes ?? "",
  };

  const marginNote =
    shipping.marginType === "PERCENTAGE"
      ? `${shipping.margin}% on both legs`
      : shipping.marginType === "FIXED"
        ? `${moneyExact(shipping.margin)} on each leg`
        : "at cost";

  return (
    <Card
      title="Shipping"
      meta={shipping.empty ? undefined : marginNote}
      action={canEdit ? <EditShipping id={id} shipping={draft} /> : undefined}
    >
      {shipping.empty ? (
        <CardEmpty>
          Nothing recorded about how this order travels. The quote, the delivery
          note and the client&rsquo;s emails all show these details when they are
          set.
        </CardEmpty>
      ) : (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <Leg title="Going out" leg={shipping.delivery} />
          <Leg title="Coming back" leg={shipping.return} />

          {shipping.address ? (
            <Field label="Delivery address">
              <span className="whitespace-pre-line">{shipping.address}</span>
            </Field>
          ) : null}

          {shipping.notes ? (
            <Field label="Notes">
              <span className="whitespace-pre-line">{shipping.notes}</span>
            </Field>
          ) : null}

          {shipping.internalCost ? (
            <Field label="Carried internally">
              {moneyExact(shipping.internalCost)}
              <span className="text-ink-faint"> · never billed on</span>
            </Field>
          ) : null}
        </div>
      )}
    </Card>
  );
}
