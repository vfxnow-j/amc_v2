import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/record/record-card";
import { EntityForm } from "@/components/entities/entity-form";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Entity" };

export default async function EntityRecordPage({ params }: Params) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/login");
  if (viewer.role !== "SUPER_ADMIN") return <SettingsDenied id="entities" role={viewer.title} />;

  const { id } = await params;
  const entity = await prisma.entity.findUnique({ where: { id } });
  if (!entity) notFound();

  return (
    <>
      <SettingsHeader
        id="entities"
        title={entity.name}
        blurb={
          <>
            {entity.slug} · {entity.active ? "active" : "deactivated"} · schema v{entity.schemaVersion}
          </>
        }
        actions={
          entity.active ? (
            <Link
              href={`/entity/${entity.slug}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Open workspace
            </Link>
          ) : undefined
        }
      />
      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card title="Entity">
          <EntityForm
            mode="edit"
            id={entity.id}
            slug={entity.slug}
            active={entity.active}
            initial={{
              name: entity.name,
              contactName: entity.contactName ?? "",
              email: entity.email ?? "",
              phone: entity.phone ?? "",
              address: entity.address ?? "",
              notes: entity.notes ?? "",
              modules: entity.modules,
            }}
          />
        </Card>
      </div>
    </>
  );
}
