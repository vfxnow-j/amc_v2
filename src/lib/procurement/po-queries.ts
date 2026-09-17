import { prisma } from "@/lib/prisma";
import { lineKindOf, type LineKind } from "@/lib/procurement/po-labels";

/**
 * Reads behind the PO form, the PO record's financing and receipt cards, and
 * the trail a unit or model shows back to the order that bought it.
 *
 * Server-only (it reaches Prisma). The client components get plain objects from
 * the pages that call these.
 */

/** Everything the PO form picks from. */
export async function getPOFormOptions() {
  const [vendors, locations, assets] = await Promise.all([
    prisma.vendor.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Retired models are left out: nobody orders more of a thing that has
    // left the catalog, and offering it is how a new unit lands on a dead SKU.
    prisma.asset.findMany({
      where: { retiredAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        manufacturer: true,
        model: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  return {
    vendors,
    locations,
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      detail: [asset.manufacturer, asset.model, asset.category.name]
        .filter(Boolean)
        .join(" · "),
    })),
  };
}

export type POFormOptions = Awaited<ReturnType<typeof getPOFormOptions>>;

/** yyyy-mm-dd in UTC — the stored dates are noon UTC, so this is the day meant. */
function isoDay(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

/** A PO as the edit form starts from it. */
export async function getPOForEdit(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      poNumber: true,
      status: true,
      leaseId: true,
      raisedById: true,
      vendorId: true,
      shipToLocationId: true,
      orderDate: true,
      expectedDate: true,
      orderType: true,
      purchaseMethod: true,
      creditTerms: true,
      discountType: true,
      discountValue: true,
      freightAmount: true,
      taxAmount: true,
      taxExempt: true,
      notes: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          receivedQuantity: true,
          assetId: true,
          isInventoried: true,
          isResale: true,
        },
      },
      fees: {
        orderBy: { createdAt: "asc" },
        select: { description: true, amount: true },
      },
    },
  });
  if (!po) return null;

  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    raisedById: po.raisedById,
    onLease: po.leaseId !== null,
    initial: {
      vendorId: po.vendorId,
      shipToLocationId: po.shipToLocationId ?? "",
      orderDate: isoDay(po.orderDate),
      expectedDate: isoDay(po.expectedDate),
      orderType: po.orderType ?? "",
      purchaseMethod: po.purchaseMethod ?? "",
      creditTerms: po.creditTerms ?? "",
      discountType: (po.discountType ?? "") as "" | "PERCENTAGE" | "FIXED",
      discountValue: po.discountValue === null ? "" : String(Number(po.discountValue)),
      freightAmount: String(Number(po.freightAmount)),
      taxAmount: String(Number(po.taxAmount)),
      taxExempt: po.taxExempt,
      notes: po.notes ?? "",
      lines: po.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(Number(item.unitPrice)),
        assetId: item.assetId,
        kind: lineKindOf(item) as LineKind,
        received: item.receivedQuantity,
      })),
      fees: po.fees.map((fee) => ({
        description: fee.description,
        amount: String(Number(fee.amount)),
      })),
    },
  };
}

/**
 * What a funding request contributes to a PO raised from it.
 *
 * The request's itemised equipment becomes the PO's lines — description,
 * quantity, and the unit cost the requester estimated. That is a starting
 * point, not a quote: the form says the prices came from the request, and the
 * vendor's figures replace them. There is no vendor on a request to carry over.
 */
export async function getFundingPrefill(requestId: string) {
  const request = await prisma.fundingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { description: true, quantity: true, unitCost: true },
      },
    },
  });
  if (!request) return null;

  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    usable: request.status !== "DECLINED" && request.status !== "CANCELLED",
    lines: request.items.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(Number(item.unitCost)),
    })),
  };
}

/** The PO's financing: its lease, the funding requests citing it, and the choices. */
export async function getPOFinancing(id: string) {
  const [po, units, leases, requests] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        lease: {
          select: { id: true, leaseNumber: true, leaseName: true, lender: true, status: true },
        },
        fundingRequests: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            requestNumber: true,
            status: true,
            amountRequested: true,
            requestedBy: true,
          },
        },
      },
    }),
    prisma.assetUnit.count({ where: { purchaseOrderId: id } }),
    prisma.lease.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, leaseNumber: true, leaseName: true, lender: true, status: true },
    }),
    // v1's rule: a request that is done with (declined, cancelled) takes no
    // more evidence.
    prisma.fundingRequest.findMany({
      where: { status: { notIn: ["DECLINED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        amountRequested: true,
        projectName: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  if (!po) return null;

  return {
    lease: po.lease,
    unitsReceived: units,
    requests: po.fundingRequests.map((request) => ({
      ...request,
      amountRequested: Number(request.amountRequested),
    })),
    leaseOptions: leases,
    requestOptions: requests.map((request) => ({
      id: request.id,
      requestNumber: request.requestNumber,
      status: request.status,
      amountRequested: Number(request.amountRequested),
      for: request.client?.name ?? request.projectName ?? null,
    })),
  };
}

export type POFinancing = NonNullable<Awaited<ReturnType<typeof getPOFinancing>>>;

/** Units received against this PO, newest first — the fleet it actually delivered. */
export async function getPOReceivedUnits(id: string, take = 12) {
  const [rows, total] = await Promise.all([
    prisma.assetUnit.findMany({
      where: { purchaseOrderId: id },
      orderBy: [{ createdAt: "desc" }, { barcode: "asc" }],
      take,
      select: {
        id: true,
        barcode: true,
        serialNumber: true,
        status: true,
        asset: { select: { id: true, name: true } },
        location: { select: { name: true } },
      },
    }),
    prisma.assetUnit.count({ where: { purchaseOrderId: id } }),
  ]);
  return { rows, total };
}

/**
 * Categories a model created on receipt can go in.
 *
 * Every category, including the spec-label ones (`RAM: 64GB` and the like) the
 * SKU-build work retired from use: they still exist and hold parts, so hiding
 * them would strand a receiver whose part genuinely belongs there.
 */
export async function getReceiveCategories() {
  return prisma.assetCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Where a model's units came from, grouped by the purchase order that bought
 * them — plus the PO that created the model, if one did.
 *
 * Counts off `AssetUnit.purchaseOrderId`, so the units that predate it, were
 * added by hand or imported are counted separately as exactly that, rather than
 * folded into a total that implies every unit has a trail.
 */
export async function getAssetTrail(assetId: string) {
  const [asset, groups, total] = await Promise.all([
    prisma.asset.findUnique({
      where: { id: assetId },
      select: { purchaseOrderId: true },
    }),
    prisma.assetUnit.groupBy({
      by: ["purchaseOrderId"],
      where: { assetId, purchaseOrderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.assetUnit.count({ where: { assetId } }),
  ]);
  if (!asset) return null;

  const counts = new Map(
    groups.map((group) => [group.purchaseOrderId as string, group._count._all]),
  );
  const ids = new Set(counts.keys());
  if (asset.purchaseOrderId) ids.add(asset.purchaseOrderId);

  const orders =
    ids.size === 0
      ? []
      : await prisma.purchaseOrder.findMany({
          where: { id: { in: [...ids] } },
          orderBy: { orderDate: "desc" },
          select: {
            id: true,
            poNumber: true,
            status: true,
            orderDate: true,
            vendor: { select: { name: true } },
            lease: { select: { id: true, leaseNumber: true, leaseName: true } },
            fundingRequests: {
              orderBy: { createdAt: "desc" },
              select: { id: true, requestNumber: true },
            },
          },
        });

  const traced = [...counts.values()].reduce((sum, n) => sum + n, 0);

  return {
    total,
    traced,
    untraced: total - traced,
    orders: orders.map((order) => ({
      ...order,
      units: counts.get(order.id) ?? 0,
      createdModel: order.id === asset.purchaseOrderId,
    })),
  };
}
