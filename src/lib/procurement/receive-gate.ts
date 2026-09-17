import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma/client";
import { releaseGate, type Actor } from "@/lib/approvals/core";
import { mayReceive } from "@/lib/procurement/access";

/**
 * May this person receive hardware against this purchase order right now?
 *
 * The one answer to that question, for anything that needs to ask before it
 * offers receiving — the record's Receive card, the receive screen, the scan
 * desk's receive mode. Returns the sentence to show when the answer is no, or
 * null when receiving may go ahead. Three things, in the order a person would
 * want to hear them:
 *
 * 1. **Role.** STAFF and up (docs/procurement.md, Phase 6 — receiving is the
 *    warehouse's work). Creating a *new model* while receiving is narrower,
 *    admins only; that is per line, so it is `mayCreateModelOnReceive` in
 *    `./access`, checked by the receive action.
 * 2. **State.** Only a SUBMITTED or PARTIAL PO accepts a receipt.
 * 3. **Approval.** A PO whose money changed after approval, or whose approval
 *    is outstanding, is held. One sent before approvals existed and untouched
 *    since is not.
 *
 * Read-only by default (`peek`): it never writes an approval row, so a read
 * action can call it. The receive actions call the gate themselves at the
 * write, where an approver receiving a PO records the clearance.
 *
 * A plain server module, not `"use server"` — call it from your own action.
 */
export async function receivingRefusal(
  purchaseOrderId: string,
  viewer: { id: string; role: UserRole; name?: string },
): Promise<string | null> {
  if (!mayReceive(viewer.role)) {
    return "Receiving is for staff and administrators. An administrator can change your role under Settings → Users.";
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { poNumber: true, status: true },
  });
  if (!po) return "That purchase order no longer exists.";
  if (po.status !== "SUBMITTED" && po.status !== "PARTIAL") {
    return po.status === "DRAFT"
      ? `${po.poNumber} is still a draft. Submit it before receiving against it.`
      : `${po.poNumber} is ${po.status === "CANCELLED" ? "canceled" : "fully received"} — nothing more can be received.`;
  }

  const actor: Actor = { id: viewer.id, role: viewer.role, name: viewer.name ?? "" };
  const gate = await releaseGate({
    type: "PURCHASE_ORDER",
    id: purchaseOrderId,
    actor,
    act: "receiving against it",
    raise: false,
    always: false,
    peek: true,
  });
  return gate.status === "held" ? gate.message : null;
}
