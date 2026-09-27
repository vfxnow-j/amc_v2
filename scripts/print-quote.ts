import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadFlowBases } from "@/lib/flow/load-bases";
import { loadFlowDefaults } from "@/lib/flow/order-inputs";
import { loadCreditTiers, tierFor } from "@/lib/portal/tiers";
import { priceQuote, type OfferPricing } from "@/lib/portal/quote";
import { OFFER_SELECT, offerRanges, packageComponents } from "@/lib/portal/offers";
import { assertClientSafe } from "@/lib/portal/dto";

/**
 * Read-only check of the portal quote core against v2's database: picks two real
 * assets that have a monthly rate and fully costed units, treats each as a
 * published offer (no portal_offers row is read or written), and prints the
 * client-facing quote lines for a 3-month rental, an RTO 12 (always refused — no
 * portal RTO basis yet) and a Flow 24, plus one active package template quoted as a
 * rental, and the public bands. Capacity is taken as unlimited here (the real route
 * reads it). SELECTs only; no snapshot is stored.
 *
 *   npx tsx scripts/print-quote.ts [name-fragment …]
 */
async function main() {
  const fragments = process.argv.slice(2);
  const candidates = await prisma.asset.findMany({
    where: {
      retiredAt: null,
      monthlyRate: { gt: 0 },
      units: { some: { purchasePrice: { gt: 0 } } },
      ...(fragments.length ? { OR: fragments.map((f) => ({ name: { contains: f, mode: "insensitive" as const } })) } : {}),
    },
    orderBy: { monthlyRate: "desc" },
    select: { id: true, name: true, dailyRate: true, weeklyRate: true, monthlyRate: true },
    take: 40,
  });
  const bases = await loadFlowBases(prisma, candidates.map((a) => a.id));
  const assets = candidates.filter((a) => bases[a.id] && bases[a.id].basis > 0 && !bases[a.id].incomplete).slice(0, 2);
  if (!assets.length) throw new Error("No asset with a monthly rate and fully costed units.");

  const [tiers, flowDefaults] = await Promise.all([loadCreditTiers(prisma), loadFlowDefaults(prisma)]);
  // A package: prefer one with a non-monthly or service line, to show those priced.
  const templates = await prisma.packageTemplate.findMany({
    where: { isActive: true, items: { some: {} } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: OFFER_SELECT.packageTemplate.select,
    take: 50,
  });
  const template =
    templates.find((t) => t.items.some((i) => (i.pricingType && i.pricingType !== "MONTHLY") || (i.serviceId && !i.assetId))) ??
    templates[0];
  const tier = tierFor(tiers, null);
  const offers = new Map<string, OfferPricing>(
    assets.map((a) => [
      a.id,
      {
        id: a.id,
        visible: true,
        solutions: ["rental", "rto", "flow"],
        termsBySolution: null,
        components: [{
          assetId: a.id,
          name: a.name,
          quantity: 1,
          assetRates: { dailyRate: a.dailyRate, weeklyRate: a.weeklyRate, monthlyRate: a.monthlyRate },
          overrideRate: null,
          overridePricingType: null,
          isOneTime: false,
          flowBasis: { basis: bases[a.id].basis, incomplete: bases[a.id].incomplete },
        }],
      },
    ]),
  );
  if (template) {
    offers.set(`pkg:${template.id}`, {
      id: `pkg:${template.id}`,
      visible: true,
      solutions: ["rental"],
      termsBySolution: null,
      components: packageComponents(template.items, {}),
    });
  }

  const start = new Date("2026-11-01T12:00:00Z");
  const end = new Date("2027-01-31T12:00:00Z");
  const result = priceQuote(
    [
      ...assets.flatMap((a) => [
        { offerId: a.id, qty: 2, solution: "rental" as const, term: null },
        { offerId: a.id, qty: 2, solution: "rto" as const, term: 12 },
        { offerId: a.id, qty: 2, solution: "flow" as const, term: 24 },
      ]),
      ...(template ? [{ offerId: `pkg:${template.id}`, qty: 1, solution: "rental" as const, term: null }] : []),
    ],
    {
      offers,
      tier,
      verificationLevel: "agreement_and_coi",
      flowDefaults,
      window: { start, end },
      capacity: () => ({ available: Number.POSITIVE_INFINITY, demand: "normal" }),
    },
  );
  const response = { data: { rate_id: "(not stored)", valid_until: new Date(Date.now() + result.validForMs).toISOString(), total: result.total, lines: result.lines } };
  assertClientSafe(response);

  for (const a of assets) console.log(`${a.id}  ${a.name}  (list $${Number(a.monthlyRate)}/mo)`);
  if (template) {
    console.log(`pkg:${template.id}  package "${template.name}":`);
    for (const i of template.items) {
      console.log(`   ${i.quantity} × ${i.description || i.asset?.name || i.service?.name}  rate=${i.rate ?? "(asset/service)"} type=${i.pricingType ?? "(asset)"}${i.isOneTime ? " one-time" : ""}${i.serviceId && !i.assetId ? " service" : ""}`);
    }
    const internal = result.internal.find((l) => l.offerId === `pkg:${template.id}`);
    console.log("   components as priced:", JSON.stringify(internal?.components?.map((c) => [c.name, c.rate, c.pricingType, c.isOneTime, Math.round(c.periods * 100) / 100, c.subtotal])));
  }
  console.log(`\nPOST /v1/rates/quote — window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}, qty 2 each`);
  console.log(JSON.stringify(response, null, 2));
  console.log("\nPublic bands at the default tier:");
  for (const a of assets) console.log(a.name, JSON.stringify(offerRanges(offers.get(a.id)!, { tier, flowDefaults, today: new Date() })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
