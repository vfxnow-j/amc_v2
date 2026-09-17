import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConfigurableItemEditor } from "@/components/settings/configurable-items";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { getAssetBuild } from "@/lib/actions/asset-build";
import { money } from "@/lib/format";
import { getConfigurableItem } from "@/lib/queries/configurable";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const item = await getConfigurableItem(id);
  return { title: item ? `Configure ${item.name}` : "Configurable item" };
}

/** One configurable item: its base parts and the options it can take. */
export default async function ConfigurableItemPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) return <SettingsDenied id="configurable-items" role={user.title} />;

  const { id } = await params;
  const item = await getConfigurableItem(id);
  if (!item) notFound();
  const options = await getAssetBuild(id);

  return (
    <>
      <SettingsHeader
        id="configurable-items"
        title={item.name}
        blurb={
          <>
            {item.category?.name ?? "Uncategorized"} · base rate {money(Number(item.monthlyRate ?? 0))}/mo
            {item.salePrice ? ` · sells for ${money(Number(item.salePrice))}` : ""} ·{" "}
            <Link href={`/dashboard/assets/${item.id}`} className="text-accent-text hover:underline">
              Asset record
            </Link>{" "}
            ·{" "}
            <Link href="/dashboard/settings/configurable-items" className="text-accent-text hover:underline">
              All configurable items
            </Link>
          </>
        }
      />
      <ConfigurableItemEditor assetId={item.id} assetName={item.name} options={options} />
    </>
  );
}
