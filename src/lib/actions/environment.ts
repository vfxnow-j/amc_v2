"use server";

import { revalidatePath } from "next/cache";
import type { EnvSection } from "@/generated/prisma/client";
import { requireEditor } from "@/lib/auth-utils";
import { oneOf } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { ENV_SECTIONS, ENV_SECTION_FIELDS } from "@/lib/tracker/environment";
import { logAudit } from "./audit";

/**
 * Writes for the environment profile (docs/client-tracker.md, Phase 3).
 *
 * Only the *owned* column is writable: what we supply comes off real orders and
 * what they asked for comes off `ClientAsk`, and both are read, never stored.
 *
 * Every export is a callable Server Function the moment a client component
 * imports this module, so each checks its own role — the lesson `agreement.ts`
 * taught this project by shipping without one. Editors write; VIEWER reads.
 */

export type EnvResult = { ok: true } | { ok: false; error: string };

const isSection = oneOf<EnvSection>(ENV_SECTIONS);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight, for the reason `lib/actions/tracker.ts` sets out. */
function localDay(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const match = DAY.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/** A whole number in range, or null. Blank is a legitimate answer everywhere. */
function count(value: unknown, max: number): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return parsed;
}

function decimal(value: unknown, max: number): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return Math.round(parsed * 100) / 100;
}

export type EnvironmentItemInput = {
  /** Set to update an existing row; omitted to add one. */
  id?: string;
  clientId: string;
  section: string;
  name: string;
  vendor?: string;
  quantity?: string | number;
  os?: string;
  gpu?: string;
  capacityTb?: string | number;
  percentUsed?: string | number;
  protocol?: string;
  backup?: string;
  speed?: string;
  /** `YYYY-MM-DD`. */
  refreshOn?: string;
  notes?: string;
};

/**
 * Add or amend a piece of kit the account runs.
 *
 * Fields outside the section's own set are dropped rather than saved: the form
 * only shows what `ENV_SECTION_FIELDS` allows, and a storage array that
 * arrived carrying a GPU got it from a section the person switched away from
 * mid-edit, not from anything they meant.
 */
export async function saveEnvironmentItem(input: EnvironmentItemInput): Promise<EnvResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error ?? "Unauthorized" };

  const section = isSection(input.section) ? input.section : null;
  if (!section) return { ok: false, error: "Pick a section." };

  const name = text(input.name, 160);
  if (!name) return { ok: false, error: "Give it a name — that is what the row is read by." };

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "That account no longer exists." };

  const allowed = new Set<string>(ENV_SECTION_FIELDS[section]);
  const keep = <T>(field: string, value: T): T | null => (allowed.has(field) ? value : null);

  const data = {
    section,
    name,
    vendor: keep("vendor", text(input.vendor, 80)),
    quantity: keep("quantity", count(input.quantity, 100_000)),
    os: keep("os", text(input.os, 80)),
    gpu: keep("gpu", text(input.gpu, 80)),
    capacityTb: keep("capacityTb", decimal(input.capacityTb, 100_000)),
    percentUsed: keep("percentUsed", count(input.percentUsed, 100)),
    protocol: keep("protocol", text(input.protocol, 80)),
    backup: keep("backup", text(input.backup, 120)),
    speed: keep("speed", text(input.speed, 80)),
    refreshAt: keep("refreshAt", localDay(input.refreshOn)),
    notes: text(input.notes, 2000),
  };

  if (input.id) {
    // Scoped to the account as well as the id, so a row cannot be moved onto
    // somebody else's profile by editing the hidden field.
    const updated = await prisma.environmentItem.updateMany({
      where: { id: input.id, clientId: client.id },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "That entry is no longer on this account." };
    await logAudit({
      action: "UPDATE",
      entityType: "Client",
      entityId: client.id,
      newValues: { environmentItem: input.id, section, name },
      userId: auth.userId,
    });
  } else {
    await prisma.environmentItem.create({
      data: { ...data, clientId: client.id, createdById: auth.userId ?? null },
    });
    await logAudit({
      action: "CREATE",
      entityType: "Client",
      entityId: client.id,
      newValues: { environmentItem: name, section },
      userId: auth.userId,
    });
  }

  revalidatePath(`/dashboard/clients/${client.id}`);
  return { ok: true };
}

export async function deleteEnvironmentItem(
  clientId: string,
  id: string,
): Promise<EnvResult> {
  const auth = await requireEditor();
  if (!auth.authorized) return { ok: false, error: auth.error ?? "Unauthorized" };

  const removed = await prisma.environmentItem.deleteMany({ where: { id, clientId } });
  if (removed.count === 0) return { ok: false, error: "That entry is already gone." };

  await logAudit({
    action: "DELETE",
    entityType: "Client",
    entityId: clientId,
    oldValues: { environmentItem: id },
    userId: auth.userId,
  });
  revalidatePath(`/dashboard/clients/${clientId}`);
  return { ok: true };
}
