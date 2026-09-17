import { prisma } from "@/lib/prisma";
import type { ExtensionLine } from "@/lib/billing/extension";

/**
 * The lines an extension bills, for the Extend dialog and the action that
 * invoices it — one read, so the preview and the invoice price the same lines.
 * Parts included in their parent's price and hidden cloud config rows are left
 * out; a part with its own rate is billed like any line.
 */
export async function extensionLines(reservationId: string): Promise<ExtensionLine[]> {
  const items = await prisma.reservationItem.findMany({
    where: { reservationId, OR: [{ parentId: null }, { includedInParent: false }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      quantity: true,
      rate: true,
      pricingType: true,
      isOneTime: true,
      includedInParent: true,
      parentId: true,
      cloudProductId: true,
      description: true,
      asset: { select: { name: true } },
    },
  });
  return items
    .filter((item) => !(item.parentId && item.cloudProductId))
    .map((item) => ({
      id: item.id,
      label: item.asset?.name ?? item.description ?? "Line",
      quantity: item.quantity,
      rate: Number(item.rate),
      pricingType: item.pricingType,
      isOneTime: item.isOneTime,
      includedInParent: item.includedInParent,
    }));
}
