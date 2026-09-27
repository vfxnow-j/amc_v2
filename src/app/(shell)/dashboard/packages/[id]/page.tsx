import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageEditor } from "@/components/packages/package-editor";
import { PageHeader } from "@/components/shell/page-header";
import { CardSkeleton } from "@/components/record/record-card";
import { PortalListingCard } from "@/components/portal/portal-listing-card";
import { getTemplate } from "@/lib/queries/packages";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const template = await getTemplate(id);
  return { title: template?.name ?? "Package" };
}

/**
 * One of our packages, built here.
 *
 * Lines are assets (priced at the asset's current rate unless this sets its
 * own), services, or free text with a rate. A workstation asset brings its
 * recorded build with it when the package is loaded onto a quote, so a package
 * lists the machine, not its parts.
 */
export default async function PackagePage({ params }: Params) {
  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Packages"
        title={template.name}
        blurb={
          <>
            {template.description ? `${template.description} · ` : ""}
            {template.isActive ? "Offered in Add line on quotes" : "Archived — not offered on quotes"} ·{" "}
            <Link href="/dashboard/packages" className="text-accent-text hover:underline">
              All packages
            </Link>
          </>
        }
      />
      <PackageEditor
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          isActive: template.isActive,
          lines: template.lines,
          totals: template.totals,
        }}
      />
      {/* In the client portal: as many packages as its scarcest item allows. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Suspense fallback={<CardSkeleton title="Client portal" rows={3} />}>
          <PortalListingCard target={{ kind: "PACKAGE", id: template.id }} />
        </Suspense>
      </div>
    </>
  );
}
