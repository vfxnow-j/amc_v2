"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { updateFlowLineBasis, updateReservation } from "@/lib/actions/reservations";
import { markFlowAutopaySetup, updateFlowExtensionPct } from "@/lib/actions/flow-terms";
import { flowKnobsProblem } from "@/lib/flow/knob-bounds";
import { FLOW_TERMS_MESSAGE, isFlowTerm } from "@/lib/flow/terms";
import type { StageOutcome } from "@/lib/actions/order-stage";

/**
 * The Flow controls on the order record, each returning one `StageOutcome`.
 *
 * The same reason `order-stage.ts` exists: the ported Flow actions throw, and a
 * thrown message is redacted in production, so a refusal like "the client
 * agreed to these terms" would reach the screen as a generic error. These wrap
 * them and hand the message back as data. Nothing is re-implemented — the locks,
 * the reprice and the audit stay in the actions they were ported into.
 *
 * A 'use server' module: async exports only.
 */

function reasonFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "That did not work. Try again, or check the order's status.";
}

function touch(id: string) {
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
}

/** One line's cost basis per unit. Sent by line id — never matched by asset. */
export async function setFlowLineBasis(
  reservationId: string,
  itemId: string,
  basis: number,
): Promise<StageOutcome> {
  if (!Number.isFinite(basis) || basis <= 0) {
    return { status: "error", message: "Enter a cost basis above $0." };
  }
  try {
    await updateFlowLineBasis(reservationId, itemId, basis);
    touch(reservationId);
    return { status: "ok", message: "Cost basis updated; the Flow schedule was repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export type FlowTermsInput = {
  termMonths: number;
  marginPct: number;
  financePct: number;
  purchaseTaxPct: number;
  taxExempt: boolean;
  recoverByMonth: number;
  /** Null returns to the recover-by-month shape. */
  stepPct: number | null;
  /** Null returns to the settings default. */
  extensionPct: number | null;
};

/**
 * The Edit terms dialog: the term and the pricing knobs (through
 * updateReservation, which reprices every line and the schedule and refuses once
 * the terms are agreed or billed), then the extension rate if it changed.
 */
export async function saveFlowTerms(
  reservationId: string,
  input: FlowTermsInput,
): Promise<StageOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error || "Edit access required" };

  if (!isFlowTerm(input.termMonths)) return { status: "error", message: FLOW_TERMS_MESSAGE };
  const problem = flowKnobsProblem({
    marginPct: input.marginPct,
    financePct: input.financePct,
    purchaseTaxPct: input.purchaseTaxPct,
    recoverByMonth: input.recoverByMonth,
    stepPct: input.stepPct,
  });
  if (problem) return { status: "error", message: problem };
  if (
    input.extensionPct != null &&
    (!Number.isFinite(input.extensionPct) || input.extensionPct < 0 || input.extensionPct > 100)
  ) {
    return { status: "error", message: "Extension % must be between 0 and 100." };
  }

  try {
    const before = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { reservationType: true, flowExtensionPct: true },
    });
    if (!before || before.reservationType !== "FLOW") {
      return { status: "error", message: "Only a Flow order has Flow terms." };
    }
    await updateReservation(reservationId, {
      flowTermMonths: input.termMonths,
      flowMarginPct: input.marginPct,
      flowFinancePct: input.financePct,
      flowPurchaseTaxPct: input.purchaseTaxPct,
      flowTaxExempt: input.taxExempt,
      flowRecoverByMonth: input.recoverByMonth,
      flowStepPct: input.stepPct,
    });
    const storedExtension = before.flowExtensionPct == null ? null : Number(before.flowExtensionPct);
    if (storedExtension !== input.extensionPct) {
      await updateFlowExtensionPct(reservationId, input.extensionPct);
    }
    touch(reservationId);
    return { status: "ok", message: "Flow terms saved; every line and the schedule were repriced." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Staff confirm the recurring charge is set up in the billing system. */
export async function markFlowAutopaySetUp(reservationId: string): Promise<StageOutcome> {
  try {
    await markFlowAutopaySetup(reservationId);
    touch(reservationId);
    return { status: "ok", message: "Autopay marked as set up." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}
