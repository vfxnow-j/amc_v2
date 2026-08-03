import { redirect } from "next/navigation";
import { AssetImport } from "@/components/settings/import-runner";
import { ImportScreen } from "@/components/settings/import-screen";
import { SettingsDenied } from "@/components/settings/settings-chrome";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Import assets" };

/**
 * Settings → Import → Assets.
 *
 * The heaviest of the three. It creates assets and their units, and — depending
 * on the switches — the categories, locations, vendors and clients the sheet
 * names, plus orders for anything the custody column says is already out.
 *
 * "Raise orders for units already out" defaults to off. It is right exactly
 * once, on a first load into an empty system: it makes units that are with a
 * client read as checked out rather than as free stock. Run a second time
 * against a populated database it invents a duplicate order per client, which
 * is the kind of mistake that shows up a week later as double-booked hardware.
 */
export default async function AssetImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="import" role={user.title} />;

  return (
    <ImportScreen id="assets">
      <AssetImport />
    </ImportScreen>
  );
}
