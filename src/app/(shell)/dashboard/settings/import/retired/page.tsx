import { redirect } from "next/navigation";
import { RetiredImport } from "@/components/settings/import-runner";
import { ImportScreen } from "@/components/settings/import-screen";
import { SettingsDenied } from "@/components/settings/settings-chrome";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Import retirements" };

/**
 * Settings → Import → Retirements.
 *
 * Takes units out of the fleet in bulk and records when and why. There is no
 * bulk undo: a retired unit stops counting as stock, stops being bookable, and
 * stops accruing depreciation, and putting a hundred of them back is a hundred
 * separate decisions.
 *
 * The "create unknown units, retired" switch is off by default and named for
 * what it does. It exists because the historical sheet describes hardware this
 * database never held — 1,227 units are already retired here — and filing it
 * gives the depreciation and disposal history somewhere to live. Those units
 * enter out of the fleet, so they never count as bookable stock for a moment.
 */
export default async function RetiredImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="import" role={user.title} />;

  return (
    <ImportScreen id="retired">
      <RetiredImport />
    </ImportScreen>
  );
}
