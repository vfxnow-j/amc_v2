import type { EntityDb } from "@/lib/entities/client";
import { escapeLike } from "@/lib/entities/match";

/*
 * Reads for the inventory screens. Each takes an EntityDb and is called only by
 * pages that already hold an EntityContext from requireEntity().
 *
 * Gear counts come from Unit and Stock (the current state), never from summing
 * the ledger, so a correction row (type MOVE, quantity 0, correctsId set) cannot
 * be counted as stock. The movement log shows corrections, marked by correctsId.
 */

export async function getItems(db: EntityDb, search?: string) {
  // The user's % and _ are literal text in a search, not wildcards.
  const term = search?.trim().slice(0, 100);
  const like = term ? escapeLike(term) : null;
  const where = like
    ? { OR: [{ name: { contains: like, mode: "insensitive" as const } }, { manufacturer: { contains: like, mode: "insensitive" as const } }, { model: { contains: like, mode: "insensitive" as const } }] }
    : undefined;
  const items = await db.item.findMany({ where, include: { category: true, stock: true }, orderBy: { name: "asc" } });
  // Unit counts by status, not every unit row: an item can hold hundreds.
  const counts = await db.unit.groupBy({ by: ["itemId", "status"], where: { itemId: { in: items.map((i) => i.id) } }, _count: { _all: true } });
  const unitCount = (id: string, status: string) => counts.find((c) => c.itemId === id && c.status === status)?._count._all ?? 0;
  return items.map((i) => ({
    id: i.id, name: i.name, manufacturer: i.manufacturer, model: i.model, category: i.category?.name ?? null, trackingMode: i.trackingMode,
    inStorage: i.trackingMode === "SERIALIZED" ? unitCount(i.id, "IN_STORAGE") : i.stock.filter((s) => !s.deployed).reduce((n, s) => n + s.quantity, 0),
    deployed: i.trackingMode === "SERIALIZED" ? unitCount(i.id, "DEPLOYED") : i.stock.filter((s) => s.deployed).reduce((n, s) => n + s.quantity, 0),
  }));
}

export async function getItem(db: EntityDb, id: string) {
  return db.item.findUnique({ where: { id }, include: { category: true, units: { orderBy: { createdAt: "asc" } }, stock: true } });
}

export async function getMovements(db: EntityDb, opts: { itemId?: string; unitId?: string; take?: number } = {}) {
  return db.movement.findMany({
    where: { itemId: opts.itemId, unitId: opts.unitId },
    include: { item: { select: { name: true } }, unit: { select: { serial: true, ownerTag: true } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 100,
  });
}

export async function getDashboard(db: EntityDb) {
  const [items, storedUnits, deployedUnits, stock, recent] = await Promise.all([
    db.item.count(),
    db.unit.count({ where: { status: "IN_STORAGE" } }),
    db.unit.count({ where: { status: "DEPLOYED" } }),
    db.stock.findMany(),
    getMovements(db, { take: 8 }),
  ]);
  const sum = (deployed: boolean) => stock.filter((s) => s.deployed === deployed).reduce((n, s) => n + s.quantity, 0);
  return { items, inStorage: storedUnits + sum(false), deployed: deployedUnits + sum(true), recent };
}

export async function getDeployed(db: EntityDb) {
  const [units, stock] = await Promise.all([
    db.unit.findMany({ where: { status: "DEPLOYED" }, include: { item: { select: { name: true } } } }),
    db.stock.findMany({ where: { deployed: true }, include: { item: { select: { name: true } } } }),
  ]);
  return { units, stock };
}

export async function getUnitsByLocation(db: EntityDb) {
  const [units, stock] = await Promise.all([
    db.unit.findMany({ where: { status: { not: "RETURNED_TO_OWNER" } }, include: { item: { select: { name: true } } } }),
    db.stock.findMany({ include: { item: { select: { name: true } } } }),
  ]);
  return { units, stock };
}
