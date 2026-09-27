import { redirect } from "next/navigation";
import { ListTable, type Column } from "@/components/list/list-table";
import { Card } from "@/components/record/record-card";
import { PortalOfferForm, type PortalOfferDraft } from "@/components/settings/portal-offer-form";
import { SettingsDenied, SettingsHeader } from "@/components/settings/settings-chrome";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Portal offers" };

const COLUMNS: Column[] = [
  { key: "title", label: "Offer", width: "minmax(0,1.4fr)" },
  { key: "target", label: "Sells", width: "minmax(0,1fr)" },
  { key: "solutions", label: "Solutions", width: "minmax(0,1fr)" },
  { key: "state", label: "State", width: "120px" },
];

const SOLUTION_LABEL: Record<string, string> = { rental: "Rental", rto: "Rent-to-own", flow: "Flow" };

/**
 * Settings → Portal offers.
 *
 * The client portal's catalog is curated and opt-in: an offer points at one
 * asset or one package, says which solutions and terms it may be quoted in, and
 * carries the specs and software tags staff write for it. Nothing reaches the
 * portal until it is published; "public" also puts its price band on the public
 * site. Prices are never typed here — the portal is quoted from the asset's own
 * rates and the Flow engine.
 *
 * Which offer the form is editing lives in the URL (`?edit=<id>`), as on
 * Categories.
 */
export default async function PortalOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) return <SettingsDenied id="portal-offers" role={user.title} />;

  const { edit } = await searchParams;
  const [offers, assets, packages] = await Promise.all([
    prisma.portalOffer.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: {
        id: true,
        slug: true,
        kind: true,
        title: true,
        blurb: true,
        solutions: true,
        termsBySolution: true,
        software: true,
        specs: true,
        isPublic: true,
        isVisible: true,
        sortOrder: true,
        assetId: true,
        packageTemplateId: true,
        asset: { select: { name: true } },
        packageTemplate: { select: { name: true } },
        pool: { select: { name: true } },
      },
    }),
    prisma.asset.findMany({
      where: { retiredAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, monthlyRate: true },
    }),
    prisma.packageTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const selected = edit ? offers.find((o) => o.id === edit) : undefined;
  const draft: PortalOfferDraft | null = selected
    ? {
        id: selected.id,
        kind: selected.kind === "PACKAGE" ? "PACKAGE" : "ASSET",
        targetId: selected.assetId ?? selected.packageTemplateId ?? "",
        title: selected.title,
        slug: selected.slug,
        blurb: selected.blurb ?? "",
        solutions: selected.solutions,
        termsBySolution: termsOf(selected.termsBySolution),
        software: selected.software,
        specs: specsOf(selected.specs),
        isPublic: selected.isPublic,
        isVisible: selected.isVisible,
        sortOrder: selected.sortOrder,
      }
    : null;

  return (
    <>
      <SettingsHeader id="portal-offers" />
      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,400px)_1fr]">
        <Card
          title={selected ? `Edit ${selected.title}` : "Add an offer"}
          meta={selected ? undefined : "or pick a row to change one"}
        >
          <PortalOfferForm
            key={selected?.id ?? "new"}
            offer={draft}
            assets={assets.map((a) => ({ id: a.id, name: a.name, priced: Number(a.monthlyRate ?? 0) > 0 }))}
            packages={packages}
          />
        </Card>
        <ListTable
          columns={COLUMNS}
          total={offers.length}
          empty={
            <>
              No offers yet. The client portal shows nothing until an offer is added here and published — choose
              an asset or a package, the solutions it may be quoted in, and the specs and software a client filters by.
            </>
          }
          rows={offers.map((o) => ({
            id: o.id,
            href: `/dashboard/settings/portal-offers?edit=${o.id}`,
            flagged: o.id === edit,
            cells: {
              title: (
                <span className="min-w-0">
                  <span className="block truncate font-bold">{o.title}</span>
                  <span className="block truncate text-detail text-ink-muted">{o.slug}</span>
                </span>
              ),
              target: (
                <span className="truncate text-ink-muted">
                  {o.asset?.name ?? o.packageTemplate?.name ?? o.pool?.name ?? "—"}
                </span>
              ),
              solutions: (
                <span className="truncate text-ink-muted">
                  {o.solutions.map((s) => SOLUTION_LABEL[s] ?? s).join(" · ")}
                </span>
              ),
              state: o.isVisible ? (
                <span className="text-ink">{o.isPublic ? "Published · public" : "Published"}</span>
              ) : (
                <span className="text-ink-faint">Hidden</span>
              ),
            },
          }))}
        />
      </div>
    </>
  );
}

function termsOf(v: unknown): { rto: number[]; flow: number[] } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const nums = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is number => typeof n === "number") : []);
  return { rto: nums(o.rto), flow: nums(o.flow) };
}

function specsOf(v: unknown): { key: string; value: string }[] {
  if (Array.isArray(v)) {
    return v
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({ key: String(r.key ?? ""), value: String(r.value ?? "") }));
  }
  if (v && typeof v === "object") return Object.entries(v).map(([key, value]) => ({ key, value: String(value ?? "") }));
  return [];
}
