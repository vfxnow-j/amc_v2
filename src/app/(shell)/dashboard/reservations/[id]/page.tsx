import { redirect } from "next/navigation";

/** The order record moved to /dashboard/orders/[id]; the id is unchanged. */
export default async function ReservationRecordRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/orders/${id}`);
}
