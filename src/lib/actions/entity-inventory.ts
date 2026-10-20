"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EntityAccessError, requireEntity, type EntityContext } from "@/lib/entities/context";
import { createSite } from "@/lib/entities/main-lookup";
import {
  quantityProblem, receiveUnitsTx, writeCorrection, writeStockMovement, writeUnitMovement,
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

const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/** Turns the ledger's answer into the outcome a screen shows. */
function outcome(slug: string, result: LedgerResult, message: string): EntityOutcome {
  return result.ok ? done(slug, message, result.itemId) : fail(result.reason);
}

type Common = { reference?: string; notes?: string; occurredAt?: string };

function meta(c: EntityContext, input: Common & Omit<Partial<MovementMeta>, "occurredAt" | "actorUserId">): MovementMeta | string {
  let occurredAt: Date | undefined;
  if (input.occurredAt) {
    occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return "That date isn't valid.";
  }
  return {
    actorUserId: c.userId, occurredAt, reference: input.reference, notes: input.notes, recipient: input.recipient,
    destination: input.destination, carrier: input.carrier, tracking: input.tracking, finalToOwner: input.finalToOwner,
  };
}

export type ItemInput = {
  name: string; description?: string; manufacturer?: string; model?: string;
  category?: string; trackingMode: "SERIALIZED" | "QUANTITY"; notes?: string;
};

const itemSchema = z.object({ name: z.string().trim().min(1, "Name the item."), trackingMode: z.enum(["SERIALIZED", "QUANTITY"]) });

export async function createItem(slug: string, input: ItemInput): Promise<EntityOutcome> {
  return guarded(slug, async ({ db }) => {
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const category = blank(input.category);
    const item = await db.item.create({
      data: {
        name: parsed.data.name, description: blank(input.description), manufacturer: blank(input.manufacturer),
        model: blank(input.model), notes: blank(input.notes), trackingMode: parsed.data.trackingMode,
        ...(category ? { category: { connectOrCreate: { where: { name: category }, create: { name: category } } } } : {}),
      },
    });
    return done(slug, "Item added.", item.id);
  });
}

export async function updateItem(slug: string, itemId: string, input: Omit<ItemInput, "trackingMode">): Promise<EntityOutcome> {
  return guarded(slug, async ({ db }) => {
    if (!input.name?.trim()) return fail("Name the item.");
    if (!(await db.item.findUnique({ where: { id: itemId }, select: { id: true } }))) return fail("Item not found.");
    const category = blank(input.category);
    await db.item.update({
      where: { id: itemId },
      data: {
        name: input.name.trim(), description: blank(input.description), manufacturer: blank(input.manufacturer),
        model: blank(input.model), notes: blank(input.notes),
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
    const m = meta(c, input);
    if (typeof m === "string") return fail(m);
    const result = await receiveUnitsTx(c.db, { ...m, itemId: input.itemId, toLocationId: input.toLocationId, units: input.units });
    const n = input.units.length;
    return outcome(slug, result, `${n} unit${n === 1 ? "" : "s"} received.`);
  });
}

type Destination = { toLocationId?: string | null; newSiteName?: string | null; newSiteAddress?: string | null };
type Handoff = { recipient?: string; destination?: string; carrier?: string; tracking?: string; finalToOwner?: boolean };

export type UnitMoveInput = Common & Destination & Handoff & { unitId: string; type: "MOVE" | "RELEASE" | "RETURN" };

/** Move, release or return one unit: the movement and the unit's new state, in one transaction. */
export async function moveUnit(slug: string, input: UnitMoveInput): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    if (!["MOVE", "RELEASE", "RETURN"].includes(input.type)) return fail("Unknown movement.");
    const m = meta(c, input);
    if (typeof m === "string") return fail(m);
    const result = await writeUnitMovement(c.db, {
      ...m, unitId: input.unitId, type: input.type, toLocationId: input.toLocationId,
      newSite: { name: input.newSiteName, address: input.newSiteAddress }, makeSite: createSite,
    });
    return outcome(slug, result, { MOVE: "Moved.", RELEASE: "Released.", RETURN: "Returned." }[input.type]);
  });
}

export async function releaseUnit(slug: string, input: Omit<UnitMoveInput, "type">): Promise<EntityOutcome> {
  return moveUnit(slug, { ...input, type: "RELEASE" });
}
export async function returnUnit(slug: string, input: Omit<UnitMoveInput, "type">): Promise<EntityOutcome> {
  return moveUnit(slug, { ...input, type: "RETURN" });
}

export type StockMoveInput = Common & Destination & Handoff & {
  itemId: string; type: "RECEIVE" | "MOVE" | "RELEASE" | "RETURN"; quantity: number; fromLocationId?: string | null;
};

export async function moveStock(slug: string, input: StockMoveInput): Promise<EntityOutcome> {
  return guarded(slug, async (c) => {
    if (!["RECEIVE", "MOVE", "RELEASE", "RETURN"].includes(input.type)) return fail("Unknown movement.");
    const bad = quantityProblem(input.quantity);
    if (bad) return fail(bad);
    const m = meta(c, input);
    if (typeof m === "string") return fail(m);
    const result = await writeStockMovement(c.db, {
      ...m, itemId: input.itemId, type: input.type, quantity: input.quantity, fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId, newSite: { name: input.newSiteName, address: input.newSiteAddress }, makeSite: createSite,
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
    const result = await writeCorrection(c.db, { movementId, note, actorUserId: c.userId });
    return outcome(slug, result, "Correction logged. Make the corrective move separately if the gear is in the wrong place.");
  });
}
