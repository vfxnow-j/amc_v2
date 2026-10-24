import type { ClusterId } from "@/lib/nav/clusters";

/**
 * Shape of the counts shown in the rail. The figures themselves come from
 * `lib/queries/nav-counts.ts`; this module stays free of Prisma so the client
 * components can import `formatCount` without pulling the pg driver into the
 * browser bundle.
 *
 * A page with no entry renders no count. Absent, not zero: zero claims an empty
 * queue. The counts are per page, keyed by page id, so each number sits beside
 * the name of the thing it counts; section headers can show one too (`clusters`),
 * but none does, because a number on a section said nothing about what it was.
 */
export type NavCounts = {
  clusters: Partial<Record<ClusterId, number>>;
  pages: Record<string, number>;
};

const FORMATTER = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return FORMATTER.format(value);
}
