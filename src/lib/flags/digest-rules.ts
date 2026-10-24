// Pure wording of the order-flag digest email. No Prisma, no email: tests need neither.
import type { FlagSeverity } from "@/generated/prisma/client";
import { reasonByCode } from "./catalog";

export type DigestFlag = {
  orderNumber: string;
  clientName: string;
  reason: string;
  severity: FlagSeverity;
};

const RANK: Record<FlagSeverity, number> = { CRITICAL: 0, ATTENTION: 1, INFO: 2 };
const LABEL: Record<FlagSeverity, string> = { CRITICAL: "Critical", ATTENTION: "Attention", INFO: "Info" };

/** One line per flag, worst first, so the email opens on what needs a person today. */
export function digestLines(flags: DigestFlag[]): string[] {
  return [...flags]
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.orderNumber.localeCompare(b.orderNumber))
    .map((x) => `${x.orderNumber} · ${x.clientName} · ${reasonByCode(x.reason)?.label ?? x.reason} · ${LABEL[x.severity]}`);
}

export function digestSubject(flags: DigestFlag[]): string {
  const critical = flags.filter((x) => x.severity === "CRITICAL").length;
  const base = `${flags.length} new order flag${flags.length === 1 ? "" : "s"}`;
  return critical > 0 ? `${base}, ${critical} critical` : base;
}
