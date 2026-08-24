import { redirect } from "next/navigation";

/**
 * Reservations is Orders now.
 *
 * The screen didn't move so much as absorb two others: sales and rent-to-owns
 * were always rows in the same table, split across screens by nothing but URL.
 * This keeps every existing link, bookmark and email working — the search
 * params carry over untouched, so a saved filter still lands on its filter.
 */
export default async function ReservationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((one) => params.append(key, one));
  }
  const query = params.toString();
  redirect(query ? `/dashboard/orders?${query}` : "/dashboard/orders");
}
