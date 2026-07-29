import type { ClusterId } from "@/lib/nav/clusters";

/**
 * Cluster totals shown in the rail.
 *
 * These are the illustrative figures from the design reference, kept so the rail
 * reads at the right density while the screens are built. They are NOT real:
 * replace this module with the Prisma counts (open reservations, units in
 * inventory, open work orders, …) and the rail picks them up unchanged.
 *
 * Per-page counts are deliberately absent — the reference doesn't specify any,
 * and inventing them would put fake numbers next to real labels. The rail
 * renders per-page counts whenever `pages` supplies them.
 */
export type NavCounts = {
  clusters: Partial<Record<ClusterId, number>>;
  pages: Record<string, number>;
};

export const SAMPLE_NAV_COUNTS: NavCounts = {
  clusters: {
    operate: 42,
    inventory: 1638,
    service: 23,
    revenue: 61,
    clients: 9,
    // Insight carries no count in the reference — it's a read surface.
  },
  pages: {},
};

const FORMATTER = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return FORMATTER.format(value);
}
