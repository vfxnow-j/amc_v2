"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { createReservation } from "@/lib/actions/reservations";
import type { ReservationType } from "@/generated/prisma/client";
import type { PricingType } from "@/lib/types";
import {
  findSubstitutes,
  searchAssetsForWindow,
  searchClients,
  type AssetAvailability,
} from "@/lib/queries/order-builder";

/**
 * Server actions behind the new-order builder. The queries are re-exported as
 * actions so the client component can call them as the person types, rather
 * than the page shipping the whole catalogue to the browser.
 */

export async function lookupClients(query: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  return searchClients(query);
}

export async function lookupAssets(
  query: string,
  start: string,
  end: string,
): Promise<AssetAvailability[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  return searchAssetsForWindow(query, new Date(start), new Date(end));
}

export async function lookupSubstitutes(
  assetId: string,
  quantity: number,
  start: string,
  end: string,
): Promise<AssetAvailability[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  return findSubstitutes(assetId, quantity, new Date(start), new Date(end));
}

export type DraftLine = {
  assetId: string;
  name: string;
  quantity: number;
  rate: number;
  pricingType: string;
  /** Set when the person chose "book anyway" on an unavailable line. */
  overbooked?: boolean;
};

export type CreateOrderInput = {
  clientId: string;
  /**
   * Which kind of order this is. The builder makes one of four things, and the
   * type decides the billing cycle, whether it recurs and what the order number
   * is prefixed with — all of which `createReservation` already knew how to do.
   * It was simply never reachable, so every order built here came out a rental.
   */
  type: ReservationType;
  start: string;
  end: string;
  projectName?: string;
  /** Rent-to-own only; the monthly payment and buyout are derived from it. */
  rtoTermMonths?: number;
  lines: DraftLine[];
};

export type CreateOrderResult =
  | { status: "error"; message: string }
  | { status: "ok"; reservationId: string };

/**
 * Create the order as a DRAFT, then send the person to the record.
 *
 * Draft rather than approved on purpose: nothing here has been agreed with the
 * client yet, and a draft holds no stock — `HOLDS_STOCK` in the availability
 * query counts only APPROVED and later. Building an order must not itself make
 * the next person's availability worse.
 *
 * Lines waved through as unavailable set `actionRequired` on the order, which
 * is the field v1 already uses for "somebody needs to look at this". The note
 * names the lines, so ops sees what was promised rather than only that
 * something was.
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  if (!input.clientId) {
    return { status: "error", message: "Choose a client for this order." };
  }
  if (input.lines.length === 0) {
    return {
      status: "error",
      message: "Add at least one line — an order with nothing on it can't be priced.",
    };
  }

  const start = new Date(input.start);
  const end = new Date(input.end);
  if (!(start < end)) {
    return {
      status: "error",
      message: "The order has to end after it starts.",
    };
  }

  const overbooked = input.lines.filter((line) => line.overbooked);

  const created = await createReservation({
    clientId: input.clientId,
    reservationType: input.type,
    startDate: start,
    endDate: end,
    projectName: input.projectName || undefined,
    ...(input.type === "RENT_TO_OWN" && input.rtoTermMonths
      ? { rtoTermMonths: input.rtoTermMonths }
      : {}),
    // Lines waved through as unavailable raise the flag v1 already has for
    // "somebody needs to look at this", and the note names them — ops should
    // see what was promised, not only that something was.
    ...(overbooked.length > 0
      ? {
          actionRequired: true,
          actionRequiredNote: `Booked over available stock: ${overbooked
            .map((line) => `${line.quantity}x ${line.name}`)
            .join(", ")}. Confirm cover before this order is approved.`,
        }
      : {}),
    items: input.lines.map((line) => ({
      assetId: line.assetId,
      quantity: line.quantity,
      rate: line.rate,
      pricingType: line.pricingType as PricingType,
    })),
  });

  const reservationId = created?.id;
  if (!reservationId) {
    return {
      status: "error",
      message: "The order couldn't be created. Nothing was saved.",
    };
  }

  revalidatePath("/dashboard/orders");
  return { status: "ok", reservationId };
}

/** Used by the builder's submit path so the redirect happens server-side. */
export async function createOrderAndOpen(input: CreateOrderInput) {
  const result = await createOrder(input);
  if (result.status === "error") return result;
  redirect(`/dashboard/orders/${result.reservationId}`);
}
