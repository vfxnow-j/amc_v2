import { redirect } from "next/navigation";
import { Card } from "@/components/record/record-card";
import { EntityForm } from "@/components/entities/entity-form";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "New entity" };

export default async function NewEntityPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/login");
  if (viewer.role !== "SUPER_ADMIN") return <SettingsDenied id="entities" role={viewer.title} />;

  return (
    <>
      <SettingsHeader
        id="entities"
        title="New entity"
        blurb="Creating an entity also creates its database, so this takes a few seconds."
      />
      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card title="Entity">
          <EntityForm mode="create" />
        </Card>
      </div>
    </>
  );
}
