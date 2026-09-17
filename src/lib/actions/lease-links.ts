"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";

/**
 * What a lease financed, linked from the lease record: the funding requests it
 * funded and the purchase orders drawn against it (owner, 2026-09-17).
 *
 * Both links already exist in the schema (`FundingRequest.leaseId`,
 * `PurchaseOrder.leaseId`) and nothing set them. A record belongs to one lease
 * at a time, so linking one that is on another lease moves it, and says so.
 * The v1 sync leaves these columns to v2 (lib/v1-sync/engine.ts).
 */

export type LinkKind = "fundingRequest" | "purchaseOrder";

export type LinkOutcome = { status: "ok"; message: string } | { status: "error"; message: string };

function touch(leaseId: string) {
  revalidatePath(`/dashboard/leases/${leaseId}`);
}

export async function findLinkable(leaseId: string, kind: LinkKind, query: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const needle = query.trim();
  if (needle.length < 2) return [];

  if (kind === "fundingRequest") {
    const rows = await prisma.fundingRequest.findMany({
      where: {
        OR: [
          { requestNumber: { contains: needle, mode: "insensitive" } },
          { businessPurpose: { contains: needle, mode: "insensitive" } },
          { requestedBy: { contains: needle, mode: "insensitive" } },
        ],
      },
      take: 8,
      orderBy: { requestDate: "desc" },
      select: { id: true, requestNumber: true, businessPurpose: true, amountRequested: true, leaseId: true, lease: { select: { leaseNumber: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.requestNumber,
      detail: row.businessPurpose ?? "",
      amount: Number(row.amountRequested),
      onLease: row.leaseId === leaseId ? "this" : row.lease?.leaseNumber ?? null,
    }));
  }

  const rows = await prisma.purchaseOrder.findMany({
    where: {
      OR: [
        { poNumber: { contains: needle, mode: "insensitive" } },
        { vendor: { name: { contains: needle, mode: "insensitive" } } },
      ],
    },
    take: 8,
    orderBy: { orderDate: "desc" },
    select: { id: true, poNumber: true, total: true, leaseId: true, vendor: { select: { name: true } }, lease: { select: { leaseNumber: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.poNumber,
    detail: row.vendor.name,
    amount: Number(row.total),
    onLease: row.leaseId === leaseId ? "this" : row.lease?.leaseNumber ?? null,
  }));
}

export async function linkToLease(leaseId: string, kind: LinkKind, recordId: string): Promise<LinkOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { leaseNumber: true } });
  if (!lease) return { status: "error", message: "That lease doesn't exist." };

  if (kind === "fundingRequest") {
    const before = await prisma.fundingRequest.findUnique({
      where: { id: recordId },
      select: { requestNumber: true, lease: { select: { id: true, leaseNumber: true } } },
    });
    if (!before) return { status: "error", message: "That funding request doesn't exist." };
    await prisma.fundingRequest.update({ where: { id: recordId }, data: { leaseId } });
    if (before.lease && before.lease.id !== leaseId) touch(before.lease.id);
    touch(leaseId);
    return {
      status: "ok",
      message: `${before.requestNumber} linked${before.lease && before.lease.id !== leaseId ? ` (moved from ${before.lease.leaseNumber})` : ""}.`,
    };
  }

  const before = await prisma.purchaseOrder.findUnique({
    where: { id: recordId },
    select: { poNumber: true, lease: { select: { id: true, leaseNumber: true } } },
  });
  if (!before) return { status: "error", message: "That purchase order doesn't exist." };
  await prisma.purchaseOrder.update({ where: { id: recordId }, data: { leaseId } });
  if (before.lease && before.lease.id !== leaseId) touch(before.lease.id);
  touch(leaseId);
  revalidatePath(`/dashboard/purchase-orders/${recordId}`);
  return {
    status: "ok",
    message: `${before.poNumber} linked${before.lease && before.lease.id !== leaseId ? ` (moved from ${before.lease.leaseNumber})` : ""}.`,
  };
}

export async function unlinkFromLease(leaseId: string, kind: LinkKind, recordId: string): Promise<LinkOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (kind === "fundingRequest") {
    await prisma.fundingRequest.updateMany({ where: { id: recordId, leaseId }, data: { leaseId: null } });
  } else {
    await prisma.purchaseOrder.updateMany({ where: { id: recordId, leaseId }, data: { leaseId: null } });
    revalidatePath(`/dashboard/purchase-orders/${recordId}`);
  }
  touch(leaseId);
  return { status: "ok", message: "Unlinked." };
}
