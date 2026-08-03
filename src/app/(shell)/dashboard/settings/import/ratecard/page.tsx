import { redirect } from "next/navigation";
import { RateCardImport } from "@/components/settings/import-runner";
import { ImportScreen } from "@/components/settings/import-screen";
import { SettingsDenied } from "@/components/settings/settings-chrome";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Import rate card" };

/**
 * Settings → Import → Rate card.
 *
 * Repricing, and nothing else — it creates no assets and skips any name it
 * cannot match. The preview shows the before and after per asset rather than a
 * count, because "142 assets updated" is unreadable afterwards and unarguable
 * before: a rate going from $450 to $45 is a typo, and it is only visible as
 * one when both numbers are on screen.
 *
 * Rates live on the asset rather than the unit, so a match reprices every unit
 * of it. Orders already written keep the rate they were quoted at — the line
 * carries its own figures.
 */
export default async function RateCardImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="import" role={user.title} />;

  return (
    <ImportScreen id="ratecard">
      <RateCardImport />
    </ImportScreen>
  );
}
