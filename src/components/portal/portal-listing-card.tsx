import { Card } from "@/components/record/record-card";
import { PortalListingToggles } from "@/components/portal/portal-listing-toggles";
import { PortalOfferImages } from "@/components/portal/portal-offer-images";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { loadAssetCapacityByOffering } from "@/lib/portal/capacity-load";
import { combineParts, solutionStocked } from "@/lib/portal/availability";
import { dayOf } from "@/lib/portal/capacity";
import { MAX_IMAGES_PER_OFFER } from "@/lib/portal/images";
import type { ListingTarget } from "@/lib/actions/portal-offers";

const SOLUTION_LABEL = { rental: "Rental", flow: "Flow", sale: "Sale" } as const;

/**
 * The portal card on an item or a package (owner, 2026-09-26): switch it on and
 * the portal lists it. Its name, description and specs are read live from the
 * record; what it is sold as comes from its units' Offered-as ticks; stock is
 * counted per solution — for a package, whole packages its scarcest part
 * allows. Images are the one thing added here.
 */
export async function PortalListingCard({ target }: { target: ListingTarget }) {
  const [user, offer, parts] = await Promise.all([
    getSessionUser(),
    prisma.portalOffer.findFirst({
      where: target.kind === "ASSET" ? { assetId: target.id } : { packageTemplateId: target.id },
      select: {
        id: true,
        isVisible: true,
        isPublic: true,
        images: { orderBy: { sortOrder: "asc" }, select: { id: true, alt: true, width: true, height: true } },
      },
    }),
    target.kind === "ASSET"
      ? Promise.resolve([{ assetId: target.id, quantity: 1 }])
      : prisma.packageTemplateItem
          .findMany({ where: { templateId: target.id, assetId: { not: null } }, select: { assetId: true, quantity: true } })
          .then((rows) => rows.map((r) => ({ assetId: r.assetId!, quantity: Math.max(1, r.quantity) }))),
  ]);
  const canEdit = !!user && isAdminRole(user.role);

  const today = new Date();
  const figures = new Map<string, NonNullable<Awaited<ReturnType<typeof loadAssetCapacityByOffering>>>>();
  for (const id of [...new Set(parts.map((p) => p.assetId))]) {
    const f = await loadAssetCapacityByOffering(id, today);
    if (f) figures.set(id, f);
  }
  const key = { rental: "RENTAL", flow: "FLOW", sale: "SALE" } as const;
  const stock = (Object.keys(key) as (keyof typeof key)[])
    .filter((s) => solutionStocked(s, parts, figures))
    .map((s) => ({ solution: s, ...combineParts(parts, (id) => figures.get(id)?.[key[s]], dayOf(today)) }));

  return (
    <Card title="Client portal" meta={offer?.isVisible ? "listed" : "not listed"}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <PortalListingToggles
          target={target}
          isVisible={!!offer?.isVisible}
          isPublic={!!offer?.isPublic}
          canEdit={canEdit}
        />
        <div className="text-detail">
          <span className="text-ink-muted">Available now: </span>
          {stock.length ? (
            stock.map((s, i) => (
              <span key={s.solution} className="tabular-nums text-ink">
                {i ? " · " : ""}
                {SOLUTION_LABEL[s.solution]} {s.available_now ?? "no limit"}
              </span>
            ))
          ) : (
            <span className="text-ink-faint">
              no units are ticked for Rental, Flow or Sale{target.kind === "PACKAGE" ? " on every item in it" : ""}
            </span>
          )}
        </div>
        <p className="text-detail text-ink-faint">
          Name, description and specs come from this {target.kind === "ASSET" ? "item and its build" : "package and its items"}.
        </p>
        {offer ? (
          <PortalOfferImages offerId={offer.id} images={offer.images} max={MAX_IMAGES_PER_OFFER} canEdit={canEdit} />
        ) : null}
      </div>
    </Card>
  );
}
