import { PageHeader } from "@/components/shell/page-header";
import { gateEntityPage } from "../../gate";

// Placeholder route: the screen itself is built in the next step. The gate is real.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await gateEntityPage(slug, { write: true });
  return <PageHeader eyebrow={ctx.entity.name} title="Receive" blurb="This screen is not built yet." />;
}
