import { OrderActions } from "@/components/orders/order-actions";
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

  return (
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
  );
}

export function OrderActionBarSkeleton() {
  return <div className="h-9 w-64 animate-pulse rounded-pill bg-panel" />;
}
