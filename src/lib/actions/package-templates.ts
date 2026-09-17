"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { addServiceItemToReservation } from "@/lib/actions/reservations";
import { pickRate } from "@/lib/queries/order-builder";
import type { PricingType } from "@/generated/prisma/client";

/**
 * Our packages: predefined sets of lines, built to spec once and dropped into
 * any quote (owner, 2026-09-17).
 *
 * A template is not an order's `Package`. An order's packages are its quote
 * options — the choices a client sees side by side and approves one of. Loading
 * a template adds its lines to one of those options. Rates: an asset line takes
 * the asset's current rate when it is loaded, exactly as Add line prices it,
 * unless the template line sets its own; so a package stays current without
 * being edited every time the rate card moves.
 */

export type TemplateOutcome =
  | { status: "ok"; message: string; id?: string; href?: string }
  | { status: "error"; message: string };

const reason = (error: unknown) =>
  error instanceof Error ? error.message : "That did not work. Try again.";

function touchTemplates(id?: string) {
  revalidatePath("/dashboard/packages");
  if (id) revalidatePath(`/dashboard/packages/${id}`);
}

export async function createTemplate(input: {
  name: string;
  description?: string;
}): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  const name = input.name.trim();
  if (!name) return { status: "error", message: "Give the package a name." };

  const last = await prisma.packageTemplate.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.packageTemplate.create({
    data: {
      name,
      description: input.description?.trim() || null,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: auth.userId,
    },
  });
  touchTemplates();
  return { status: "ok", message: `${name} created.`, id: created.id, href: `/dashboard/packages/${created.id}` };
}

export async function updateTemplate(
  id: string,
  input: { name?: string; description?: string | null; isActive?: boolean },
): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (input.name !== undefined && !input.name.trim()) {
    return { status: "error", message: "A package needs a name." };
  }
  await prisma.packageTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  touchTemplates(id);
  return {
    status: "ok",
    message:
      input.isActive === false
        ? "Archived. It no longer appears in Add line; orders it was loaded into are unchanged."
        : input.isActive === true
          ? "Restored to Add line."
          : "Saved.",
  };
}

export async function deleteTemplate(id: string): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  await prisma.packageTemplate.delete({ where: { id } });
  touchTemplates();
  return { status: "ok", message: "Package deleted. Orders it was loaded into keep their lines.", href: "/dashboard/packages" };
}

export async function addTemplateLine(
  templateId: string,
  line: {
    assetId?: string | null;
    serviceId?: string | null;
    description?: string;
    quantity: number;
    rate?: number | null;
    pricingType?: PricingType | null;
    isOneTime?: boolean;
  },
): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (!line.assetId && !line.serviceId && !line.description?.trim()) {
    return { status: "error", message: "A line needs an asset, a service or a description." };
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return { status: "error", message: "A line is for at least one." };
  }
  if (!line.assetId && (line.rate === null || line.rate === undefined)) {
    return { status: "error", message: "A line that isn't an asset needs its own rate." };
  }
  if (line.rate !== null && line.rate !== undefined && (!Number.isFinite(line.rate) || line.rate < 0)) {
    return { status: "error", message: "A rate is zero or more." };
  }

  const last = await prisma.packageTemplateItem.aggregate({
    where: { templateId },
    _max: { sortOrder: true },
  });
  await prisma.packageTemplateItem.create({
    data: {
      templateId,
      assetId: line.assetId || null,
      serviceId: line.serviceId || null,
      description: line.description?.trim() || null,
      quantity: line.quantity,
      rate: line.rate ?? null,
      pricingType: line.pricingType ?? null,
      isOneTime: line.isOneTime ?? false,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
  await prisma.packageTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } });
  touchTemplates(templateId);
  return { status: "ok", message: "Line added." };
}

export async function updateTemplateLine(
  lineId: string,
  input: { quantity?: number; rate?: number | null; pricingType?: PricingType | null; isOneTime?: boolean },
): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity < 1)) {
    return { status: "error", message: "A line is for at least one." };
  }
  if (input.rate !== undefined && input.rate !== null && (!Number.isFinite(input.rate) || input.rate < 0)) {
    return { status: "error", message: "A rate is zero or more." };
  }
  const line = await prisma.packageTemplateItem.findUnique({ where: { id: lineId }, select: { templateId: true, assetId: true } });
  if (!line) return { status: "error", message: "Line not found." };
  if (input.rate === null && !line.assetId) {
    return { status: "error", message: "A line that isn't an asset needs its own rate." };
  }
  await prisma.packageTemplateItem.update({
    where: { id: lineId },
    data: {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.rate !== undefined ? { rate: input.rate } : {}),
      ...(input.pricingType !== undefined ? { pricingType: input.pricingType } : {}),
      ...(input.isOneTime !== undefined ? { isOneTime: input.isOneTime } : {}),
    },
  });
  touchTemplates(line.templateId);
  return { status: "ok", message: "Saved." };
}

export async function removeTemplateLine(lineId: string): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  const line = await prisma.packageTemplateItem.delete({ where: { id: lineId }, select: { templateId: true } });
  touchTemplates(line.templateId);
  return { status: "ok", message: "Line removed." };
}

/**
 * Add a template's lines to one of an order's quote options.
 *
 * Each line goes through the same `addOrderLine` path a hand-added line does, so
 * a workstation in a package still arrives with its build expanded and the
 * order is repriced once at the end. Lines are added in the template's order.
 */
export async function loadTemplateIntoOrder(
  reservationId: string,
  templateId: string,
  packageId?: string,
): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const template = await prisma.packageTemplate.findUnique({
    where: { id: templateId },
    select: {
      name: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          assetId: true,
          serviceId: true,
          description: true,
          quantity: true,
          rate: true,
          pricingType: true,
          isOneTime: true,
          asset: { select: { name: true, monthlyRate: true, weeklyRate: true, dailyRate: true } },
          service: { select: { name: true, defaultRate: true } },
        },
      },
    },
  });
  if (!template) return { status: "error", message: "Package not found." };
  if (template.items.length === 0) {
    return { status: "error", message: `${template.name} has no lines yet. Add some on the package first.` };
  }

  const { addOrderLine } = await import("@/lib/actions/order-stage");
  let added = 0;
  const failed: string[] = [];
  for (const item of template.items) {
    const current = item.asset ? pickRate(item.asset) : null;
    const rate = item.rate !== null ? Number(item.rate) : (current?.rate ?? Number(item.service?.defaultRate ?? 0));
    const pricingType = (item.pricingType ?? current?.pricingType ?? "MONTHLY") as PricingType;
    const label = item.asset?.name ?? item.service?.name ?? item.description ?? "Line";

    if (item.serviceId && !item.assetId) {
      // Services go in through their own action, which keeps the line linked
      // to the service rather than as free text.
      try {
        await addServiceItemToReservation(reservationId, item.serviceId, rate, item.quantity, packageId);
        added++;
      } catch (error) {
        failed.push(`${label} (${reason(error)})`);
      }
      continue;
    }

    const result = await addOrderLine(
      reservationId,
      {
        assetId: item.assetId,
        description: item.assetId ? undefined : item.description ?? undefined,
        rate,
        pricingType,
        quantity: item.quantity,
        isOneTime: item.isOneTime,
      },
      packageId,
    );
    if (result.status === "ok") added++;
    else failed.push(`${label} (${result.message})`);
  }

  revalidatePath(`/dashboard/orders/${reservationId}`);
  if (added === 0) {
    return { status: "error", message: `Nothing from ${template.name} was added: ${failed.join("; ")}` };
  }
  return {
    status: "ok",
    message: `${template.name}: ${added} ${added === 1 ? "line" : "lines"} added${
      failed.length ? `. Not added: ${failed.join("; ")}` : "."
    }`,
  };
}

/**
 * Keep a client's option as one of our packages — the reorder path: what went
 * out to a client once, ready to drop into the next quote. Rates are kept as
 * overrides, because what the client was actually quoted is the point.
 */
export async function saveOptionAsTemplate(
  packageId: string,
  name?: string,
): Promise<TemplateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const option = await prisma.package.findUnique({
    where: { id: packageId },
    select: {
      name: true,
      description: true,
      reservation: { select: { reservationNumber: true, client: { select: { name: true } } } },
      items: {
        // Top-level lines only: a SKU's build parts come back with it when the
        // package is loaded, so copying them too would double them.
        where: { parentId: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          assetId: true,
          serviceId: true,
          description: true,
          quantity: true,
          rate: true,
          pricingType: true,
          isOneTime: true,
        },
      },
    },
  });
  if (!option) return { status: "error", message: "Option not found." };
  if (option.items.length === 0) return { status: "error", message: "That option has no lines to keep." };

  const last = await prisma.packageTemplate.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.packageTemplate.create({
    data: {
      name:
        name?.trim() ||
        `${option.reservation.client.name} — ${option.name === "Default" ? option.reservation.reservationNumber : option.name}`,
      description: option.description ?? `From ${option.reservation.reservationNumber}.`,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: auth.userId,
      items: {
        create: option.items.map((item, index) => ({
          assetId: item.assetId,
          serviceId: item.serviceId,
          description: item.assetId || item.serviceId ? null : item.description,
          quantity: item.quantity,
          rate: item.rate,
          pricingType: item.pricingType,
          isOneTime: item.isOneTime,
          sortOrder: index + 1,
        })),
      },
    },
  });
  touchTemplates();
  return {
    status: "ok",
    message: "Saved to our packages.",
    id: created.id,
    href: `/dashboard/packages/${created.id}`,
  };
}

/** Our packages matching what someone typed into Add line on an order. */
export async function findTemplates(query: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const { searchTemplates } = await import("@/lib/queries/packages");
  return searchTemplates(query);
}

export type TemplateDraftLine = {
  assetId: string;
  name: string;
  quantity: number;
  rate: number;
  pricingType: "DAILY" | "WEEKLY" | "MONTHLY";
  free: number;
  fleet: number;
  freeFrom: string | null;
};

/**
 * One of our packages as draft lines for a quote still being built (quick quote
 * and the new-order builder), priced and checked against that quote's window.
 *
 * Those screens hold lines in the browser until the order is saved and every
 * line is an asset, so this returns the package's asset lines — rate override
 * applied, availability for the dates — and names anything it could not carry
 * (a service or free-text line), which can be added on the order once it exists.
 */
export async function expandTemplateForWindow(
  templateId: string,
  start: string,
  end: string,
): Promise<
  | { status: "ok"; name: string; lines: TemplateDraftLine[]; skipped: string[] }
  | { status: "error"; message: string }
> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const { parseDateInput } = await import("@/lib/billing/calendar");
  const from = parseDateInput(start);
  const to = parseDateInput(end);
  if (!from || !to) return { status: "error", message: "Set the quote's dates first." };

  const template = await prisma.packageTemplate.findUnique({
    where: { id: templateId },
    select: {
      name: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          assetId: true,
          quantity: true,
          rate: true,
          pricingType: true,
          description: true,
          service: { select: { name: true } },
        },
      },
    },
  });
  if (!template) return { status: "error", message: "Package not found." };

  const { availabilityForAssets } = await import("@/lib/queries/order-builder");
  const assetIds = [...new Set(template.items.flatMap((item) => (item.assetId ? [item.assetId] : [])))];
  const availability = new Map(
    (await availabilityForAssets(assetIds, from, to)).map((asset) => [asset.assetId, asset]),
  );

  const lines: TemplateDraftLine[] = [];
  const skipped: string[] = [];
  for (const item of template.items) {
    const asset = item.assetId ? availability.get(item.assetId) : undefined;
    if (!asset) {
      skipped.push(item.service?.name ?? item.description ?? "A line");
      continue;
    }
    lines.push({
      assetId: asset.assetId,
      name: asset.name,
      quantity: item.quantity,
      rate: item.rate !== null ? Number(item.rate) : asset.rate,
      pricingType: (item.pricingType as TemplateDraftLine["pricingType"] | null) ?? asset.pricingType,
      free: asset.free,
      fleet: asset.fleet,
      freeFrom: asset.freeFrom ? asset.freeFrom.toISOString() : null,
    });
  }
  return { status: "ok", name: template.name, lines, skipped };
}
