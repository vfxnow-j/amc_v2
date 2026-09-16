"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import {
  receivePurchaseOrder,
  type NewAssetData,
  type ReceiveItemData,
} from "@/lib/actions/purchase-orders";
import { addBuildComponent } from "@/lib/actions/asset-build";

/**
 * Receiving against a purchase order — where models and units are born.
 *
 * Receiving is the main way hardware enters the fleet (docs/procurement.md,
 * Phase 4), so this is where a line the catalog has never seen gets its model,
 * optionally with the build that model is sold as, and where every unit gets
 * its barcode, serial, location and condition. The ported `receivePurchaseOrder`
 * holds the transaction: it creates the models, the units (stamped with this PO,
 * its vendor, its lease and the ownership that follows from them) and moves the
 * PO to PARTIAL or RECEIVED. This layer checks everything a person can get wrong
 * *before* that transaction opens, so a refusal names the line and the unit
 * rather than surfacing as a unique-constraint error from halfway through.
 *
 * Replaces `receivePOLines` (lib/accounting/actions), which could make units
 * only for lines already linked to a model and put them all in one location.
 *
 * Only async functions may be exported from a "use server" file.
 */

export type ReceiveOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export type ReceiveUnitInput = {
  /** Blank → the ported action generates one. */
  barcode: string;
  serial: string;
  locationId: string;
  condition: string;
};

export type ReceivePartInput = {
  componentAssetId: string;
  quantity: number;
  priceMode: "INCLUDED" | "ADDS";
  isDefault: boolean;
};

/**
 * What a fleet line with no model becomes on receipt. Irrelevant for lines that
 * already have a model, and for resale and consumable lines.
 */
export type ReceiveModelChoice =
  | {
      kind: "new";
      name: string;
      categoryId: string;
      manufacturer: string;
      model: string;
      build: ReceivePartInput[];
    }
  | { kind: "existing"; assetId: string }
  /** Record the quantity so the PO can close, and make no units. */
  | { kind: "count" };

export type ReceiveLineInput = {
  poItemId: string;
  quantity: number;
  /** Fleet lines: one per item received, in order. */
  units: ReceiveUnitInput[];
  /** Resale lines: serials captured on the line. */
  serials: string[];
  model?: ReceiveModelChoice;
};

/** yyyy-mm-dd as noon UTC, so the day survives being shown in Los Angeles. */
function dayFrom(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function receivePO(
  purchaseOrderId: string,
  input: { receivedOn: string; lines: ReceiveLineInput[] },
): Promise<ReceiveOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const receivedOn = dayFrom(input.receivedOn);
  if (!receivedOn) return { status: "error", message: "Say what day it arrived." };
  // A day's grace for the timezone: "today" in Los Angeles is tomorrow in UTC
  // for the last hours of the evening.
  if (receivedOn.getTime() > Date.now() + 36 * 3600 * 1000) {
    return { status: "error", message: "It cannot have arrived in the future." };
  }

  const wanted = input.lines.filter((line) => line.quantity !== 0);
  if (wanted.length === 0) {
    return { status: "error", message: "Nothing to receive — set a quantity on at least one line." };
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      status: true,
      poNumber: true,
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          receivedQuantity: true,
          isInventoried: true,
          isResale: true,
          assetId: true,
        },
      },
    },
  });
  if (!po) return { status: "error", message: "That purchase order no longer exists." };
  if (po.status !== "SUBMITTED" && po.status !== "PARTIAL") {
    return {
      status: "error",
      message:
        po.status === "DRAFT"
          ? `${po.poNumber} is still a draft. Submit it before receiving against it.`
          : `${po.poNumber} is ${po.status.toLowerCase()} — nothing more can be received.`,
    };
  }
  const items = new Map(po.items.map((item) => [item.id, item]));

  const locationIds = new Set(
    (await prisma.location.findMany({ select: { id: true } })).map((l) => l.id),
  );

  const items_: ReceiveItemData[] = [];
  const newAssets: NewAssetData[] = [];
  const links: { poItemId: string; assetId: string }[] = [];
  const builds: { poItemId: string; name: string; parts: ReceivePartInput[] }[] = [];
  const barcodes = new Map<string, string>(); // barcode → where it was typed
  const serials = new Map<string, string>();
  const newNames = new Set<string>();

  for (const line of wanted) {
    const item = items.get(line.poItemId);
    if (!item) {
      return { status: "error", message: "A line on this PO has changed since the page loaded — reload and count again." };
    }
    const name = item.description;
    const remaining = item.quantity - item.receivedQuantity;
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      return { status: "error", message: `"${name}": the quantity has to be a whole number.` };
    }
    if (line.quantity > remaining) {
      return { status: "error", message: `"${name}" has only ${remaining} left to receive.` };
    }

    const payload: ReceiveItemData = { poItemId: item.id, receivedQuantity: line.quantity };

    if (item.isInventoried) {
      let makesUnits = true;

      if (!item.assetId) {
        const choice = line.model;
        if (!choice) {
          return { status: "error", message: `"${name}" has no model. Create one, pick an existing one, or receive it as a count only.` };
        }
        if (choice.kind === "count") {
          makesUnits = false;
        } else if (choice.kind === "existing") {
          const asset = await prisma.asset.findUnique({
            where: { id: choice.assetId },
            select: { id: true, retiredAt: true, name: true },
          });
          if (!asset) return { status: "error", message: `"${name}": that model no longer exists.` };
          if (asset.retiredAt) {
            return { status: "error", message: `"${asset.name}" is retired. New units cannot be received onto it.` };
          }
          links.push({ poItemId: item.id, assetId: asset.id });
        } else {
          const modelName = choice.name.trim();
          if (!modelName) return { status: "error", message: `"${name}": the new model needs a name.` };
          const category = await prisma.assetCategory.findUnique({
            where: { id: choice.categoryId || "" },
            select: { id: true },
          });
          if (!category) return { status: "error", message: `"${modelName}" needs a category.` };
          const key = modelName.toLowerCase();
          if (newNames.has(key)) {
            return { status: "error", message: `Two lines would each create a model called "${modelName}". Create it on one and pick it as the existing model on the other after receiving, or name them apart.` };
          }
          newNames.add(key);
          // A second model with the same name is how the catalog ends up with
          // two SKUs that orders get split across. Refused with the way out.
          const clash = await prisma.asset.findFirst({
            where: { name: { equals: modelName, mode: "insensitive" }, retiredAt: null },
            select: { name: true },
          });
          if (clash) {
            return { status: "error", message: `A model called "${clash.name}" already exists. Pick it as the existing model for "${name}" instead of creating a second.` };
          }
          const partIds = new Set<string>();
          for (const part of choice.build) {
            if (!Number.isInteger(part.quantity) || part.quantity < 1) {
              return { status: "error", message: `"${modelName}": every part in the build goes in at least once.` };
            }
            if (partIds.has(part.componentAssetId)) {
              return { status: "error", message: `"${modelName}": a part is listed twice — change its quantity instead.` };
            }
            partIds.add(part.componentAssetId);
          }
          if (partIds.size > 0) {
            // The same rule `addBuildComponent` enforces, checked before any
            // unit is written so a bad part cannot leave a half-built model.
            const found = await prisma.asset.findMany({
              where: { id: { in: [...partIds] } },
              select: { id: true, name: true, _count: { select: { components: true } } },
            });
            if (found.length !== partIds.size) {
              return { status: "error", message: `"${modelName}": a part in its build no longer exists.` };
            }
            const nested = found.find((part) => part._count.components > 0);
            if (nested) {
              return { status: "error", message: `"${nested.name}" has a build of its own, so it cannot be a part. Nesting is one level deep.` };
            }
            builds.push({ poItemId: item.id, name: modelName, parts: choice.build });
          }
          newAssets.push({
            poItemId: item.id,
            name: modelName,
            categoryId: category.id,
            manufacturer: choice.manufacturer.trim() || undefined,
            model: choice.model.trim() || undefined,
          });
        }
      }

      if (makesUnits && line.quantity > 0) {
        if (line.units.length !== line.quantity) {
          return { status: "error", message: `"${name}": ${line.quantity} received but ${line.units.length} units described. Reload and count again.` };
        }
        for (const [index, unit] of line.units.entries()) {
          const where = `"${name}" unit ${index + 1}`;
          if (!locationIds.has(unit.locationId)) {
            return { status: "error", message: `${where} needs a location.` };
          }
          const barcode = unit.barcode.trim();
          if (barcode) {
            if (barcodes.has(barcode)) {
              return { status: "error", message: `Barcode ${barcode} is on both ${barcodes.get(barcode)} and ${where}.` };
            }
            barcodes.set(barcode, where);
          }
          const serial = unit.serial.trim();
          if (serial) {
            if (serials.has(serial)) {
              return { status: "error", message: `Serial ${serial} is on both ${serials.get(serial)} and ${where}.` };
            }
            serials.set(serial, where);
          }
        }
        payload.units = line.units.map((unit) => ({
          barcode: unit.barcode.trim() || undefined,
          serialNumber: unit.serial.trim() || undefined,
          locationId: unit.locationId,
          condition: unit.condition.trim() || undefined,
        }));
      }
    } else if (item.isResale) {
      payload.serials = line.serials.map((serial) => serial.trim()).filter(Boolean);
    }

    items_.push(payload);
  }

  // Both columns are unique across the fleet. Checked together, up front, so
  // the refusal names every clash at once instead of one per attempt.
  if (barcodes.size > 0 || serials.size > 0) {
    const taken = await prisma.assetUnit.findMany({
      where: {
        OR: [
          { barcode: { in: [...barcodes.keys()] } },
          { serialNumber: { in: [...serials.keys()] } },
        ],
      },
      select: { barcode: true, serialNumber: true },
      take: 6,
    });
    if (taken.length > 0) {
      const clashes = taken.map((unit) =>
        barcodes.has(unit.barcode)
          ? `barcode ${unit.barcode}`
          : `serial ${unit.serialNumber}`,
      );
      return {
        status: "error",
        message: `Already in the fleet: ${clashes.join(", ")}. Nothing was received.`,
      };
    }
  }

  // Linking a line to an existing model happens before the receipt, outside
  // its transaction. If the receipt then fails, the line keeps the link — which
  // is the choice the person made and what the next attempt needs anyway.
  for (const link of links) {
    await prisma.pOItem.update({ where: { id: link.poItemId }, data: { assetId: link.assetId } });
  }

  let created: Record<string, string>;
  try {
    const result = (await receivePurchaseOrder(purchaseOrderId, {
      items: items_,
      newAssets: newAssets.length > 0 ? newAssets : undefined,
      receivingDate: receivedOn,
    })) as { createdUnits: string[]; newAssetMap: Record<string, string> };
    created = result.newAssetMap;
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Nothing was received.",
    };
  }

  // The build goes on through asset-build's own action, so its rules (one level
  // deep, no duplicates) live in one place. It is after the receipt, not inside
  // it: the parts were checked above, so a failure here is a race, and the
  // model and its units are real either way — the message says what is missing.
  const unbuilt: string[] = [];
  for (const build of builds) {
    const assetId = created[build.poItemId];
    if (!assetId) continue;
    for (const part of build.parts) {
      const added = await addBuildComponent(assetId, part);
      if (added.status === "error") unbuilt.push(`${build.name}: ${added.message}`);
    }
  }

  revalidatePath(`/dashboard/purchase-orders/${purchaseOrderId}`);
  revalidatePath("/dashboard/units");
  for (const assetId of Object.values(created)) revalidatePath(`/dashboard/assets/${assetId}`);

  const units = items_.reduce((sum, line) => sum + (line.units?.length ?? 0), 0);
  const models = newAssets.length;
  const parts = [
    units > 0 ? `${units} ${units === 1 ? "unit is" : "units are"} now in the fleet` : null,
    models > 0 ? `${models} new ${models === 1 ? "model" : "models"}` : null,
  ].filter(Boolean);

  return unbuilt.length > 0
    ? {
        status: "error",
        message: `Received${parts.length ? ` — ${parts.join(", ")}` : ""}. Some build parts were not added: ${unbuilt.join("; ")}. Add them on the model's record.`,
      }
    : {
        status: "ok",
        message: `Received${parts.length ? ` — ${parts.join(", ")}` : ""}.`,
      };
}
