"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/actions/audit";
import { isConfirmedPrice } from "@/lib/market-price";

/**
 * Setting a market price by hand.
 *
 * Prices are maintained by hand from 2026-08-12 (owner) — v1's scraper is not
 * ported — so this is the only way a figure gets into `Asset.marketPrice` in
 * v2, and the screens that act on prices only act on the ones written here.
 * See `lib/market-price.ts`.
 *
 * A thin v2 layer over `actions/market-prices.updateMarketPrice`, which throws
 * on refusal. A thrown error from a server action lands on the nearest error
 * boundary and replaces the record somebody was reading; this returns an
 * outcome the panel renders in place. It also writes the audit row itself
 * rather than calling the ported action, because the ported one records only
 * the price — and the source is the part that decides whether anything acts on
 * it.
 *
 * Only async functions may be exported from a "use server" file.
 */

export type MarketPriceOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/** The marker v1's scraper appended. Typing it by hand would be a lie. */
const SCRAPED_MARKER = "(auto-updated)";

export async function saveMarketPrice(
  assetId: string,
  input: { price: number; source: string; notes: string },
): Promise<MarketPriceOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { status: "error", message: "Enter a price above zero." };
  }

  const source = input.source.trim();
  if (!source) {
    return {
      status: "error",
      message:
        "Say where the price came from. It is what separates a figure somebody checked from one a crawler found, and the rate recommendations only read the former.",
    };
  }
  if (!isConfirmedPrice(source)) {
    return {
      status: "error",
      message: `"${SCRAPED_MARKER}" marks a price as collected by the retired scraper. Name the shop, listing or quote instead.`,
    };
  }

  const existing = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { marketPrice: true, marketPriceSource: true },
  });
  if (!existing) return { status: "error", message: "Asset not found." };

  const notes = input.notes.trim();

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      marketPrice: input.price,
      marketPriceSource: source,
      marketPriceUpdatedAt: new Date(),
      marketPriceNotes: notes || null,
    },
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: assetId,
    oldValues: {
      marketPrice: existing.marketPrice ? Number(existing.marketPrice) : null,
      marketPriceSource: existing.marketPriceSource,
    },
    newValues: { marketPrice: input.price, marketPriceSource: source },
    userId: auth.userId,
  });

  revalidatePath(`/dashboard/assets/${assetId}`);
  revalidatePath("/dashboard/reports/pricing");
  // The pricing insights read confirmed prices only, so this changes them.
  revalidatePath("/dashboard/insights");
  revalidatePath("/dashboard");

  const wasUnconfirmed = !isConfirmedPrice(existing.marketPriceSource);
  return {
    status: "ok",
    message: wasUnconfirmed
      ? "Saved. This price is now confirmed, so the rate recommendations will take it into account."
      : "Saved.",
  };
}
