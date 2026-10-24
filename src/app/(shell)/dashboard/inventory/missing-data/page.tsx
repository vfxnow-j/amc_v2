import { redirect } from "next/navigation";
import { MissingDataTable } from "@/components/inventory/missing-data-table";
import { PageHeader } from "@/components/shell/page-header";
import { listIncompleteUnits } from "@/lib/actions/unit-data";
import { getSessionUser, type Role } from "@/lib/roles";

export const metadata = { title: "Missing data" };

/** Fixing a serial writes to a unit, so viewers are sent away. */
const ALLOWED: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF"];

/**
 * Insight → Missing data: every unit that should carry a serial and does not,
 * whether a scan flagged it or it was simply never recorded. Each row takes the
 * serial inline and drops out once saved. Items that carry no serial (cables,
 * consumables) are switched off under Edit details on the asset.
 */
export default async function MissingDataPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!ALLOWED.includes(user.role)) redirect("/dashboard");

  const rows = await listIncompleteUnits();

  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Missing data"
        blurb="Units without a serial number. Scan or type the serial from the unit’s label and it is saved at once."
      />
      <MissingDataTable rows={rows} />
    </>
  );
}
