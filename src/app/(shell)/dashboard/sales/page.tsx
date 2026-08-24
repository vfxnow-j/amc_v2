import { redirect } from "next/navigation";

/**
 * Contracts is gone, and the two things it held went to different places.
 *
 * Sales and rent-to-owns were `Reservation` rows all along — orders — so they
 * are in Operate → Orders behind a type filter, alongside the rentals for the
 * same clients. Leases are not orders and never were, so they kept a screen of
 * their own.
 *
 * The old `?type=` values map straight across, so a bookmarked tab still lands
 * on the same set of rows.
 */
const DESTINATION: Record<string, string> = {
  sales: "/dashboard/orders?type=sale",
  "rent-to-own": "/dashboard/orders?type=rent-to-own",
  leases: "/dashboard/leases",
};

export default async function ContractsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  redirect(DESTINATION[type ?? "sales"] ?? DESTINATION.sales);
}
