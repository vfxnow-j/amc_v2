import type { ClusterId } from "@/lib/nav/clusters";

/**
 * Shape of the counts shown in the rail. The figures themselves come from
 * `lib/queries/nav-counts.ts`; this module stays free of Prisma so the client
 * components can import `formatCount` without pulling the pg driver into the
 * browser bundle.
 *
 * A cluster with no entry renders no count — which is how Service center reads
 * until `WorkOrder` exists. Absent, not zero: zero claims an empty queue, and
 * there is no queue there yet to be empty.
 *
 * Per-page counts are deliberately absent. The reference doesn't specify any,
 * and inventing them would put fake numbers next to real labels. The rail
 * renders them whenever `pages` supplies them.
 */
export type NavCounts = {
  clusters: Partial<Record<ClusterId, number>>;
  pages: Record<string, number>;
};

const FORMATTER = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return FORMATTER.format(value);
}
