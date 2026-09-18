import type { CoverageEnrollmentStatus } from "@/generated/prisma/client";

/**
 * One vocabulary for where a unit's plan stands, used on the unit record, the
 * work order and Coverage & RMA. "Bought, unconfirmed" rather than "Pending":
 * the money has gone, what is missing is somebody seeing it on the provider's
 * record.
 */
export const ENROLLMENT_STATUS_LABEL: Record<CoverageEnrollmentStatus, string> = {
  PURCHASED: "Bought, unconfirmed",
  ENROLLED: "Enrolled",
  NOT_ENROLLED: "Not enrolled",
  CANCELLED: "Canceled",
};

export const ENROLLMENT_STATUSES: CoverageEnrollmentStatus[] = ["PURCHASED", "ENROLLED", "NOT_ENROLLED", "CANCELLED"];

/**
 * Whether the plan should be treated as covering the unit today. Bought counts:
 * an auto-enroll plan the seller was paid for is the unit's coverage until
 * somebody finds otherwise, and the bench should try it first. An unknown end
 * date counts as running — the alternative is calling every plan without a
 * date lapsed, which is the more expensive mistake.
 */
export function enrollmentCovers(
  row: { status: CoverageEnrollmentStatus; endDate: Date | null },
  now = new Date(),
): boolean {
  if (row.status !== "PURCHASED" && row.status !== "ENROLLED") return false;
  return row.endDate === null || row.endDate > now;
}

/** Apple's own lookup, by serial. The page takes the serial by hand. */
export function providerCheckUrl(provider: string | null): string | null {
  return provider && /^apple\b/i.test(provider.trim()) ? "https://checkcoverage.apple.com/" : null;
}
