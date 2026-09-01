import { Card, CardEmpty } from "@/components/record/record-card";
import { OrderActions } from "@/components/orders/order-actions";
import { STATUS_LABEL } from "@/lib/reservations/status";
import { movesFor } from "@/lib/orders/lifecycle";
import { getFloorStaff, getOrderLifecycle } from "@/lib/queries/order-lifecycle";
import type { ReservationType } from "@/generated/prisma/client";

/**
 * The server half of the stage controls: it reads what the buttons need and
 * hands it to the client component in one shape.
 *
 * Split out so the record page does not have to know that the action bar needs
 * the staff list, and so the read sits behind its own Suspense boundary — the
 * lines and the scan well are what the floor is waiting for, and neither should
 * wait on a list of user names.
 *
 * It sits in the right-hand column directly above the scan well, because that
 * is the order the work happens in: prepare the order, then scan units out
 * against it. As a full-width bar under the header it pushed everything down
 * and sat nowhere near the panel it unlocks.
 */
export async function OrderActionBar({
  id,
  type,
}: {
  id: string;
  type: ReservationType;
}) {
  const [order, staff] = await Promise.all([getOrderLifecycle(id), getFloorStaff()]);
  if (!order) return null;

  const { billing } = order;
  const moves = movesFor(order.status, type);

  if (moves.length === 0) {
    return (
      <Card title="Move it on">
        <CardEmpty>
          This order is {STATUS_LABEL[order.status].toLowerCase()} and has
          nowhere further to go. Its lines, invoices and documents stay on the
          record.
        </CardEmpty>
      </Card>
    );
  }

  return (
    <Card title="Move it on">
      <div className="px-4 pb-4">
        <OrderActions
          id={id}
          status={order.status}
          type={type}
          clientEmail={order.client.email}
          clientPaymentTerms={order.client.paymentTerms}
          staff={staff}
          total={billing.total}
          terms={{
            billingCycleType: billing.cycleType,
            billingCycleDay: billing.cycleDay,
            billingCycleDays: billing.cycleDays,
            isRecurring: billing.isRecurring,
            notBilled: billing.notBilled,
            taxRate: billing.taxRate,
            discountType: billing.discountType,
            discountValue: billing.discountValue,
            paymentTerms: billing.paymentTerms,
          }}
        />
      </div>
    </Card>
  );
}
