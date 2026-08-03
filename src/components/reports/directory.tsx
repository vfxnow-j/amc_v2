import Link from "next/link";

/**
 * The six reports, and the question each one exists to answer.
 *
 * One list, used by the index and by every child's back link, so a report can
 * never be named two things. The blurb is the question in the reader's words —
 * "Full Inventory Report" tells nobody whether it is the one with the book
 * values in it.
 *
 * Deliberately free of any Prisma import: this is the shared vocabulary of the
 * cluster and a client component may end up wanting it.
 */

export type ReportEntry = {
  href: string;
  title: string;
  /** What you come here to find out. */
  answers: string;
};

export const REPORTS: ReportEntry[] = [
  {
    href: "/dashboard/reports/forecast",
    title: "Forecast",
    answers:
      "What the next three months are likely to bring, weighted by how firm each order and lead is.",
  },
  {
    href: "/dashboard/reports/inventory",
    title: "Inventory",
    answers:
      "What every unit cost, what it is worth on the books now, and what it has earned back.",
  },
  {
    href: "/dashboard/reports/pricing",
    title: "Pricing",
    answers:
      "Which assets take too long to pay for themselves at the rate they are let at.",
  },
  {
    href: "/dashboard/reports/stock-count",
    title: "Stock count",
    answers:
      "How many of each thing are on the shelf right now — the sheet you walk the warehouse with.",
  },
  {
    href: "/dashboard/reports/traffic",
    title: "Traffic",
    answers:
      "Every unit movement: who had it, how long for, what it charged and what came back damaged.",
  },
  {
    href: "/dashboard/reports/unpriced",
    title: "Unpriced",
    answers:
      "Units that went out with no rate on them, so they earn nothing and attribute nothing.",
  },
];

export function reportEntry(href: string): ReportEntry | undefined {
  return REPORTS.find((report) => report.href === href);
}

/** Every child carries the same way back, in the same place. */
export function BackToReports() {
  return (
    <Link
      href="/dashboard/reports"
      className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink transition-colors hover:bg-row-hover"
    >
      All reports
    </Link>
  );
}
