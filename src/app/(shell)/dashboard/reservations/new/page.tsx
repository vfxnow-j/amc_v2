import { PageHeader } from "@/components/shell/page-header";
import { OrderBuilder } from "@/components/reservations/order-builder";

export const metadata = { title: "New order" };

/**
 * Operate → Reservations → new.
 *
 * Availability is answered per keystroke by server actions rather than by
 * shipping the catalogue to the browser: 224 assets and 2,616 units is not a
 * payload, and the answer has to be current at the moment of asking.
 */
export default function NewOrderPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="New order"
        blurb="Set the window first — availability is answered across it, not for today."
      />
      <OrderBuilder />
    </>
  );
}
