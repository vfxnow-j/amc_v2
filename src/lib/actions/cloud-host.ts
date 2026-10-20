"use server";

import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import {
  addCloudHostToReservation,
  addItemToReservation,
  updateCloudHostInReservation,
} from "@/lib/actions/reservations";
import {
  parseHostName,
  priceCloudEnv,
  priceCloudHost,
  type CloudEnvInput,
  type CloudHostInput,
  type CloudPeriod,
  type CloudProductRow,
} from "@/lib/cloud/host";
import type { StageOutcome } from "@/lib/actions/order-stage";

/**
 * Cloud hosts on an order that already exists: add one, edit one, add an
 * environment line. The money is never taken from the browser — the dialog
 * sends product ids and counts, and `lib/cloud/host` prices them here from the
 * catalogue, so a stale tab can't store last month's price.
 *
 * The writes themselves are the ported `addCloudHostToReservation` /
 * `updateCloudHostInReservation` (one transaction: the host row, its hidden
 * parts, the order's totals), so discount, tax and shipping apply exactly as
 * they do to every other line.
 */

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** The catalogue the configurator offers: active products only, money as numbers. */
export async function loadCloudProducts(): Promise<CloudProductRow[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const rows = await prisma.cloudProduct.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((p) => ({
    id: p.id,
    category: p.category,
    name: p.name,
    costHourly: num(p.costHourly) ?? 0,
    costDaily: num(p.costDaily) ?? 0,
    costWeekly: num(p.costWeekly) ?? 0,
    costMonthly: num(p.costMonthly) ?? 0,
    sellHourly: num(p.sellHourly),
    sellDaily: num(p.sellDaily),
    sellWeekly: num(p.sellWeekly),
    sellMonthly: num(p.sellMonthly),
    marginPercent: num(p.marginPercent) ?? 0,
  }));
}

/** Prices a draft host for the builder's total, from the same call that stores it. */
export async function previewCloudDraft(
  hosts: CloudHostInput[],
  env: CloudEnvInput[],
): Promise<
  | { status: "ok"; hosts: Array<{ perHostSell: number; totalSell: number; description: string; period: CloudPeriod }>; env: number[] }
  | { status: "error"; message: string }
> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    const products = await loadCloudProducts();
    return {
      status: "ok",
      hosts: hosts.map((h) => {
        const priced = priceCloudHost(products, h);
        return {
          perHostSell: priced.perHostSell,
          totalSell: priced.totalSell,
          description: priced.description,
          period: priced.period,
        };
      }),
      env: env.map((e) => priceCloudEnv(products, e).rate * e.quantity),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "That could not be priced." };
  }
}

export type CloudHostConfig = {
  period: CloudPeriod;
  quantity: number;
  hostName: string | null;
  rows: Array<{ cloudProductId: string; qtyPerHost: number }>;
};

/** A stored host as the dialog edits it: its period, count, name and parts. */
export async function getCloudHostConfig(reservationId: string, itemId: string): Promise<CloudHostConfig | null> {
  const auth = await requireEditor();
  if (!auth.authorized) return null;
  const host = await prisma.reservationItem.findFirst({
    where: { id: itemId, reservationId, parentId: null, cloudProductId: null },
    select: {
      pricingType: true,
      quantity: true,
      description: true,
      components: {
        where: { cloudProductId: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { cloudProductId: true, quantity: true },
      },
    },
  });
  if (!host) return null;
  const period = (["HOURLY", "DAILY", "WEEKLY", "MONTHLY"] as const).find((p) => p === host.pricingType) ?? "MONTHLY";
  return {
    period,
    quantity: Math.max(1, host.quantity),
    hostName: parseHostName(host.description),
    rows: host.components.map((c) => ({ cloudProductId: c.cloudProductId!, qtyPerHost: Math.max(1, c.quantity) })),
  };
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work. Try again.";
}

async function cloudOrder(reservationId: string) {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { reservationType: true },
  });
  if (!order) throw new Error("Order not found.");
  if (order.reservationType !== "CLOUD") throw new Error("Cloud hosts belong on a cloud order.");
}

/**
 * Add a host to the order, or — given `itemId` — replace an existing one's
 * configuration. Editing keeps whatever hardware is already reserved behind the
 * host (and its cost, which then stays the hardware's cost rather than the
 * catalogue's).
 */
export async function saveCloudHost(
  reservationId: string,
  input: CloudHostInput,
  itemId?: string,
  packageId?: string,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    await cloudOrder(reservationId);
    const products = await loadCloudProducts();
    const host = priceCloudHost(products, input);
    const payload = {
      period: host.period,
      quantity: host.quantity,
      summaryDescription: host.description,
      components: host.components.map((c) => ({
        cloudProductId: c.cloudProductId,
        productName: c.productName,
        categoryLabel: c.categoryLabel,
        qtyPerHost: c.qtyPerHost,
        rate: c.rate,
        costBasis: c.costBasis,
        marginPercent: c.marginPercent,
      })),
    };

    if (!itemId) {
      await addCloudHostToReservation(reservationId, {
        ...payload,
        backingAssetId: null,
        backingAssetCost: null,
        ...(packageId ? { packageId } : {}),
      });
      return { status: "ok", message: "Host added; the order was repriced." };
    }

    const existing = await prisma.reservationItem.findFirst({
      where: { id: itemId, reservationId, parentId: null },
      select: { assetId: true, costBasis: true, units: { select: { assetUnitId: true } } },
    });
    if (!existing) return { status: "error", message: "That host is not on this order." };
    const backed = existing.units.length > 0 || !!existing.assetId;
    await updateCloudHostInReservation(reservationId, itemId, {
      ...payload,
      backingAssetId: existing.assetId,
      backingAssetUnitIds: existing.units.map((u) => u.assetUnitId),
      backingAssetCost: backed && existing.costBasis != null ? Number(existing.costBasis) : null,
    });
    return { status: "ok", message: "Host updated; the order was repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Add an environment line — internet, shared storage, an add-on — at its monthly price. */
export async function addCloudEnvLine(
  reservationId: string,
  input: CloudEnvInput,
  packageId?: string,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    await cloudOrder(reservationId);
    const line = priceCloudEnv(await loadCloudProducts(), input);
    await addItemToReservation(
      reservationId,
      null,
      "MONTHLY",
      line.rate,
      line.quantity,
      line.description,
      line.category,
      false,
      packageId,
      line.costBasis,
      line.marginPercent,
      line.cloudProductId,
    );
    return { status: "ok", message: `${line.description} added; the order was repriced.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}
