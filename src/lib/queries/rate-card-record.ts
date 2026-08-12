import { prisma } from "@/lib/prisma";
import {
  RATE_FIELD,
  isPricedRateType,
  type PricedRateType,
} from "@/lib/revenue/labels";

/**
 * Queries behind the Rate card record.
 *
 * The uncomfortable fact this screen has to be honest about: **nothing in the
 * app prices off a `RateCard`.** `lib/pricing/rates.ts` derives every order
 * line's rate from the asset's own `dailyRate`/`weeklyRate`/`monthlyRate`, and
 * v1's "rate card import" under settings writes those asset fields too — it
 * never touches `Rate`. So a rate card is a stated intention, and the assets
 * are what is actually charged.
 *
 * That makes the interesting content of this record the *gap* between the two,
 * which is what `getRateCardGap` returns.
 */

export async function getRateCard(id: string) {
  const card = await prisma.rateCard.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
      rates: {
        orderBy: { pricingType: "asc" },
        select: {
          id: true,
          categoryId: true,
          pricingType: true,
          rate: true,
        },
      },
    },
  });
  if (!card) return null;

  const categoryIds = [
    ...new Set(
      card.rates
        .map((rate) => rate.categoryId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const categories = await prisma.assetCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return {
    ...card,
    rates: card.rates.map((rate) => ({
      id: rate.id,
      categoryId: rate.categoryId,
      // A rate with no category is the card's catch-all for everything it
      // doesn't name — the schema allows it, though no card here uses one.
      categoryName: rate.categoryId
        ? (categoryName.get(rate.categoryId) ?? "Category since deleted")
        : "Everything else",
      pricingType: rate.pricingType,
      rate: Number(rate.rate),
    })),
    categoryCount: categoryIds.length,
  };
}

/**
 * Every category, and whether this card has anything to say about it.
 *
 * A card that prices one category out of thirty is not obviously broken from
 * its own rates — you have to see what it leaves out. The asset count comes
 * along so "prices nothing" can be told apart from "prices nothing, and there
 * is nothing there".
 */
export async function getRateCardCoverage(id: string) {
  const [categories, rates] = await Promise.all([
    prisma.assetCategory.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { assets: true } } },
    }),
    prisma.rate.findMany({
      where: { rateCardId: id },
      select: { categoryId: true },
    }),
  ]);

  const priced = new Set(rates.map((rate) => rate.categoryId).filter(Boolean));

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    assets: category._count.assets,
    priced: priced.has(category.id),
  }));
}

export type RateGapRow = {
  assetId: string;
  assetName: string;
  categoryName: string;
  /**
   * Narrower than `Rate.pricingType` on purpose: the gap is computed only for
   * tiers `Asset` has a column for, so a row here can never carry HOURLY,
   * PROJECT or CUSTOM. Saying so in the type spares every consumer a re-check
   * whose other branch is unreachable.
   */
  pricingType: PricedRateType;
  current: number | null;
  card: number;
};

/**
 * Where the assets disagree with the card.
 *
 * One row per asset × priced tier that differs, which is the list a bulk update
 * would rewrite. An asset with no rate at all counts as a difference: an unset
 * rate falls through `deriveRentalRate`'s ladder to whatever tier the asset
 * does have, so "unpriced" is not the same as "priced at the card's figure".
 *
 * HOURLY, PROJECT and CUSTOM rates are skipped — `Asset` has no column for
 * them, so a card that carries one has nothing to compare it against, and the
 * screen says so rather than silently ignoring the rate.
 */
export async function getRateCardGap(id: string) {
  const rates = await prisma.rate.findMany({
    where: { rateCardId: id, categoryId: { not: null } },
    select: { id: true, categoryId: true, pricingType: true, rate: true },
  });

  // flatMap rather than filter so the narrowing survives into the row type —
  // `filter` leaves `pricingType` as the full enum however the predicate reads.
  // The `categoryId` test is the where-clause above restated for the compiler;
  // it drops nothing at runtime, and it is what spares the rest of the function
  // a cast on every use.
  const comparable = rates.flatMap((rate) =>
    isPricedRateType(rate.pricingType) && rate.categoryId
      ? [{ ...rate, pricingType: rate.pricingType, categoryId: rate.categoryId }]
      : [],
  );
  const uncomparable = rates.length - comparable.length;
  if (comparable.length === 0) {
    return { rows: [], matched: 0, uncomparable, assetsCovered: 0 };
  }

  const assets = await prisma.asset.findMany({
    where: {
      categoryId: { in: comparable.map((rate) => rate.categoryId) },
      retiredAt: null,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      categoryId: true,
      dailyRate: true,
      weeklyRate: true,
      monthlyRate: true,
      category: { select: { name: true } },
    },
  });

  // Bucketed once rather than re-scanned per rate: a card with three tiers
  // across ten categories would otherwise walk the whole catalogue thirty times
  // to reach the handful of assets in each.
  const byCategory = new Map<string, typeof assets>();
  for (const asset of assets) {
    if (!asset.categoryId) continue;
    const bucket = byCategory.get(asset.categoryId);
    if (bucket) bucket.push(asset);
    else byCategory.set(asset.categoryId, [asset]);
  }

  const rows: RateGapRow[] = [];
  let matched = 0;

  for (const rate of comparable) {
    const field = RATE_FIELD[rate.pricingType];
    const target = Number(rate.rate);
    for (const asset of byCategory.get(rate.categoryId) ?? []) {
      const raw = asset[field];
      const current = raw === null ? null : Number(raw);
      if (current !== null && Math.abs(current - target) < 0.005) {
        matched += 1;
        continue;
      }
      rows.push({
        assetId: asset.id,
        assetName: asset.name,
        categoryName: asset.category.name,
        pricingType: rate.pricingType,
        current,
        card: target,
      });
    }
  }

  return { rows, matched, uncomparable, assetsCovered: assets.length };
}
