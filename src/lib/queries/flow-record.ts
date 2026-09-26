import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { flowInputsForOrder } from "@/lib/flow/order-inputs";
import { orderAssumption } from "@/lib/flow/funding";
import { priceFlowLines, type FlowPricedLines } from "@/lib/pricing/flow-lines";
import { FLOW_LEASE_ASSUMPTION } from "@/lib/pricing/lease-funding";
import { flowTermsForReservation, loadFlowTermsSettings } from "@/lib/flow-terms-server";
import {
  flowAgreementView,
  flowEconomicsView,
  flowScheduleRows,
  flowTermsLock,
  flowTermsView,
} from "@/lib/flow/record-view";

/**
 * Everything the three Flow cards on an order's record read, in one pass.
 *
 * Priced on every render from flowInputsForOrder() — the inputs the repricer
 * stores from — so a lease's terms changing shows here at once, with nothing
 * re-saved. Wrapped in React `cache()`: the terms, schedule and economics cards
 * each sit behind their own Suspense boundary and each call this, and the order
 * is read and priced once per request, not three times.
 *
 * Null when the order is missing or not a Flow order. `priced` is null when it
 * has no term yet; `problem` then (or when a line is unpriced) says why.
 */
export const getFlowRecord = cache(async function getFlowRecord(id: string) {
  const order = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      reservationType: true,
      startDate: true,
      flowStartDate: true,
      flowTermMonths: true,
      flowPeriodsBilled: true,
      flowMarginPct: true,
      flowFinancePct: true,
      flowPurchaseTaxPct: true,
      flowTaxExempt: true,
      flowRecoverByMonth: true,
      flowStepPct: true,
      flowExtensionPct: true,
      flowTermsSnapshot: true,
      flowTermsVersion: true,
      flowAutopayMethod: true,
      flowAutopayAuthorizedBy: true,
      flowAutopaySetupAt: true,
      flowAutopaySetupById: true,
      flowAssumedAprPct: true,
      flowAssumedNoteMonths: true,
    },
  });
  if (!order || order.reservationType !== "FLOW") return null;

  const [inputs, terms, settings, setupBy] = await Promise.all([
    flowInputsForOrder(prisma, id),
    flowTermsForReservation(id).catch(() => null),
    loadFlowTermsSettings(),
    order.flowAutopaySetupById
      ? prisma.user.findUnique({ where: { id: order.flowAutopaySetupById }, select: { name: true } })
      : null,
  ]);

  const lines = (inputs?.lines ?? []).filter((line) => !line.parentId);
  const priced: FlowPricedLines | null =
    inputs?.config && lines.length ? priceFlowLines(lines, inputs.config) : null;

  const start = order.flowStartDate ?? order.startDate;
  const periodsBilled = order.flowPeriodsBilled ?? 0;
  const num = (value: unknown) => (value == null ? null : Number(value));
  const lock = flowTermsLock(order);

  return {
    id,
    status: order.status,
    lock,
    problem: !inputs?.config
      ? "This Flow order has no term yet, so there is nothing to price."
      : !lines.length
        ? "This Flow order has no lines yet — add one to price it."
        : priced?.problem ?? null,
    /** What the Edit terms dialog opens with: the order's stored knobs. */
    knobs: inputs?.config
      ? {
          termMonths: inputs.config.termMonths,
          marginPct: inputs.config.marginPct,
          financePct: inputs.config.financePct,
          purchaseTaxPct: inputs.config.purchaseTaxPct,
          taxExempt: inputs.config.taxExempt,
          recoverByMonth: inputs.config.recoverByMonth,
          stepPct: num(order.flowStepPct),
          extensionPct: num(order.flowExtensionPct),
        }
      : null,
    defaultExtensionPct: settings.extensionPct,
    terms: priced
      ? flowTermsView(priced.result, {
          termMonths: priced.result.schedule.termMonths,
          start,
          periodsBilled,
          stepPct: num(order.flowStepPct),
          extensionPct: num(order.flowExtensionPct),
          defaultExtensionPct: settings.extensionPct,
          terms,
        })
      : null,
    agreement: {
      ...flowAgreementView(order),
      setupBy: setupBy?.name ?? null,
    },
    schedule: priced ? flowScheduleRows(priced.result, start, periodsBilled) : null,
    economics:
      priced && inputs
        ? flowEconomicsView(
            lines,
            inputs.funding,
            priced.result,
            orderAssumption(order, {
              aprPct: inputs.defaults.assumedAprPct,
              noteMonths: FLOW_LEASE_ASSUMPTION.noteMonths,
            }),
          )
        : null,
  };
});

export type FlowRecord = NonNullable<Awaited<ReturnType<typeof getFlowRecord>>>;
