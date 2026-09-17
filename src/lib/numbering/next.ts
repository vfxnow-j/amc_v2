import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/billing/calendar";
import {
  literalPrefix,
  numberMatcher,
  parseNumbering,
  renderNumber,
  type NumberKind,
  type NumberingRule,
} from "@/lib/numbering/format";

/**
 * Issue the next document number for a kind of record.
 *
 * Replaces nine hand-written generators (three of them copies of the invoice
 * one) that each hardcoded a format. The rule comes from Settings → Business;
 * the sequence is one past the highest number already issued under the current
 * pattern and year, or the configured next number if that is higher. A number
 * that somehow exists already — records synced from v1 keep v1's numbers — is
 * skipped rather than issued twice.
 *
 * Pass the transaction client when issuing inside one, so numbers created
 * earlier in the same transaction are counted.
 */

export const NUMBERING_KEY = "document_numbering";

/** Anything with the delegates this reads — the client or a transaction. */
type Db = Pick<
  Prisma.TransactionClient,
  "setting" | "reservation" | "invoice" | "purchaseOrder" | "fundingRequest" | "workOrder" | "lease"
>;

export async function getNumbering(db: Db = prisma) {
  const row = await db.setting.findUnique({ where: { key: NUMBERING_KEY } });
  return parseNumbering(row?.value);
}

/** Every number of this kind that starts with `prefix`. */
async function existing(kind: NumberKind, prefix: string, db: Db): Promise<string[]> {
  const startsWith = prefix ? { startsWith: prefix, mode: "insensitive" as const } : undefined;
  switch (kind) {
    case "rental":
    case "sale":
    case "rentToOwn":
    case "cloud":
      return (
        await db.reservation.findMany({
          where: startsWith ? { reservationNumber: startsWith } : {},
          select: { reservationNumber: true },
        })
      ).map((row) => row.reservationNumber);
    case "invoice":
      return (
        await db.invoice.findMany({
          where: startsWith ? { invoiceNumber: startsWith } : {},
          select: { invoiceNumber: true },
        })
      ).map((row) => row.invoiceNumber);
    case "purchaseOrder":
      return (
        await db.purchaseOrder.findMany({
          where: startsWith ? { poNumber: startsWith } : {},
          select: { poNumber: true },
        })
      ).map((row) => row.poNumber);
    case "fundingRequest":
      return (
        await db.fundingRequest.findMany({
          where: startsWith ? { requestNumber: startsWith } : {},
          select: { requestNumber: true },
        })
      ).map((row) => row.requestNumber);
    case "workOrder":
      return (
        await db.workOrder.findMany({
          where: startsWith ? { number: startsWith } : {},
          select: { number: true },
        })
      ).map((row) => row.number);
    case "lease":
      return (
        await db.lease.findMany({
          where: startsWith ? { leaseNumber: startsWith } : {},
          select: { leaseNumber: true },
        })
      ).map((row) => row.leaseNumber);
  }
}

/** The highest sequence already issued under `rule` this year (0 if none). */
export async function highestIssued(
  kind: NumberKind,
  rule: NumberingRule,
  year: number,
  db: Db = prisma,
): Promise<{ highest: number; taken: Set<string> }> {
  const numbers = await existing(kind, literalPrefix(rule.pattern), db);
  const matcher = numberMatcher(rule, year);
  let highest = 0;
  for (const number of numbers) {
    const match = matcher.exec(number);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return { highest, taken: new Set(numbers.map((n) => n.toLowerCase())) };
}

export async function nextNumber(kind: NumberKind, db: Db = prisma): Promise<string> {
  const rule = (await getNumbering(db))[kind];
  const year = businessToday().getUTCFullYear();
  const { highest, taken } = await highestIssued(kind, rule, year, db);
  let sequence = Math.max(highest + 1, rule.next ?? 1);
  let candidate = renderNumber(rule, sequence, year);
  while (taken.has(candidate.toLowerCase())) {
    sequence += 1;
    candidate = renderNumber(rule, sequence, year);
  }
  return candidate;
}

export function kindForOrderType(type: string): NumberKind {
  return type === "SALE" ? "sale" : type === "RENT_TO_OWN" ? "rentToOwn" : type === "CLOUD" ? "cloud" : "rental";
}
