import { oneOf } from "@/lib/guards";

/**
 * The hub's sub-views, per design/README.md ("Reservations … Sub-views: Open,
 * Out now, Quotes, Archive").
 *
 * Deliberately free of Prisma: the tab strip is a client component, and a client
 * import that reaches `lib/prisma` drags the pg driver into the browser bundle
 * and fails the build on `dns`. The `where` clauses behind these live in
 * `lib/queries/reservations.ts`.
 */

export const VIEWS = ["open", "out-now", "quotes", "archive", "all"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  open: "Open",
  "out-now": "Out now",
  quotes: "Quotes",
  archive: "Archive",
  all: "All",
};

export const isView = oneOf(VIEWS);
