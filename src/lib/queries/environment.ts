import type { AskStatus, EnvSection, ReservationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import { CLOSED_ASK_STATUSES } from "@/lib/tracker/labels";
import { ASK_SECTION, ENV_SECTIONS, sectionForCategory } from "@/lib/tracker/environment";
import { accountWhere } from "./tracker";

/**
 * The environment profile (docs/client-tracker.md, Phase 3).
 *
 * Three columns per section, and only the first of them is stored:
 *
 *  - **They own** — `EnvironmentItem`, typed in by a rep after a site visit or
 *    a conversation. The only thing here this database could not already know.
 *  - **We supply** — the account's real order lines, grouped by asset. Derived,
 *    so it cannot drift from the orders, and it needs no maintenance when a
 *    rental ends: the row simply stops saying "out with them now".
 *  - **They asked** — `ClientAsk`, followed through any lead that became this
 *    account exactly as the Conversations card follows them, so an ask captured
 *    before conversion is not lost the moment the account opens.
 *
 * An empty cell across a row is the cross-sell opening the whole feature exists
 * to show. It is left empty rather than filled with a dash for that reason.
 */

/** Lines on an order that never happened say nothing about what they run. */
const SUPPLIED: ReservationStatus[] = [...OPEN_STATUSES, "COMPLETED"];

export type OwnedItem = {
  id: string;
  section: EnvSection;
  name: string;
  vendor: string | null;
  quantity: number | null;
  os: string | null;
  gpu: string | null;
  capacityTb: number | null;
  percentUsed: number | null;
  protocol: string | null;
  backup: string | null;
  speed: string | null;
  refreshAt: Date | null;
  notes: string | null;
};

export type SuppliedItem = {
  name: string;
  category: string | null;
  /** The largest quantity ever on one order — "how many of these they run". */
  peak: number;
  orders: number;
  lastAt: Date;
  /** On an order that is live right now, not merely one that once ran. */
  live: boolean;
};

export type AskedItem = {
  id: string;
  description: string;
  quantity: number | null;
  status: AskStatus;
  open: boolean;
};

export type EnvSectionView = {
  section: EnvSection;
  owned: OwnedItem[];
  supplied: SuppliedItem[];
  asked: AskedItem[];
  /** Nothing in any of the three columns — the section renders as a prompt. */
  empty: boolean;
};

export type ClientEnvironment = {
  sections: EnvSectionView[];
  /**
   * Supplied lines whose inventory category this file cannot place. Shown
   * under the grid rather than dropped, because a line nobody can see is worse
   * than one in a box marked "other".
   */
  unplaced: SuppliedItem[];
  counts: { owned: number; supplied: number; openAsks: number };
};

export async function getClientEnvironment(clientId: string): Promise<ClientEnvironment> {
  const askWhere = accountWhere({ clientId });

  const [owned, lines, asks] = await Promise.all([
    prisma.environmentItem.findMany({
      where: { clientId },
      orderBy: [{ section: "asc" }, { name: "asc" }],
    }),
    prisma.reservationItem.findMany({
      where: {
        reservation: { clientId, status: { in: SUPPLIED } },
        // Component sub-items are part of their parent's specification, not a
        // separate thing we supply; counting them would list a workstation's
        // own GPU as a second machine.
        includedInParent: false,
      },
      select: {
        quantity: true,
        description: true,
        category: true,
        asset: { select: { name: true, category: { select: { name: true } } } },
        service: { select: { name: true } },
        cloudProduct: { select: { name: true } },
        reservation: { select: { status: true, createdAt: true } },
      },
    }),
    prisma.clientAsk.findMany({
      where: askWhere,
      orderBy: { createdAt: "desc" },
      select: { id: true, category: true, description: true, quantity: true, status: true },
    }),
  ]);

  // Group supplied lines by the thing supplied, keeping the peak quantity
  // rather than the sum: five orders of one workstation is one workstation
  // rented five times, not five machines on their floor.
  const bucket = new Map<string, SuppliedItem & { section: EnvSection | null }>();
  for (const line of lines) {
    const name =
      line.asset?.name ??
      line.service?.name ??
      line.cloudProduct?.name ??
      line.description ??
      null;
    if (!name) continue;

    const category = line.asset?.category?.name ?? line.category ?? null;
    // A cloud product or a service has no inventory category; both are things
    // we run for them, which is the Services section.
    const section = line.service || line.cloudProduct ? "SERVICES" : sectionForCategory(category);
    const live = OPEN_STATUSES.includes(line.reservation.status);
    const at = line.reservation.createdAt;

    const existing = bucket.get(name);
    if (existing) {
      existing.peak = Math.max(existing.peak, line.quantity);
      existing.orders += 1;
      existing.live ||= live;
      if (at > existing.lastAt) existing.lastAt = at;
    } else {
      bucket.set(name, { name, category, peak: line.quantity, orders: 1, lastAt: at, live, section });
    }
  }

  const supplied = [...bucket.values()].sort(
    (a, b) => Number(b.live) - Number(a.live) || b.lastAt.getTime() - a.lastAt.getTime(),
  );

  const sections = ENV_SECTIONS.map((section): EnvSectionView => {
    const sectionOwned = owned
      .filter((item) => item.section === section)
      .map((item) => ({
        id: item.id,
        section: item.section,
        name: item.name,
        vendor: item.vendor,
        quantity: item.quantity,
        os: item.os,
        gpu: item.gpu,
        capacityTb: item.capacityTb === null ? null : Number(item.capacityTb),
        percentUsed: item.percentUsed,
        protocol: item.protocol,
        backup: item.backup,
        speed: item.speed,
        refreshAt: item.refreshAt,
        notes: item.notes,
      }));
    const sectionSupplied = supplied.filter((item) => item.section === section);
    const sectionAsked = asks
      .filter((ask) => ASK_SECTION[ask.category] === section)
      .map((ask) => ({
        id: ask.id,
        description: ask.description,
        quantity: ask.quantity,
        status: ask.status,
        open: !CLOSED_ASK_STATUSES.includes(ask.status),
      }))
      // Open asks first, as everywhere else in the tracker.
      .sort((a, b) => Number(b.open) - Number(a.open));

    return {
      section,
      owned: sectionOwned,
      supplied: sectionSupplied,
      asked: sectionAsked,
      empty:
        sectionOwned.length === 0 && sectionSupplied.length === 0 && sectionAsked.length === 0,
    };
  });

  return {
    sections,
    unplaced: supplied.filter((item) => item.section === null),
    counts: {
      owned: owned.length,
      supplied: supplied.length,
      openAsks: asks.filter((ask) => !CLOSED_ASK_STATUSES.includes(ask.status)).length,
    },
  };
}
