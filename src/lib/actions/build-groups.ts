"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { calculatePeriods } from "@/lib/actions/reservations";
import { computeItemSubtotal } from "@/lib/pricing/periods";
import { calculateReservationTotals } from "@/lib/pricing/reservation-totals";
import { BUILD_CATEGORY, BUILD_EDITABLE_STATUSES, rescaledPartQuantity, storedPartQuantity } from "@/lib/pricing/build-groups";
import type { StageOutcome } from "@/lib/actions/order-stage";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Build groups on a sales order: a named heading line hosting priced parts.
 *
 * Ported from v1 (cfcf722, 239ab74, 02b4207, 0e9dfbe). The group carries no price
 * of its own; its parts are stored with their quantity already multiplied by the
 * group's, so every total, checkout and invoice that reads the rows keeps working
 * unchanged — see lib/pricing/build-groups.ts.
 *
 * Structure can change only while nothing has been pulled: once an order is
 * preparing, the parts are being scanned out and moving them between builds would
 * leave a machine's counters describing a different machine.
 */

type Tx = Prisma.TransactionClient;

function touch(id: string) {
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work. Try again.";
}

async function editableSale(tx: Tx, reservationId: string) {
  const order = await tx.reservation.findUnique({ where: { id: reservationId } });
  if (!order) throw new Error("Order not found.");
  if (order.reservationType !== "SALE") throw new Error("Build groups are only available on sales orders.");
  if (!BUILD_EDITABLE_STATUSES.includes(order.status)) {
    throw new Error("Builds can only be changed on a draft, quoted, revised or approved order.");
  }
  return order;
}

/** The order's stored money, re-derived from the lines of the option it goes ahead with. */
async function reprice(tx: Tx, reservationId: string) {
  const order = await tx.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { packages: { where: { isActive: true }, select: { id: true } } },
  });
  const activeId = order.packages[0]?.id;
  const items = await tx.reservationItem.findMany({
    where: { reservationId, ...(activeId ? { packageId: activeId } : {}) },
    select: { subtotal: true, costBasis: true, quantity: true },
  });
  const subtotal = items.reduce((sum, i) => sum + Number(i.subtotal), 0);
  const { discountAmount, taxAmount, total } = calculateReservationTotals({
    itemsSubtotal: subtotal,
    discountType: order.discountType,
    discountValue: Number(order.discountValue) || 0,
    taxRate: Number(order.taxRate) || 0,
    deliveryCost: Number(order.deliveryCost) || 0,
    returnCost: Number(order.returnCost) || 0,
    shippingMarginType: order.shippingMarginType || null,
    shippingMargin: Number(order.shippingMargin) || 0,
    rentalCreditAmount: Number(order.rentalCreditAmount) || 0,
  });
  const itemCost = items.reduce((sum, i) => sum + (i.costBasis != null ? Number(i.costBasis) : 0) * i.quantity, 0);
  const totalCost =
    itemCost +
    (Number(order.internalShippingCost) || 0) +
    (Number(order.subRentalCost) || 0) +
    (Number(order.hardwareCost) || 0);
  await tx.reservation.update({
    where: { id: reservationId },
    data: { subtotal, discountAmount, taxAmount, total, totalCost, totalMargin: subtotal - totalCost, priceVerified: false },
  });
}

async function lineSubtotal(
  order: { startDate: Date; endDate: Date; isRecurring: boolean },
  line: { rate: unknown; isOneTime: boolean; pricingType: string },
  quantity: number,
): Promise<number> {
  const periods = line.isOneTime
    ? 1
    : await calculatePeriods(order.startDate, order.endDate, line.pricingType, order.isRecurring);
  return computeItemSubtotal(Number(line.rate), quantity, periods);
}

async function findGroup(tx: Tx, reservationId: string, groupId: string) {
  const group = await tx.reservationItem.findFirst({ where: { id: groupId, reservationId, isGroup: true } });
  if (!group) throw new Error("That build is not on this order.");
  return group;
}

export async function addBuildGroup(
  reservationId: string,
  name: string,
  quantity: number,
  /** The quote option it joins. Omitted, the one the order goes ahead with. */
  packageId?: string,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!name.trim()) return { status: "error", message: "Give the build a name." };
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { status: "error", message: "A build is for at least one machine." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      await editableSale(tx, reservationId);
      const pkg = packageId
        ? await tx.package.findFirst({ where: { id: packageId, reservationId } })
        : ((await tx.package.findFirst({ where: { reservationId, isActive: true } })) ??
          (await tx.package.create({ data: { reservationId, name: "Default", isActive: true, sortOrder: 0 } })));
      if (!pkg) throw new Error("That quote option is not on this order.");
      const last = await tx.reservationItem.aggregate({
        where: { reservationId, packageId: pkg.id },
        _max: { sortOrder: true },
      });
      await tx.reservationItem.create({
        data: {
          reservationId,
          packageId: pkg.id,
          isGroup: true,
          description: name.trim(),
          category: BUILD_CATEGORY,
          pricingType: "PROJECT",
          rate: 0,
          quantity,
          subtotal: 0,
          isOneTime: true,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    });
    touch(reservationId);
    return { status: "ok", message: `${name.trim()} added. Add its parts to price it.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Change how many machines a build makes; its parts scale in proportion. */
export async function setBuildGroupQuantity(
  reservationId: string,
  groupId: string,
  quantity: number,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { status: "error", message: "A build is for at least one machine." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const order = await editableSale(tx, reservationId);
      const group = await findGroup(tx, reservationId, groupId);
      const parts = await tx.reservationItem.findMany({ where: { parentId: groupId } });
      await tx.reservationItem.update({ where: { id: groupId }, data: { quantity } });
      for (const part of parts) {
        const scaled = rescaledPartQuantity(part.quantity, group.quantity, quantity);
        await tx.reservationItem.update({
          where: { id: part.id },
          data: { quantity: scaled, subtotal: await lineSubtotal(order, part, scaled) },
        });
      }
      await reprice(tx, reservationId);
    });
    touch(reservationId);
    return { status: "ok", message: `Now ${quantity} ${quantity === 1 ? "machine" : "machines"}; the parts and the order were repriced.` };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** A part's quantity per machine; what is stored is that times the machines. */
export async function setBuildPartQuantity(
  reservationId: string,
  partId: string,
  perMachine: number,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!Number.isInteger(perMachine) || perMachine < 1) {
    return { status: "error", message: "A part is for at least one per machine." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const order = await editableSale(tx, reservationId);
      const part = await tx.reservationItem.findFirst({
        where: { id: partId, reservationId },
        include: { parent: true },
      });
      if (!part?.parent?.isGroup) throw new Error("That line is not a part of a build.");
      const quantity = storedPartQuantity(perMachine, part.parent.quantity);
      const outstanding = part.checkedOutCount - part.checkedInCount;
      if (outstanding > 0 && quantity < outstanding) {
        throw new Error(`Cannot go below ${outstanding} — that many are checked out.`);
      }
      await tx.reservationItem.update({
        where: { id: partId },
        data: { quantity, subtotal: await lineSubtotal(order, part, quantity) },
      });
      await reprice(tx, reservationId);
    });
    touch(reservationId);
    return { status: "ok", message: "Quantity set; the order was repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Put a line under a build (its quantity is then read per machine), or take it out (groupId null). */
export async function moveLineToBuild(
  reservationId: string,
  itemId: string,
  groupId: string | null,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    await prisma.$transaction(async (tx) => {
      const order = await editableSale(tx, reservationId);
      const item = await tx.reservationItem.findFirst({
        where: { id: itemId, reservationId },
        include: { parent: true, _count: { select: { components: true } } },
      });
      if (!item) throw new Error("That line is not on this order.");
      if (item.isGroup) throw new Error("A build cannot go inside another build.");
      if (item._count.components > 0 || (item.parentId && !item.parent?.isGroup)) {
        throw new Error("This line has its own configured parts, so it cannot be put in a build.");
      }
      if (item.cloudProductId) throw new Error("Cloud lines cannot be put in a build.");

      // Back to per-machine on the way out of a build, then up to the new one's.
      let quantity = item.quantity;
      if (item.parent?.isGroup) quantity = Math.max(1, Math.round(quantity / item.parent.quantity));
      let target = null;
      if (groupId) {
        target = await findGroup(tx, reservationId, groupId);
        if (target.packageId !== item.packageId) throw new Error("A build and its parts have to be on the same quote option.");
        quantity = quantity * target.quantity;
      }
      await tx.reservationItem.update({
        where: { id: itemId },
        data: { parentId: groupId, quantity, subtotal: await lineSubtotal(order, item, quantity) },
      });
      await reprice(tx, reservationId);
    });
    touch(reservationId);
    return { status: "ok", message: groupId ? "Moved into the build." : "Taken out of the build." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Copy a build with its parts (no units assigned, nothing checked out). */
export async function duplicateBuildGroup(reservationId: string, groupId: string): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    await prisma.$transaction(async (tx) => {
      await editableSale(tx, reservationId);
      const group = await findGroup(tx, reservationId, groupId);
      const parts = await tx.reservationItem.findMany({
        where: { parentId: groupId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const last = await tx.reservationItem.aggregate({
        where: { reservationId, ...(group.packageId ? { packageId: group.packageId } : {}) },
        _max: { sortOrder: true },
      });
      let order = (last._max.sortOrder ?? -1) + 1;
      const copy = await tx.reservationItem.create({
        data: {
          reservationId,
          packageId: group.packageId,
          isGroup: true,
          description: `${group.description || "Build"} (copy)`,
          category: group.category,
          pricingType: group.pricingType,
          rate: 0,
          quantity: group.quantity,
          subtotal: 0,
          isOneTime: true,
          notes: group.notes,
          sortOrder: order++,
        },
      });
      for (const p of parts) {
        await tx.reservationItem.create({
          data: {
            reservationId,
            packageId: p.packageId,
            parentId: copy.id,
            assetId: p.assetId,
            serviceId: p.serviceId,
            description: p.description,
            category: p.category,
            pricingType: p.pricingType,
            rate: p.rate,
            quantity: p.quantity,
            subtotal: p.subtotal,
            isOneTime: p.isOneTime,
            costBasis: p.costBasis,
            marginPercent: p.marginPercent,
            notes: p.notes,
            sortOrder: order++,
          },
        });
      }
      await reprice(tx, reservationId);
    });
    touch(reservationId);
    return { status: "ok", message: "Build copied with its parts; the order was repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Show or hide part prices on what the client sees; each build still shows its total. */
export async function setHideBuildPartPrices(reservationId: string, hide: boolean): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    const order = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { reservationType: true },
    });
    if (!order) return { status: "error", message: "Order not found." };
    if (order.reservationType !== "SALE") return { status: "error", message: "Only sales orders have builds." };
    await prisma.reservation.update({ where: { id: reservationId }, data: { hideBuildPartPrices: hide } });
    touch(reservationId);
    return {
      status: "ok",
      message: hide
        ? "The quote now lists each build's parts as a spec, with the build total."
        : "The quote now shows each part's price.",
    };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}
