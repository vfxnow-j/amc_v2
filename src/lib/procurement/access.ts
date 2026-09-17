import type { Role } from "@/lib/roles";

/**
 * Who may do what in Procurement (docs/procurement.md, Phase 6 — decided by the
 * owner, 2026-09-16).
 *
 * The owner's words were "roles matter, I don't want someone who doesn't know
 * the system to blow it up", so the line is drawn narrowly:
 *
 * - STAFF and up **raise** purchase orders and funding requests, and work on
 *   **their own drafts** — edit, submit, pull back. Submitting is where a
 *   non-approver's record is held for approval (`lib/approvals/core.ts`).
 * - Admins work on anyone's record, as before.
 * - Anything that moves money or undoes history stays admin-only: canceling,
 *   putting a PO on a loan, attaching evidence across records, marking a request
 *   funded or fulfilled.
 * - STAFF **receive** against a PO that is cleared — receiving is the warehouse's
 *   job — but creating a new model while doing it is an admin call, since a model
 *   is catalog and pricing, not a count.
 * - VIEWER reads.
 *
 * Prisma-free, so pages, server actions and client components share one rule.
 * The server actions check it again at the write; a hidden button is not a gate.
 */

type Viewer = { id: string; role: Role | string };

export function isProcurementAdmin(role: Role | string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** STAFF, ADMIN, SUPER_ADMIN. */
export function canRaise(role: Role | string): boolean {
  return role === "STAFF" || isProcurementAdmin(role);
}

/** Edit, submit and revise a purchase order. */
export function mayWorkOnPO(
  viewer: Viewer,
  po: { raisedById: string | null; status: string },
): boolean {
  if (isProcurementAdmin(viewer.role)) return po.status !== "CANCELLED";
  return viewer.role === "STAFF" && po.raisedById === viewer.id && po.status === "DRAFT";
}

/** Revising takes a submitted PO back to draft — its raiser may, as may an admin. */
export function mayRevisePO(
  viewer: Viewer,
  po: { raisedById: string | null; status: string },
): boolean {
  if (isProcurementAdmin(viewer.role)) return true;
  return viewer.role === "STAFF" && po.raisedById === viewer.id;
}

/** Receive hardware against a PO. Whether the PO is cleared is the gate's call. */
export function mayReceive(role: Role | string): boolean {
  return canRaise(role);
}

/**
 * Create a new model while receiving. A model is catalog and pricing, not a
 * count, so it stays an admin's call even though STAFF receive.
 */
export function mayCreateModelOnReceive(role: Role | string): boolean {
  return isProcurementAdmin(role);
}

/** Edit a funding request's form. */
export function mayEditFunding(
  viewer: Viewer,
  request: { requestedById: string | null; status: string },
): boolean {
  if (request.status === "FULFILLED" || request.status === "CANCELLED") return false;
  if (isProcurementAdmin(viewer.role)) return true;
  return (
    viewer.role === "STAFF" &&
    request.requestedById === viewer.id &&
    request.status === "DRAFT"
  );
}

/** Submit a draft, or pull a submitted or declined request back to draft. */
export function mayMoveOwnFunding(
  viewer: Viewer,
  request: { requestedById: string | null },
): boolean {
  if (isProcurementAdmin(viewer.role)) return true;
  return viewer.role === "STAFF" && request.requestedById === viewer.id;
}
