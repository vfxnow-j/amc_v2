/**
 * The transactional write logic behind the inventory actions: load the current
 * state, ask the pure rules (movements.ts) whether the move is allowed, then
 * write the movement and the resulting state together.
 *
 * It takes an EntityDb and already-authorised inputs and imports nothing from
 * next or auth, so the actions call it after requireEntity() and the
 * integration script (scripts/entities-actions-check.ts) calls the very same
 * functions against a throwaway database. Anything the actions do to the
 * ledger happens here, not in the action.
 */
import type { EntityDb } from "@/lib/entities/client";
import { itemIdentity, normKey } from "@/lib/entities/match";
import { applyStockMovement, applyUnitMovement, type StockRow, type UnitState } from "@/lib/entities/movements";

export type LedgerResult = { ok: true; itemId: string } | { ok: false; reason: string };
const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export const MAX_QUANTITY = 1_000_000;
export const MAX_UNITS_PER_RECEIPT = 500;

/** A quantity the ledger will accept, or the reason it will not. Checked before the pure rules see it. */
export function quantityProblem(q: unknown): string | null {
  if (typeof q !== "number" || !Number.isSafeInteger(q) || q <= 0) return "The quantity has to be a whole number above zero.";
  if (q > MAX_QUANTITY) return `The quantity can't be more than ${MAX_QUANTITY.toLocaleString("en-US")} at once.`;
  return null;
}

export const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/** What every movement carries besides its type and quantities. */
export type MovementMeta = {
  actorUserId: string;
  occurredAt?: Date;
  reference?: string | null;
  notes?: string | null;
  recipient?: string | null;
  destination?: string | null;
  carrier?: string | null;
  tracking?: string | null;
  finalToOwner?: boolean;
};

/** Creates a destination site and returns its id (the one write to the main database; injected so scripts need no main DB). */
export type MakeSite = (name: string, address?: string) => Promise<string>;
export type NewSite = { name?: string | null; address?: string | null };

/** Stands in for a site that does not exist yet while the rules are checked, so a refused move creates no site. */
const PENDING_SITE = "__pending_new_site__";

type Tx = Parameters<Parameters<EntityDb["$transaction"]>[0]>[0];

/** Thrown inside a transaction to roll everything back with a message for the screen. */
class Refusal extends Error {}

function friendly(error: unknown): string | null {
  const e = error as { code?: string; meta?: unknown };
  if (e?.code === "P2002") {
    const where = JSON.stringify(e.meta ?? {});
    if (/scanTag/i.test(where)) return "That scan tag is already on another unit.";
    return "That would duplicate a record that already exists. Reload and try again.";
  }
  if (e?.code === "P2034") return "Someone else changed this at the same moment. Try again.";
  return null;
}

// A 500-unit receipt is ~1000 writes in one transaction; the default 5s interactive timeout is too short.
const TX_OPTIONS = { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 } as const;

async function transact<T>(db: EntityDb, run: (tx: Tx) => Promise<T>): Promise<T | { ok: false; reason: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Refusal) return no(error.message);
      // One automatic retry when two writers collide; the second attempt re-reads current state.
      if ((error as { code?: string })?.code === "P2034" && attempt === 0) continue;
      const reason = friendly(error);
      if (reason) return no(reason);
      throw error;
    }
  }
}

async function destination(toLocationId: string | null | undefined, site: NewSite | undefined, finalToOwner: boolean | undefined) {
  if (finalToOwner) return { toId: null, wantsSite: false };
  if (toLocationId) return { toId: toLocationId, wantsSite: false };
  if (site?.name?.trim()) return { toId: PENDING_SITE, wantsSite: true };
  return { toId: null, wantsSite: false };
}

type UnitIn = { serial?: string | null; ownerTag?: string | null; scanTag?: string | null; condition?: string | null };

type Held = { status: string };

/**
 * Serials and owner tags of the units this item already holds in custody (anything not handed back),
 * compared on match.ts's normKey, in two maps built once per call and kept current as units are added
 * or reactivated in the same transaction. The message names the existing unit's status, never an id.
 */
async function identityGuard(tx: Tx, itemId: string) {
  const rows = await tx.unit.findMany({ where: { itemId, status: { not: "RETURNED_TO_OWNER" } }, select: { serial: true, ownerTag: true, status: true } });
  const serials = new Map<string, Held>();
  const tags = new Map<string, Held>();
  const put = (map: Map<string, Held>, value: string | null | undefined, h: Held) => { const k = normKey(value); if (k && !map.has(k)) map.set(k, h); };
  for (const r of rows) { put(serials, r.serial, r); put(tags, r.ownerTag, r); }
  const state = (h: Held) => (h.status === "DEPLOYED" ? "deployed" : "in storage");
  return {
    check(u: { serial?: string | null; ownerTag?: string | null }) {
      for (const [label, value, map] of [["serial", u.serial, serials], ["owner tag", u.ownerTag, tags]] as const) {
        const clash = map.get(normKey(value));
        if (clash && normKey(value)) throw new Refusal(`This item already has a unit with ${label} ${blank(value)} in custody (${state(clash)}). Nothing was received.`);
      }
    },
    add(u: { serial?: string | null; ownerTag?: string | null }, status: string) {
      put(serials, u.serial, { status }); put(tags, u.ownerTag, { status });
    },
  };
}
type Guard = Awaited<ReturnType<typeof identityGuard>>;

/** One received unit and its RECEIVE movement. Shared by receiveUnitsTx and the CSV import, so there is one write path. */
async function receiveOneUnit(
  tx: Tx, itemId: string, next: UnitState,
  toLocationId: string, meta: MovementMeta, u: UnitIn, guard: Guard,
): Promise<void> {
  const scanTag = blank(u.scanTag);
  if (!blank(u.serial) && !blank(u.ownerTag) && !scanTag) throw new Refusal("Give each unit a serial, owner tag or scan tag.");
  const held = scanTag ? await tx.unit.findUnique({ where: { scanTag } }) : null;
  let unitId: string;
  if (held) {
    // A unit handed back to its owner and now received again keeps its scan tag: the same
    // unit comes back into custody rather than a second one colliding with the tag.
    if (held.itemId !== itemId || held.status !== "RETURNED_TO_OWNER") throw new Refusal("That scan tag is already on another unit.");
    const serial = blank(u.serial);
    if (serial && held.serial && serial !== held.serial) throw new Refusal("That scan tag belongs to a unit with a different serial.");
    // The identity it will have once back in custody must not collide with another unit in custody
    // (the reused unit itself is returned-to-owner, so it is not in the guard and cannot trip it).
    const finalIdentity = { serial: serial ?? held.serial, ownerTag: blank(u.ownerTag) ?? held.ownerTag };
    guard.check(finalIdentity);
    await tx.unit.update({
      where: { id: held.id },
      data: { status: next.status, currentLocationId: next.locationId, ...finalIdentity, condition: blank(u.condition) ?? held.condition },
    });
    guard.add(finalIdentity, next.status);
    unitId = held.id;
  } else {
    guard.check(u);
    const unit = await tx.unit.create({
      data: {
        itemId, serial: blank(u.serial), ownerTag: blank(u.ownerTag), scanTag,
        condition: blank(u.condition), status: next.status, currentLocationId: next.locationId,
      },
    });
    unitId = unit.id;
    guard.add(u, next.status);
  }
  await tx.movement.create({
    data: {
      type: "RECEIVE", itemId, unitId, toLocationId,
      reference: blank(meta.reference), notes: blank(meta.notes), actorUserId: meta.actorUserId, occurredAt: meta.occurredAt,
    },
  });
}

/** Receive serialized units into storage: each unit and its RECEIVE movement, all or none. */
export async function receiveUnitsTx(
  db: EntityDb,
  input: MovementMeta & {
    itemId: string;
    toLocationId: string;
    units: { serial?: string | null; ownerTag?: string | null; scanTag?: string | null; condition?: string | null }[];
  },
): Promise<LedgerResult> {
  if (input.units.length === 0) return no("Add at least one unit.");
  if (input.units.length > MAX_UNITS_PER_RECEIPT) return no(`Receive at most ${MAX_UNITS_PER_RECEIPT} units at a time.`);
  const applied = applyUnitMovement(null, { type: "RECEIVE", toLocationId: input.toLocationId });
  if (!applied.ok) return no(applied.reason);
  return transact(db, async (tx) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item || item.trackingMode !== "SERIALIZED") throw new Refusal("That item isn't tracked by unit.");
    const guard = await identityGuard(tx, item.id);
    for (const u of input.units) await receiveOneUnit(tx, item.id, applied.next, input.toLocationId, input, u, guard);
    return { ok: true as const, itemId: item.id };
  });
}

/** Move, release or return one unit. The "from" place is the unit's own recorded location, never the caller's. */
export async function writeUnitMovement(
  db: EntityDb,
  input: MovementMeta & {
    unitId: string;
    type: "MOVE" | "RELEASE" | "RETURN";
    toLocationId?: string | null;
    newSite?: NewSite;
    makeSite?: MakeSite;
  },
): Promise<LedgerResult> {
  const { toId, wantsSite } = await destination(input.toLocationId, input.newSite, input.finalToOwner);
  if (wantsSite && !input.makeSite) return no("A new site can't be created here.");

  // Check against the unit as it is now, before anything (a new site included) is created.
  const probe = await db.unit.findUnique({ where: { id: input.unitId } });
  if (!probe) return no("Unit not found.");
  const check = (current: { status: typeof probe.status; currentLocationId: string | null }, to: string | null) => {
    if ((input.type === "RELEASE" || input.type === "RETURN") && !input.finalToOwner && to && to === current.currentLocationId) return no("That is where it already is.");
    return applyUnitMovement(
      { status: current.status, locationId: current.currentLocationId },
      { type: input.type, toLocationId: to, fromLocationId: current.currentLocationId, recipient: input.recipient, finalToOwner: input.finalToOwner },
    );
  };
  const first = check(probe, toId);
  if (!first.ok) return no(first.reason);

  const realTo = wantsSite ? await input.makeSite!(input.newSite!.name!.trim(), input.newSite!.address?.trim() || undefined) : toId;

  return transact(db, async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
    if (!unit) throw new Refusal("Unit not found.");
    const applied = check(unit, realTo);
    if (!applied.ok) throw new Refusal(applied.reason);
    await tx.movement.create({
      data: {
        type: input.type, itemId: unit.itemId, unitId: unit.id, quantity: 1,
        fromLocationId: unit.currentLocationId, toLocationId: realTo,
        recipient: blank(input.recipient), destination: blank(input.destination), reference: blank(input.reference),
        carrier: blank(input.carrier), tracking: blank(input.tracking), finalToOwner: !!input.finalToOwner,
        notes: blank(input.notes), actorUserId: input.actorUserId, occurredAt: input.occurredAt,
      },
    });
    await tx.unit.update({ where: { id: unit.id }, data: { status: applied.next.status, currentLocationId: applied.next.locationId } });
    return { ok: true as const, itemId: unit.itemId };
  });
}

/** Receive, move, release or return counted stock: the movement and the new stock rows, all or none. */
export async function writeStockMovement(
  db: EntityDb,
  input: MovementMeta & {
    itemId: string;
    type: "RECEIVE" | "MOVE" | "RELEASE" | "RETURN";
    quantity: number;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    newSite?: NewSite;
    makeSite?: MakeSite;
  },
): Promise<LedgerResult> {
  const bad = quantityProblem(input.quantity);
  if (bad) return no(bad);
  const { toId, wantsSite } = await destination(input.toLocationId, input.newSite, input.finalToOwner);
  if (wantsSite && !input.makeSite) return no("A new site can't be created here.");

  // A receipt comes from outside: whatever "from" a caller sends is ignored.
  const from = input.type === "RECEIVE" ? null : input.fromLocationId ?? null;
  const run = (rows: StockRow[], to: string | null) => {
    if ((input.type === "RELEASE" || input.type === "RETURN") && !input.finalToOwner && to && to === from) return no("That is where it already is.");
    return applyStockMovement(rows, {
      type: input.type, quantity: input.quantity, fromLocationId: from, toLocationId: to,
      recipient: input.recipient, finalToOwner: input.finalToOwner,
    });
  };
  const rowsOf = (stock: { locationId: string; deployed: boolean; quantity: number }[]): StockRow[] =>
    stock.map((s) => ({ locationId: s.locationId, deployed: s.deployed, quantity: s.quantity }));

  const probe = await db.item.findUnique({ where: { id: input.itemId }, include: { stock: true } });
  if (!probe || probe.trackingMode !== "QUANTITY") return no("That item isn't tracked by quantity.");
  const first = run(rowsOf(probe.stock), toId);
  if (!first.ok) return no(first.reason);

  const realTo = wantsSite ? await input.makeSite!(input.newSite!.name!.trim(), input.newSite!.address?.trim() || undefined) : toId;

  return transact(db, async (tx) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId }, include: { stock: true } });
    if (!item || item.trackingMode !== "QUANTITY") throw new Refusal("That item isn't tracked by quantity.");
    const applied = run(rowsOf(item.stock), realTo);
    if (!applied.ok) throw new Refusal(applied.reason);
    await tx.movement.create({
      data: {
        type: input.type, itemId: item.id, quantity: input.quantity, fromLocationId: from, toLocationId: realTo,
        recipient: blank(input.recipient), destination: blank(input.destination), reference: blank(input.reference),
        carrier: blank(input.carrier), tracking: blank(input.tracking), finalToOwner: !!input.finalToOwner,
        notes: blank(input.notes), actorUserId: input.actorUserId, occurredAt: input.occurredAt,
      },
    });
    await tx.stock.deleteMany({ where: { itemId: item.id } });
    if (applied.rows.length) await tx.stock.createMany({ data: applied.rows.map((r) => ({ itemId: item.id, ...r })) });
    return { ok: true as const, itemId: item.id };
  });
}

/**
 * A correction is a new ledger row that points at the one it fixes; the ledger is never edited.
 * It is a type MOVE row with quantity 0 and correctsId set, and changes no unit or stock state.
 * Everything that counts gear reads Unit/Stock, not the ledger, so it cannot be counted; the log
 * recognises it by correctsId.
 */
export async function writeCorrection(db: EntityDb, input: { movementId: string; note: string; actorUserId: string }): Promise<LedgerResult> {
  if (!input.note.trim()) return no("Say what is being corrected.");
  const original = await db.movement.findUnique({ where: { id: input.movementId } });
  if (!original) return no("Movement not found.");
  if (original.correctsId) return no("That entry is itself a correction. Correct the original entry instead.");
  await db.movement.create({
    data: {
      type: "MOVE", itemId: original.itemId, unitId: original.unitId, quantity: 0,
      correctsId: original.id, notes: `Correction: ${input.note.trim()}`, actorUserId: input.actorUserId,
    },
  });
  return { ok: true, itemId: original.itemId };
}

export type ImportItemPlan = {
  name: string; manufacturer?: string | null; model?: string | null; category?: string | null
  trackingMode: "SERIALIZED" | "QUANTITY"
  units: { serial?: string | null; ownerTag?: string | null; locationId: string }[]
  stock: { locationId: string; quantity: number }[]
}
export type ImportSummary = {
  name: string; created: boolean; units: number; quantity: number
  /** The item written to: the existing one that was matched, or the new one. */
  itemId: string; itemName: string; itemMake: string | null
  locationIds: string[]
}
export type ImportResult = { ok: true; items: ImportSummary[]; dryRun: boolean } | { ok: false; reason: string }

/** Thrown to roll a dry run back after it has run exactly the real work. */
class DryRunDone extends Error {
  constructor(readonly items: ImportSummary[]) { super("dry run"); }
}

/**
 * Import resolved items in ONE transaction, using the same per-unit write as a receipt and the same
 * stock rules and rows as a stock receipt. Any refusal rolls the whole file back. A dry run executes
 * the identical code and then rolls back, so its preview cannot differ from the real result.
 *
 * Items are found by name, manufacturer and model (compared in JS on a normalised key, never with
 * SQL ILIKE, where % and _ would be wildcards) or created. Re-importing a file
 * is refused rather than doubled: a serial or owner tag the item already has is an error, and a
 * quantity row for an item that already holds stock is an error (use a stock receipt for more).
 */
export async function importItemsTx(db: EntityDb, input: { actorUserId: string; items: ImportItemPlan[]; dryRun: boolean }): Promise<ImportResult> {
  const meta: MovementMeta = { actorUserId: input.actorUserId, notes: "CSV import" };
  const run = async (tx: Tx): Promise<ImportSummary[]> => {
    const summaries: ImportSummary[] = [];
    const all = await tx.item.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const known = new Map<string, (typeof all)[number]>();
    for (const i of all) if (!known.has(itemIdentity(i))) known.set(itemIdentity(i), i);
    for (const plan of input.items) {
      const category = blank(plan.category);
      let item = known.get(itemIdentity(plan)) ?? null;
      const created = !item;
      if (item && item.trackingMode !== plan.trackingMode) throw new Refusal(`${plan.name} already exists and is tracked ${item.trackingMode === "SERIALIZED" ? "by unit" : "by quantity"}.`);
      item ??= await tx.item.create({
        data: {
          name: plan.name, manufacturer: blank(plan.manufacturer), model: blank(plan.model), trackingMode: plan.trackingMode,
          ...(category ? { category: { connectOrCreate: { where: { name: category }, create: { name: category } } } } : {}),
        },
      });
      let quantity = 0;
      if (plan.trackingMode === "SERIALIZED") {
        const existing = created ? [] : await tx.unit.findMany({ where: { itemId: item.id }, select: { serial: true, ownerTag: true } });
        const guard = await identityGuard(tx, item.id);
        for (const u of plan.units) {
          const serial = blank(u.serial), tag = blank(u.ownerTag);
          if (serial && existing.some((e) => e.serial?.toLowerCase() === serial.toLowerCase())) throw new Refusal(`${plan.name} already has a unit with serial ${serial}; nothing was imported.`);
          if (tag && existing.some((e) => e.ownerTag?.toLowerCase() === tag.toLowerCase())) throw new Refusal(`${plan.name} already has a unit with owner tag ${tag}; nothing was imported.`);
          const applied = applyUnitMovement(null, { type: "RECEIVE", toLocationId: u.locationId });
          if (!applied.ok) throw new Refusal(applied.reason);
          await receiveOneUnit(tx, item.id, applied.next, u.locationId, meta, { serial, ownerTag: tag }, guard);
          existing.push({ serial, ownerTag: tag });
        }
      } else {
        if (!created && (await tx.stock.count({ where: { itemId: item.id } })) > 0) {
          throw new Refusal(`${plan.name} already holds stock; receive more from the Receive screen instead. Nothing was imported.`);
        }
        let rows: StockRow[] = [];
        for (const s of plan.stock) {
          const bad = quantityProblem(s.quantity);
          if (bad) throw new Refusal(bad);
          const applied = applyStockMovement(rows, { type: "RECEIVE", quantity: s.quantity, toLocationId: s.locationId });
          if (!applied.ok) throw new Refusal(applied.reason);
          rows = applied.rows;
          await tx.movement.create({ data: { type: "RECEIVE", itemId: item.id, quantity: s.quantity, toLocationId: s.locationId, notes: meta.notes, actorUserId: input.actorUserId } });
          quantity += s.quantity;
        }
        if (rows.length) await tx.stock.createMany({ data: rows.map((r) => ({ itemId: item.id, ...r })) });
      }
      known.set(itemIdentity(plan), item);
      summaries.push({
        name: plan.name, created, units: plan.units.length, quantity, itemId: item.id, itemName: item.name, itemMake: [item.manufacturer, item.model].filter(Boolean).join(" ") || null,
        locationIds: [...new Set([...plan.units.map((u) => u.locationId), ...plan.stock.map((x) => x.locationId)])],
      });
    }
    return summaries;
  };
  const result = await transact(db, async (tx) => {
    const items = await run(tx);
    if (input.dryRun) throw new DryRunDone(items);
    return { ok: true as const, items, dryRun: false };
  }).catch((e: unknown) => {
    if (e instanceof DryRunDone) return { ok: true as const, items: e.items, dryRun: true };
    throw e;
  });
  return result;
}
