"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ApprovalRecordType } from "@/generated/prisma/client";
import { requireEditor, requireSuperAdmin } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { actorFor, decide, type DecisionOutcome } from "@/lib/approvals/core";
import { APPROVAL_TYPES, APPROVAL_TYPE_LABEL, canHoldScopes } from "@/lib/approvals/labels";

/**
 * The browser-facing half of approvals: deciding a request, and setting who
 * may decide them.
 *
 * Only async functions are exported — a `"use server"` file that exports a
 * constant typechecks and runs in dev and then fails `next build`. The
 * vocabulary lives in `./labels`, the mechanism in `./core`.
 *
 * The decider is always the session. Nothing here accepts a name: v1's funding
 * approval took three typed names from whoever was signed in, which recorded
 * what somebody typed rather than who decided.
 */

export async function decideApproval(
  requestId: string,
  approve: boolean,
  reason?: string,
): Promise<DecisionOutcome> {
  // STAFF can hold an approver scope, so the floor is editor; `decide` checks
  // the scope itself.
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const actor = await actorFor(auth.userId, auth.role);
  const outcome = await decide(requestId, actor, approve, reason ?? null);

  revalidatePath("/dashboard/approvals");
  if (outcome.status === "ok") {
    revalidatePath(outcome.href);
    if (outcome.href.startsWith("/dashboard/funding")) revalidatePath("/dashboard/funding");
    if (outcome.href.startsWith("/dashboard/purchase-orders")) revalidatePath("/dashboard/purchase-orders");
  }
  return outcome;
}

export type ScopeOutcome = { status: "ok"; message: string } | { status: "error"; message: string };

/**
 * Tag the record types a user approves. Super admin only: the owner said he
 * names the approvers, and an admin who could tag themselves would be an
 * approver by their own say-so.
 */
export async function setApprovalScopes(
  userId: string,
  types: ApprovalRecordType[],
): Promise<ScopeOutcome> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, approvalScopes: { select: { recordType: true } } },
  });
  if (!user) return { status: "error", message: "That account no longer exists." };

  if (user.role === "SUPER_ADMIN") {
    return { status: "error", message: `${user.name} is a super admin, and so already approves everything.` };
  }

  const wanted = APPROVAL_TYPES.filter((type) => types.includes(type));
  if (wanted.length > 0 && !canHoldScopes(user.role)) {
    return {
      status: "error",
      message: `${user.name} is ${user.role === "VIEWER" ? "read-only" : "a Flow user"}. Only staff and administrators can approve — change the role first.`,
    };
  }

  const before = user.approvalScopes.map((scope) => scope.recordType);
  const adding = wanted.filter((type) => !before.includes(type));
  const removing = before.filter((type) => !wanted.includes(type));
  if (adding.length === 0 && removing.length === 0) {
    return { status: "ok", message: "Nothing changed." };
  }

  await prisma.$transaction([
    prisma.userApprovalScope.deleteMany({ where: { userId, recordType: { in: removing } } }),
    prisma.userApprovalScope.createMany({
      data: adding.map((recordType) => ({ userId, recordType, grantedById: auth.userId })),
    }),
  ]);

  // A revoked row is deleted, so the audit log is where "who took it away, and
  // when" survives.
  await logAudit({
    action: "UPDATE",
    entityType: "User",
    entityId: userId,
    oldValues: { approvalScopes: before },
    newValues: { approvalScopes: wanted },
    userId: auth.userId,
  });

  revalidatePath(`/dashboard/settings/users/${userId}`);
  revalidatePath("/dashboard/settings/users");

  return {
    status: "ok",
    message:
      wanted.length === 0
        ? `${user.name} no longer approves anything.`
        : `${user.name} now approves ${wanted.map((type) => APPROVAL_TYPE_LABEL[type].toLowerCase()).join(", ")}.`,
  };
}
