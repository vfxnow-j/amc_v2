import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { UNSETTLED } from "@/lib/queries/accounting";

/**
 * What is owed, and how long it has been owed for.
 *
 * **One definition of unsettled, app-wide.** The `UNSETTLED` clause comes from
 * `queries/accounting` rather than being retyped here, and that is not tidiness:
 * `OVERDUE` is a stored status maintained by a nightly job that v2 does not
 * run, so an invoice can be months past its due date while still reading SENT.
 * Overdue is therefore *unsettled and past `dueDate`*, judged on the date and
 * never on the column alone — the same way the invoice list, the client record
 * and the notification raiser all judge it. A tile that used the column would
 * disagree with the very record it links to.
 *
 * Aging is bucketed on `dueDate`, not on `issueDate`. Payment terms differ per
 * client, so an invoice issued sixty days ago on net-90 terms is not late at
 * all, and an aging report built on issue date would put it in a chase queue.
 */

/** Days past due, floored. Negative before the invoice is due. */
function daysPastDue(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
}

export type AgingBucketKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export type AgingBucket = {
  key: AgingBucketKey;
  label: string;
  count: number;
  /** Outstanding, not invoiced: `total − amountPaid`. */
  owed: number;
};

export type ArAging = {
  buckets: AgingBucket[];
  /** Everything unsettled, whether due yet or not. */
  owed: number;
  count: number;
  /** Of that, what is already past its due date. */
  overdue: number;
  overdueCount: number;
  /**
   * Drafts: raised against nothing, sent to nobody, and outside every figure
   * above. Named because in this database they are almost all of it, and a
   * tile saying "owed" without them beside it reads as the whole position.
   */
  drafts: { count: number; value: number };
  /** The one to chase first, or null when nothing is late. */
  oldest: {
    id: string;
    invoiceNumber: string;
    clientName: string;
    daysPastDue: number;
    owed: number;
  } | null;
};

const BUCKET_LABEL: Record<AgingBucketKey, string> = {
  current: "Not due yet",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
};

const BUCKET_ORDER: AgingBucketKey[] = ["current", "1-30", "31-60", "61-90", "90+"];

function bucketFor(days: number): AgingBucketKey {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/**
 * The AR position, aged.
 *
 * Reads the unsettled invoices rather than aggregating per bucket in SQL. Five
 * grouped counts would be five round trips to place rows that are, by
 * definition, the ones nobody has collected — a bounded set in any business
 * that is still solvent, and one that has to be walked anyway to name the
 * oldest.
 *
 * `cache`d so two tiles asking about money in a single render pass run it once.
 */
export const getArAging = cache(async function getArAging(
  now = new Date(),
): Promise<ArAging> {
  const [invoices, drafts] = await Promise.all([
    prisma.invoice.findMany({
      where: UNSETTLED,
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        client: { select: { name: true } },
      },
    }),
    prisma.invoice.aggregate({
      where: { status: "DRAFT" },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
  ]);

  const empty = () =>
    BUCKET_ORDER.map((key) => ({
      key,
      label: BUCKET_LABEL[key],
      count: 0,
      owed: 0,
    }));

  const buckets = empty();
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  let owed = 0;
  let overdue = 0;
  let overdueCount = 0;
  let oldest: ArAging["oldest"] = null;

  for (const invoice of invoices) {
    const outstanding = Number(invoice.total) - Number(invoice.amountPaid);
    const days = daysPastDue(invoice.dueDate, now);
    const bucket = byKey.get(bucketFor(days));
    if (bucket) {
      bucket.count += 1;
      bucket.owed += outstanding;
    }

    owed += outstanding;

    if (days > 0) {
      overdue += outstanding;
      overdueCount += 1;
      // The list is ordered by due date, so the first late one is the oldest.
      oldest ??= {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.client.name,
        daysPastDue: days,
        owed: outstanding,
      };
    }
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    buckets: buckets.map((bucket) => ({ ...bucket, owed: round(bucket.owed) })),
    owed: round(owed),
    count: invoices.length,
    overdue: round(overdue),
    overdueCount,
    drafts: {
      count: drafts._count,
      value: round(
        Number(drafts._sum.total ?? 0) - Number(drafts._sum.amountPaid ?? 0),
      ),
    },
    oldest,
  };
});
