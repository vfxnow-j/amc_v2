"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { createReservation } from "@/lib/actions/reservations";
import type { ReservationType } from "@/generated/prisma/client";
import type { PricingType } from "@/lib/types";
import { intendedDay, parseDateInput } from "@/lib/billing/calendar";
import { addTermMonths } from "@/lib/flow/stored-money";
import { isFlowTerm, FLOW_TERMS_MESSAGE } from "@/lib/flow/terms";
import {
  findSubstitutes,
  searchAssetsForWindow,
  searchClients,
  type AssetAvailability,
} from "@/lib/queries/order-builder";

/**
 * Server actions behind the new-order builder. The queries are re-exported as
 * actions so the client component can call them as the person types, rather
 * than the page shipping the whole catalog to the browser.
 */

/**
 * A window date as a calendar day. The builder sends a date input's
 * `YYYY-MM-DD`; the order record's Add line sends the order's stored dates as
 * ISO timestamps. Both must work — accepting only the first made Add line on an
 * existing order find no assets at all.
 */
function windowDay(value: string): Date | null {
  const day = parseDateInput(value);
  if (day) return day;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : intendedDay(instant);
}

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
  const from = windowDay(start);
  const to = windowDay(end);
  if (!from || !to) return [];
  return searchAssetsForWindow(query, from, to);
}

export async function lookupSubstitutes(
  assetId: string,
  quantity: number,
  start: string,
  end: string,
): Promise<AssetAvailability[]> {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const from = windowDay(start);
  const to = windowDay(end);
  if (!from || !to) return [];
  return findSubstitutes(assetId, quantity, from, to);
}

export type DraftLine = {
  assetId: string;
  name: string;
  quantity: number;
  rate: number;
  pricingType: string;
  /** Set when the person chose "book anyway" on an unavailable line. */
  overbooked?: boolean;
  /**
   * Flow only: the pricing basis per unit. It may be raised above the gear's
   * landed cost but is floored at it on the server; the rate is ignored, since
   * the server derives every Flow rate.
   */
  costBasis?: number;
};

/** Flow only: the term and the pricing knobs. Blank knobs take the house defaults. */
export type FlowOrderTerms = {
  termMonths: number;
  marginPct?: number;
  financePct?: number;
  purchaseTaxPct?: number;
  taxExempt?: boolean;
  recoverByMonth?: number;
  deprPct?: number;
  lifeMonths?: number;
  /** From month 13 on, pay this % of the year-one payment. */
  stepPct?: number | null;
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
  /** Flow only; the end date is the start plus the term. */
  flow?: FlowOrderTerms;
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
  const isFlow = input.type === "FLOW";
  if (input.lines.length === 0) {
    return {
      status: "error",
      message: "Add at least one line — an order with nothing on it can't be priced.",
    };
  }

  // Calendar days at noon UTC (lib/billing/calendar). `new Date("YYYY-MM-DD")`
  // stored UTC midnight, which every Pacific screen then showed a day early.
  // The term must be one of the offered lengths — not merely positive — since it
  // drives O(termMonths) loops through the Flow pricing engine.
  const rawFlowTerm = Math.round(Number(input.flow?.termMonths) || 0);
  if (isFlow && !isFlowTerm(rawFlowTerm)) {
    return { status: "error", message: FLOW_TERMS_MESSAGE };
  }
  const flowTerm = isFlow ? rawFlowTerm : 0;
  const start = parseDateInput(input.start);
  const requestedEnd = parseDateInput(input.end);
  if (!start || (input.type !== "SALE" && !isFlow && !requestedEnd)) {
    return { status: "error", message: "Choose the order's dates." };
  }
  // A sale has no term: it stores its order date as both. A Flow order runs
  // exactly its term, whatever end was sent.
  const end = input.type === "SALE" ? start
    : isFlow ? addTermMonths(start, flowTerm)
    : requestedEnd!;
  if (input.type !== "SALE" && !(start < end)) {
    return {
      status: "error",
      message: "The order has to end after it starts.",
    };
  }

  const overbooked = input.lines.filter((line) => line.overbooked);

  const payload: Parameters<typeof createReservation>[0] = {
    clientId: input.clientId,
    reservationType: input.type,
    startDate: start,
    endDate: end,
    projectName: input.projectName || undefined,
    ...(input.type === "RENT_TO_OWN" && input.rtoTermMonths
      ? { rtoTermMonths: input.rtoTermMonths }
      : {}),
    ...(isFlow && input.flow
      ? {
          flowTermMonths: flowTerm,
          flowMarginPct: input.flow.marginPct,
          flowFinancePct: input.flow.financePct,
          flowPurchaseTaxPct: input.flow.purchaseTaxPct,
          flowTaxExempt: input.flow.taxExempt,
          flowRecoverByMonth: input.flow.recoverByMonth,
          flowDeprPct: input.flow.deprPct,
          flowLifeMonths: input.flow.lifeMonths,
          flowStepPct: input.flow.stepPct ?? null,
        }
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
      // A Flow line bills monthly from the order's schedule; its catalog pricing
      // type means nothing there.
      pricingType: (isFlow ? "MONTHLY" : line.pricingType) as PricingType,
      ...(isFlow && line.costBasis != null ? { costBasis: line.costBasis } : {}),
    })),
  };

  let created: Awaited<ReturnType<typeof createReservation>>;
  try {
    created = await createReservation(payload);
  } catch (error) {
    // A Flow order is refused, and nothing written, when it can't be priced:
    // gear whose landed cost is incomplete, or a schedule that isn't feasible.
    // Those reasons are for the person building it, so hand them back.
    if (!isFlow) throw error;
    return {
      status: "error",
      message: error instanceof Error ? error.message : "This Flow order couldn't be priced. Nothing was saved.",
    };
  }

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
