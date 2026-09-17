"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import {
  BILLING_ANCHOR_KEY,
  getBillingAnchor,
  parseBillingAnchor,
} from "@/lib/settings/business";
import {
  NUMBER_KIND_LABEL,
  NUMBER_KINDS,
  numberingProblem,
  type NumberKind,
  type NumberingRule,
} from "@/lib/numbering/format";
import { getNumbering, NUMBERING_KEY } from "@/lib/numbering/next";

export type BusinessSaveResult =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/**
 * Change the day monthly and weekly orders bill on.
 *
 * Super admins only: the 1st is written into client agreements, and moving it
 * moves the next invoice of every running order. Nothing is rescheduled here:
 * each running order keeps the invoice date it already has, and that invoice
 * bills a prorated stretch up to the new day — the same stub a new order gets —
 * so nobody is billed twice or skipped in the month it changes.
 */
export async function saveBillingAnchor(input: {
  monthly: string;
  weekly: number;
}): Promise<BusinessSaveResult> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const next = parseBillingAnchor({ monthly: input.monthly, weekly: input.weekly });
  if (String(next.monthly) !== String(input.monthly) || next.weekly !== input.weekly) {
    return { status: "error", message: "Choose one of the listed days." };
  }

  const previous = await getBillingAnchor();

  await prisma.setting.upsert({
    where: { key: BILLING_ANCHOR_KEY },
    update: { value: next },
    create: { key: BILLING_ANCHOR_KEY, value: next },
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Settings",
    entityId: BILLING_ANCHOR_KEY,
    oldValues: previous,
    newValues: next,
    userId: auth.userId,
  });

  revalidatePath("/dashboard/settings/business");
  revalidatePath("/dashboard/settings");
  return {
    status: "ok",
    message:
      "Saved. Running orders keep their next invoice date, and that invoice bills a prorated stretch up to the new day.",
  };
}

/**
 * Save the document numbering patterns (Settings → Business → Numbering).
 *
 * Every rule is validated before anything is written, so one bad pattern can't
 * leave the set half-saved. Nothing already issued is renumbered: a changed
 * pattern applies to the next record created.
 */
export async function saveNumbering(
  input: Record<NumberKind, NumberingRule>,
): Promise<BusinessSaveResult> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const next = {} as Record<NumberKind, NumberingRule>;
  for (const kind of NUMBER_KINDS) {
    const rule = input[kind];
    if (!rule) return { status: "error", message: `${NUMBER_KIND_LABEL[kind]} is missing.` };
    const cleaned: NumberingRule = {
      pattern: String(rule.pattern ?? "").trim(),
      padding: Number(rule.padding),
      reset: rule.reset === "never" ? "never" : "yearly",
      next: rule.next === null || rule.next === undefined || String(rule.next) === "" ? null : Number(rule.next),
    };
    const problem = numberingProblem(cleaned);
    if (problem) return { status: "error", message: `${NUMBER_KIND_LABEL[kind]}: ${problem}` };
    next[kind] = cleaned;
  }

  const patterns = NUMBER_KINDS.map((kind) => next[kind].pattern.toLowerCase());
  if (new Set(patterns).size !== patterns.length) {
    return {
      status: "error",
      message: "Two kinds share a pattern. Give each its own prefix so a number says what it is.",
    };
  }

  const previous = await getNumbering();
  await prisma.setting.upsert({
    where: { key: NUMBERING_KEY },
    update: { value: next },
    create: { key: NUMBERING_KEY, value: next },
  });
  await logAudit({
    action: "UPDATE",
    entityType: "Settings",
    entityId: NUMBERING_KEY,
    oldValues: previous,
    newValues: next,
    userId: auth.userId,
  });

  revalidatePath("/dashboard/settings/business");
  return {
    status: "ok",
    message: "Saved. Records already numbered keep their numbers; new ones use these patterns.",
  };
}
