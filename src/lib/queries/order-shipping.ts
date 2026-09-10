import { prisma } from "@/lib/prisma";
import { applyShippingMargin } from "@/lib/pricing/financials";
import type { DeliveryMethod } from "@/generated/prisma/client";

/**
 * What the order says about getting the kit there and back.
 *
 * A plain read, no side effects, the same shape as `order-documents`. It exists
 * because the fourteen delivery columns have been written by the ported actions
 * and read by the quote portal, the delivery note, the order-detail PDF and the
 * client emails since the port — and shown on no screen in v2. The client could
 * read the delivery method off their own quote while nobody here could see it.
 *
 * `charged` is what the client pays, `cost` is what it costs the business, and
 * the difference is the margin. Both are derived through `applyShippingMargin`
 * rather than recomputed here, because that function is what
 * `computeReservationFinancials` uses to build the order total — a second
 * implementation would eventually disagree with the number on the quote.
 */

export type ShippingLeg = {
  method: DeliveryMethod | null;
  date: Date | null;
  courier: string | null;
  trackingNumber: string | null;
  cost: number;
  charged: number;
};

export type OrderShipping = {
  delivery: ShippingLeg;
  return: ShippingLeg;
  address: string | null;
  notes: string | null;
  marginType: "FIXED" | "PERCENTAGE" | null;
  margin: number;
  /** Cost carried by the business and never billed on. */
  internalCost: number;
  /** True when not one field has ever been set — the card says so plainly. */
  empty: boolean;
};

export async function getOrderShipping(
  reservationId: string,
): Promise<OrderShipping | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      deliveryMethod: true,
      deliveryAddress: true,
      deliveryDate: true,
      deliveryCost: true,
      deliveryCourier: true,
      deliveryNotes: true,
      deliveryTrackingNumber: true,
      returnMethod: true,
      returnDate: true,
      returnCost: true,
      returnCourier: true,
      returnTrackingNumber: true,
      shippingMarginType: true,
      shippingMargin: true,
      internalShippingCost: true,
    },
  });
  if (!order) return null;

  const marginType =
    order.shippingMarginType === "FIXED" ||
    order.shippingMarginType === "PERCENTAGE"
      ? order.shippingMarginType
      : null;
  const margin = Number(order.shippingMargin) || 0;

  const deliveryCost = Number(order.deliveryCost) || 0;
  const returnCost = Number(order.returnCost) || 0;

  const empty =
    order.deliveryMethod === null &&
    order.returnMethod === null &&
    order.deliveryAddress === null &&
    order.deliveryCourier === null &&
    order.returnCourier === null &&
    order.deliveryTrackingNumber === null &&
    order.returnTrackingNumber === null &&
    order.deliveryNotes === null &&
    deliveryCost === 0 &&
    returnCost === 0;

  return {
    delivery: {
      method: order.deliveryMethod,
      date: order.deliveryDate,
      courier: order.deliveryCourier,
      trackingNumber: order.deliveryTrackingNumber,
      cost: deliveryCost,
      charged: applyShippingMargin(deliveryCost, marginType, margin),
    },
    return: {
      method: order.returnMethod,
      date: order.returnDate,
      courier: order.returnCourier,
      trackingNumber: order.returnTrackingNumber,
      cost: returnCost,
      charged: applyShippingMargin(returnCost, marginType, margin),
    },
    address: order.deliveryAddress,
    notes: order.deliveryNotes,
    marginType,
    margin,
    internalCost: Number(order.internalShippingCost) || 0,
    empty,
  };
}
