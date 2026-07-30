import type { WorkOrderStatus } from "@/generated/prisma/client";

/**
 * Work order statuses that still hold the unit out of bookable stock.
 *
 * Lives here rather than in `lib/actions/service.ts` because that file is
 * `"use server"`, and such a module may only export async functions. Exporting
 * this array from there typechecks, lints and runs in dev, then fails the
 * production build with "A 'use server' file can only export async functions,
 * found object."
 */
export const OPEN_WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "OPEN",
  "IN_TEST",
  "AWAITING_PARTS",
  "RMA",
];

export function isOpenWorkOrder(status: WorkOrderStatus): boolean {
  return OPEN_WORK_ORDER_STATUSES.includes(status);
}
