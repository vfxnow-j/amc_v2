"use server";

import { revalidatePath } from "next/cache";
import { EntityAccessError, requireEntity, type EntityContext } from "@/lib/entities/context";
import { createSite, existingLocationIds } from "@/lib/entities/main-lookup";
import { parseOccurredAt } from "@/lib/entities/dates";
import {
  check, correctionSchema, idSchema, itemSchema, itemUpdateSchema, receiveUnitsSchema, stockMoveSchema, unitMoveSchema,
} from "@/lib/entities/schemas";
import {
  blank, receiveUnitsTx, writeCorrection, writeStockMovement, writeUnitMovement,
  type LedgerResult, type MovementMeta,
} from "@/lib/entities/ledger";

export type EntityOutcome = { status: "ok"; message: string; id?: string } | { status: "error"; message: string };

const fail = (message: string): EntityOutcome => ({ status: "error", message });
const done = (slug: string, message: string, id?: string): EntityOutcome => {
  revalidatePath(`/entity/${slug}`, "layout");
  return { status: "ok", message, id };
};

/** Every action: the gate (write access to this entity), then the work. */
async function guarded(slug: string, run: (c: EntityContext) => Promise<EntityOutcome>): Promise<EntityOutcome> {
  try {
    return await run(await requireEntity(slug, { write: true }));
  } catch (error) {
    if (error instanceof EntityAccessError) return fail(error.message);
    console.error(error);
    return fail("That didn't save.");
  }
}

/** Turns the ledger's answer into the outcome a screen shows. */
function outcome(slug: string, result: LedgerResult, message: string): EntityOutcome {
  return result.ok ? done(slug, message, result.itemId) : fail(result.reason);
}

type Common = { reference?: string | null; notes?: string | null; occurredAt?: string | null };
type Handoffs = { recipient?: string | null; destination?: string | null; carrier?: string | null; tracking?: string | null; finalToOwner?: boolean };

/** The fields every movement carries, or the message for a bad date. */
function meta(c: EntityContext, input: Common & Handoffs): MovementMeta | string {
  let occurredAt: Date | undefined;
  if (input.occurredAt?.trim()) {
    const parsed = parseOccurredAt(input.occurredAt);
    if (!parsed.ok) return parsed.reason;
    occurredAt = parsed.date;
  }
  return {
    actorUserId: c.userId, occurredAt, reference: input.reference, notes: input.notes, recipient: input.recipient,
    destination: input.destination, carrier: input.carrier, tracking: input.tracking, finalToOwner: input.finalToOwner,
  };
}

/** A message when any of these location ids is not a real location, else null. Nothing is written before this passes. */
async function missingLocation(ids: (string | null | undefined)[]): Promise<string | null> {
  const wanted = ids.filter((i): i is string => !!i);
  const found = await existingLocationIds(wanted);
  return wanted.every((i) => found.has(i)) ? null : "That location doesn't exist.";
}

export type ItemInput = {
  name: string; description?: string; manufacturer?: string; model?: string;
  category?: string; trackingMode: "SERIALIZED" | "QUANTITY"; notes?: string;
};

export async function createItem(slug: string, input: ItemInput): Promise<EntityOutcome> {
  return guarded(slug, async ({ db }) => {
    const p = check(itemSchema, input);
    if (!p.ok) return fail(p.message);
    const d = p.data;
    const category = blank(d.category);
    const item = await db.item.create({
      data: {
        name: d.name, description: blank(d.description), manufacturer: blank(d.manufacturer),
        model: blank(d.model), notes: blank(d.notes), trackingMode: d.trackingMode,
        ...(category ? { category: { connectOrCreate: { where: { name: category }, create: { name: category } } } } : {}),
      },
    });
    return done(slug, "Item added.", item.id);
  });
}

export async function updateItem(slug: string, itemId: string, input: Omit<ItemInput, "trackingMode">): Promise<EntityOutcome> {
  return guarded(slug, async ({ db }) => {
    const idCheck = check(idSchema, itemId);
    if (!idCheck.ok) return fail(idCheck.message);
    const p = check(itemUpdateSchema, input);
    if (!p.ok) return fail(p.message);
    const d = p.data;
    if (!(await db.item.findUnique({ where: { id: itemId }, select: { id: true } }))) return fail("Item not found.");
    const category = blank(d.category);
    await db.item.update({
      where: { id: itemId },
      data: {
        name: d.name, description: blank(d.description), manufacturer: blank(d.manufacturer),
        model: blank(d.model), notes: blank(d.notes),
        category: category ? { connectOrCreate: { where: { name: category }, create: { name: category } } } : { disconnect: true },
      },
    });
    return done(slug, "Item saved.", itemId);
  });
}

export type ReceiveUnitsInput = Common & {
  itemId: string; toLocationId: string;
  units: { serial?: string; ownerTag?: string; scanTag?: string; condition?: string }[];
};

export async function receiveUnits(slug: string, input: ReceiveUnitsInput): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    const p = check(receiveUnitsSchema, input);
    if (!p.ok) return fail(p.message);
    const m = meta(c, p.data);
    if (typeof m === "string") return fail(m);
    const missing = await missingLocation([p.data.toLocationId]);
    if (missing) return fail(missing);
    const result = await receiveUnitsTx(c.db, { ...m, itemId: p.data.itemId, toLocationId: p.data.toLocationId, units: p.data.units });
    const n = p.data.units.length;
    return outcome(slug, result, `${n} unit${n === 1 ? "" : "s"} received.`);
  });
}

type Destination = { toLocationId?: string | null; newSiteName?: string | null; newSiteAddress?: string | null };

export type UnitMoveInput = Common & Destination & Handoffs & { unitId: string; type: "MOVE" | "RELEASE" | "RETURN" };

/** Move, release or return one unit: the movement and the unit's new state, in one transaction. */
export async function moveUnit(slug: string, input: UnitMoveInput): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    const p = check(unitMoveSchema, input);
    if (!p.ok) return fail(p.message);
    const d = p.data;
    const m = meta(c, d);
    if (typeof m === "string") return fail(m);
    const missing = await missingLocation([d.toLocationId]);
    if (missing) return fail(missing);
    const result = await writeUnitMovement(c.db, {
      ...m, unitId: d.unitId, type: d.type, toLocationId: d.toLocationId,
      newSite: { name: d.newSiteName, address: d.newSiteAddress }, makeSite: (name, address) => createSite(name, address, c.userId),
    });
    return outcome(slug, result, { MOVE: "Moved.", RELEASE: "Released.", RETURN: "Returned." }[d.type]);
  });
}

export async function releaseUnit(slug: string, input: Omit<UnitMoveInput, "type">): Promise<EntityOutcome> {
  return moveUnit(slug, { ...input, type: "RELEASE" });
}
export async function returnUnit(slug: string, input: Omit<UnitMoveInput, "type">): Promise<EntityOutcome> {
  return moveUnit(slug, { ...input, type: "RETURN" });
}

export type StockMoveInput = Common & Destination & Handoffs & {
  itemId: string; type: "RECEIVE" | "MOVE" | "RELEASE" | "RETURN"; quantity: number; fromLocationId?: string | null;
};

export async function moveStock(slug: string, input: StockMoveInput): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    const p = check(stockMoveSchema, input);
    if (!p.ok) return fail(p.message);
    const d = p.data;
    const m = meta(c, d);
    if (typeof m === "string") return fail(m);
    const missing = await missingLocation([d.toLocationId, d.type === "RECEIVE" ? null : d.fromLocationId]);
    if (missing) return fail(missing);
    const result = await writeStockMovement(c.db, {
      ...m, itemId: d.itemId, type: d.type, quantity: d.quantity, fromLocationId: d.fromLocationId,
      toLocationId: d.toLocationId, newSite: { name: d.newSiteName, address: d.newSiteAddress }, makeSite: (name, address) => createSite(name, address, c.userId),
    });
    return outcome(slug, result, "Recorded.");
  });
}

export async function releaseStock(slug: string, input: Omit<StockMoveInput, "type">): Promise<EntityOutcome> {
  return moveStock(slug, { ...input, type: "RELEASE" });
}
export async function returnStock(slug: string, input: Omit<StockMoveInput, "type">): Promise<EntityOutcome> {
  return moveStock(slug, { ...input, type: "RETURN" });
}
export async function receiveStock(slug: string, input: Omit<StockMoveInput, "type" | "fromLocationId">): Promise<EntityOutcome> {
  return moveStock(slug, { ...input, type: "RECEIVE" });
}

/** A correction is a new movement that points at the one it fixes; the ledger is never edited. */
export async function correctMovement(slug: string, movementId: string, note: string): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    const p = check(correctionSchema, { movementId, note });
    if (!p.ok) return fail(p.message);
    const result = await writeCorrection(c.db, { movementId: p.data.movementId, note: p.data.note, actorUserId: c.userId });
    return outcome(slug, result, "Correction logged. Make the corrective move separately if the gear is in the wrong place.");
  });
}
