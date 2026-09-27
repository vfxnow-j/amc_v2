import { redirect } from "next/navigation";
import { MapScreen } from "@/components/inventory/map/map-screen";
import { PageHeader } from "@/components/shell/page-header";
import { getMapData, parseMapFilters } from "@/lib/queries/map";
import { getSessionUser, type Role } from "@/lib/roles";

export const metadata = { title: "Map" };

/**
 * The Inventory cluster's roles. This screen shows client addresses, so a
 * VIEWER (or a Flow user) is sent away here, not only hidden from the rail.
 */
const ALLOWED: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF"];

/**
 * Inventory → Map: new in v2 (owner, 2026-09-26; docs/inventory-map.md).
 *
 * Where hardware is, on a globe: units out at their order's delivery address,
 * stock at its location — never a client's address standing in for a delivery
 * address. A Clients layer shows the client base on its own. Offline ZIP-level
 * geocoding only; the coverage line says how much of the fleet can't be placed.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!ALLOWED.includes(user.role)) redirect("/dashboard");

  const filters = parseMapFilters(await searchParams);
  const data = await getMapData(filters);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Map"
        blurb={
          filters.layer === "clients"
            ? "Every client with an order, at its own address — the client base and the regions it covers."
            : filters.mode === "reach"
              ? "Where completed orders went — counts only, from orders with a located delivery address."
              : "Where the hardware is now — out at its order's delivery address, stock at its location."
        }
      />
      {/* Every role that reaches this line can edit (see ALLOWED). */}
      <MapScreen data={data} canPin />
    </>
  );
}
