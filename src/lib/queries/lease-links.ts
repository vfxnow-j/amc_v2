import { prisma } from "@/lib/prisma";

/** The funding requests and purchase orders linked to a lease, with their PDFs. */
export async function getLeaseLinks(leaseId: string) {
  const [fundingRequests, purchaseOrders] = await Promise.all([
    prisma.fundingRequest.findMany({
      where: { leaseId },
      orderBy: { requestDate: "desc" },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        businessPurpose: true,
        amountRequested: true,
        amountBorrowed: true,
        requestDate: true,
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { leaseId },
      orderBy: { orderDate: "desc" },
      select: { id: true, poNumber: true, status: true, total: true, orderDate: true, vendor: { select: { name: true } } },
    }),
  ]);

  const ids = [...fundingRequests.map((row) => row.id), ...purchaseOrders.map((row) => row.id)];
  const documents = ids.length
    ? await prisma.document.findMany({
        where: { entityId: { in: ids }, entityType: { in: ["FUNDING_REQUEST", "PURCHASE_ORDER"] }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, entityId: true, filename: true },
      })
    : [];
  const docsFor = (id: string) => documents.filter((doc) => doc.entityId === id).map((doc) => ({ id: doc.id, filename: doc.filename }));

  return {
    fundingRequests: fundingRequests.map((row) => ({
      id: row.id,
      number: row.requestNumber,
      status: row.status,
      purpose: row.businessPurpose,
      requested: Number(row.amountRequested),
      borrowed: row.amountBorrowed === null ? null : Number(row.amountBorrowed),
      date: row.requestDate,
      documents: docsFor(row.id),
    })),
    purchaseOrders: purchaseOrders.map((row) => ({
      id: row.id,
      number: row.poNumber,
      status: row.status,
      vendor: row.vendor.name,
      total: Number(row.total),
      date: row.orderDate,
      documents: docsFor(row.id),
    })),
  };
}
