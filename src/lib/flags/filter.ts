import type { Prisma } from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";

/**
 * The flag filter, the third axis of Operate → Orders (after view and type).
 * Prisma-free at runtime (type import only) so the filter strip, a client
 * component, can import it.
 */

export const FLAG_FILTERS = ["all", "flagged", "unflagged", "critical", "mine", "stale"] as const;

export type FlagFilter = (typeof FLAG_FILTERS)[number];

export const isFlagFilter = oneOf(FLAG_FILTERS);

export const FLAG_FILTER_LABEL: Record<FlagFilter, string> = {
  all: "Any flag state",
  flagged: "Flagged",
  unflagged: "Not flagged",
  critical: "Critical",
  mine: "Mine",
  stale: "Overdue follow-up",
};

export function flagWhere(
  filter: FlagFilter,
  userId: string | null,
  now: Date,
): Prisma.ReservationWhereInput {
  switch (filter) {
    case "all":
      return {};
    case "flagged":
      return { flags: { some: { resolvedAt: null } } };
    case "unflagged":
      return { flags: { none: { resolvedAt: null } } };
    case "critical":
      return { flags: { some: { resolvedAt: null, severity: "CRITICAL" } } };
    case "mine":
      // Signed out there is no "mine"; match nothing rather than everything.
      return userId
        ? { flags: { some: { resolvedAt: null, ownerId: userId } } }
        : { id: { in: [] } };
    case "stale":
      return { flags: { some: { resolvedAt: null, nextActionDate: { lt: now } } } };
  }
}
