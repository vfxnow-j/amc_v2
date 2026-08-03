import { PageHeader } from "@/components/shell/page-header";
import { OrderBuilder } from "@/components/reservations/order-builder";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "New order" };

/**
 * Operate → Reservations → new.
 *
 * Availability is answered per keystroke by server actions rather than by
 * shipping the catalogue to the browser: 224 assets and 2,616 units is not a
 * payload, and the answer has to be current at the moment of asking.
 *
 * `?client=<id>` preselects the account, which is how the builder is reached
 * from an account record. An unknown id resolves to null and the picker appears
 * as usual — a bad link should cost a click, not preload a client who isn't
 * there.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const params = await searchParams;
  const initialClient = params.client
    ? await prisma.client.findUnique({
        where: { id: params.client },
        select: { id: true, name: true, companyName: true },
      })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="New order"
        blurb="Set the window first — availability is answered across it, not for today."
      />
      <OrderBuilder initialClient={initialClient} />
    </>
  );
}
