import { prisma } from "@/lib/prisma";
import type { ReceiveMode } from "@/lib/revenue/labels";

/** Queries behind the Purchase order record. One per card, so each Suspends alone. */

export async function getPOHeader(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      poNumber: true,
      status: true,
      orderDate: true,
      expectedDate: true,
      receivedDate: true,
      orderType: true,
      purchaseMethod: true,
      creditTerms: true,
      subtotal: true,
      discountType: true,
      discountValue: true,
      discountAmount: true,
      freightAmount: true,
      feesTotal: true,
      taxAmount: true,
      taxExempt: true,
      total: true,
      notes: true,
      vendor: {
        select: {
          id: true,
          name: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
      shipToLocation: { select: { id: true, name: true } },
      items: { select: { quantity: true, receivedQuantity: true } },
    },
  });

  if (!po) return null;

  const ordered = po.items.reduce((sum, item) => sum + item.quantity, 0);
  const received = po.items.reduce((sum, item) => sum + item.receivedQuantity, 0);

  return {
    ...po,
    subtotal: Number(po.subtotal),
    discountValue: po.discountValue === null ? null : Number(po.discountValue),
    discountAmount: Number(po.discountAmount),
    freightAmount: Number(po.freightAmount),
    feesTotal: Number(po.feesTotal),
    taxAmount: Number(po.taxAmount),
    total: Number(po.total),
    lineCount: po.items.length,
    ordered,
    received,
    outstanding: Math.max(0, ordered - received),
  };
}

/**
 * The ordered lines, and how each one will land.
 *
 * `isInventoried`, `isResale` and neither are three different receiving modes,
 * not three flags — a line creates serialised `AssetUnit`s, or captures serials
 * against the line alone, or is a consumable that never touches the fleet. The
 * mode is resolved here so the record and the receive panel can't disagree
 * about what a line is.
 *
 * An inventoried line with no `assetId` cannot make units: there is no product
 * type for them to hang off. That is surfaced rather than silently downgraded,
 * because receiving it anyway records the quantity and loses the serials.
 */
export async function getPOLines(id: string) {
  const items = await prisma.pOItem.findMany({
    where: { purchaseOrderId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      amount: true,
      receivedQuantity: true,
      isInventoried: true,
      isResale: true,
      receivedSerials: true,
      asset: { select: { id: true, name: true } },
    },
  });

  return items.map((item) => {
    const mode: ReceiveMode = item.isInventoried
      ? item.asset
        ? "units"
        : "unlinked"
      : item.isResale
        ? "serials"
        : "consumable";

    return {
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
      received: item.receivedQuantity,
      remaining: Math.max(0, item.quantity - item.receivedQuantity),
      mode,
      serials: item.receivedSerials,
      assetId: item.asset?.id ?? null,
      assetName: item.asset?.name ?? null,
    };
  });
}

export async function getPOFees(id: string) {
  const fees = await prisma.pOFee.findMany({
    where: { purchaseOrderId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, amount: true },
  });
  return fees.map((fee) => ({
    id: fee.id,
    description: fee.description,
    amount: Number(fee.amount),
  }));
}

/**
 * What this PO put into the fleet.
 *
 * There is no link from `AssetUnit` back to the purchase order it arrived on —
 * only `Asset.purchaseOrderId`, at product-type level. So this reports the asset
 * types the PO created and how many units each holds *now*, which is not the
 * same as how many this PO delivered: a later PO for the same product type adds
 * units to the same asset. The card says so rather than presenting the count as
 * a receipt.
 */
export async function getPOAssets(id: string) {
  const assets = await prisma.asset.findMany({
    where: { purchaseOrderId: id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      model: true,
      _count: { select: { units: true } },
    },
  });

  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    maker: [asset.manufacturer, asset.model].filter(Boolean).join(" ") || null,
    units: asset._count.units,
  }));
}

export async function getPODocuments(id: string) {
  const documents = await prisma.document.findMany({
    where: { entityType: "PURCHASE_ORDER", entityId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      documentType: true,
      filename: true,
      isSigned: true,
      createdAt: true,
    },
  });
  return documents;
}

/** Where received hardware can land. The receive panel needs somewhere to put it. */
export async function getReceivingLocations() {
  return prisma.location.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
