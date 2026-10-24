import { prisma } from "@/lib/prisma";

/** The Dashboard's Flagged tile: open cases by severity, money at risk, overdue follow-ups. */
export async function getFlagTile(): Promise<{
  open: number;
  critical: number;
  attention: number;
  info: number;
  exposure: number;
  stale: number;
}> {
  const now = new Date();
  const [bySeverity, sum, stale] = await Promise.all([
    prisma.orderFlag.groupBy({ by: ["severity"], where: { resolvedAt: null }, _count: { _all: true } }),
    prisma.orderFlag.aggregate({ where: { resolvedAt: null }, _sum: { exposureAmount: true } }),
    prisma.orderFlag.count({ where: { resolvedAt: null, nextActionDate: { lt: now } } }),
  ]);
  const n = (s: string) => bySeverity.find((r) => r.severity === s)?._count._all ?? 0;
  return {
    open: bySeverity.reduce((t, r) => t + r._count._all, 0),
    critical: n("CRITICAL"),
    attention: n("ATTENTION"),
    info: n("INFO"),
    exposure: Number(sum._sum.exposureAmount ?? 0),
    stale,
  };
}
