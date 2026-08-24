import { redirect } from "next/navigation";

/** The builder moved to /dashboard/orders/new, and now asks for a type. */
export default async function NewReservationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  redirect(client ? `/dashboard/orders/new?client=${client}` : "/dashboard/orders/new");
}
