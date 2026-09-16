import type { FundingRequestInput } from "@/lib/procurement/funding";
import type { FundingRecord } from "@/lib/queries/funding";
import type { FundingRequestPrefill } from "@/lib/actions/funding-requests";

/**
 * The form's starting values, for a new request and for an edit.
 *
 * The form holds every field as the string that will be typed, so these turn
 * stored values back into text: a null becomes an empty box, never "0", and
 * the stored interest fraction is shown as the percentage it was typed as.
 */

/** yyyy-mm-dd of a stored day. Read in UTC, matching how the form writes it (noon UTC). */
function isoDay(value: Date | string | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function str(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function blankFundingInput(requestedBy: string, today: Date): FundingRequestInput {
  return {
    requestedBy,
    requestDate: isoDay(today),
    neededByDate: "",
    amountRequested: "",
    businessPurpose: "",
    purchaseType: "",
    equipmentSummary: "",
    items: [],
    clientId: "",
    projectName: "",
    customerCommitment: "",
    customerRentalRate: "",
    billableUnits: "",
    customerRentalCharge: "",
    expectedInitialRevenue: "",
    rentalPeriod: "",
    paymentTerms: "",
    lender: "",
    amountBorrowed: "",
    interestRatePercent: "",
    termMonths: "",
    monthlyPayment: "",
    financingFees: "",
    estimatedTotalInterest: "",
    firstPaymentDate: "",
    expectedPayoffDate: "",
    expectedGrossProfit: "",
    estimatedPaybackMonths: "",
    expectedAnnualUtilization: "",
    expectedHoldMonths: "",
    expectedAnnualRevenue: "",
    estimatedResaleValue: "",
    exitPlan: "",
    alternateUsePlan: "",
    borrowRationale: "",
    leaseId: "",
    notes: "",
    purchaseOrderIds: [],
  };
}

/**
 * A new request seeded from a purchase order (v1's `getFundingRequestPrefillFromPO`):
 * the lines as the equipment list, the PO total as the ask, the PO's loan and
 * lender, and the PO attached. Dates and the business case stay blank.
 */
export function prefilledFundingInput(
  base: FundingRequestInput,
  prefill: FundingRequestPrefill,
): FundingRequestInput {
  return {
    ...base,
    purchaseType: prefill.purchaseType ?? "",
    amountRequested: prefill.amountRequested.toFixed(2),
    items: prefill.items.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitCost: item.unitCost.toFixed(2),
    })),
    leaseId: prefill.leaseId ?? "",
    lender: prefill.lender ?? "",
    purchaseOrderIds: prefill.purchaseOrderIds,
  };
}

export function fundingInputFrom(record: FundingRecord): FundingRequestInput {
  return {
    requestedBy: record.requestedBy,
    requestDate: isoDay(record.requestDate),
    neededByDate: isoDay(record.neededByDate),
    amountRequested: record.amountRequested.toFixed(2),
    businessPurpose: record.businessPurpose ?? "",
    purchaseType: record.purchaseType ?? "",
    equipmentSummary: record.equipmentSummary ?? "",
    items: record.items.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitCost: item.unitCost.toFixed(2),
    })),
    clientId: record.clientId ?? "",
    projectName: record.projectName ?? "",
    customerCommitment: record.customerCommitment ?? "",
    customerRentalRate: str(record.customerRentalRate),
    billableUnits: str(record.billableUnits),
    customerRentalCharge: str(record.customerRentalCharge),
    expectedInitialRevenue: str(record.expectedInitialRevenue),
    rentalPeriod: record.rentalPeriod ?? "",
    paymentTerms: record.paymentTerms ?? "",
    lender: record.lender ?? "",
    amountBorrowed: str(record.amountBorrowed),
    // Rounded back to the two places it was typed with; a raw ×100 on a
    // stored 0.0650 prints 6.500000000000001.
    interestRatePercent:
      record.interestRate === null ? "" : String(Math.round(record.interestRate * 10_000) / 100),
    termMonths: str(record.termMonths),
    monthlyPayment: str(record.monthlyPayment),
    financingFees: str(record.financingFees),
    estimatedTotalInterest: str(record.estimatedTotalInterest),
    firstPaymentDate: isoDay(record.firstPaymentDate),
    expectedPayoffDate: isoDay(record.expectedPayoffDate),
    expectedGrossProfit: str(record.expectedGrossProfit),
    estimatedPaybackMonths: str(record.estimatedPaybackMonths),
    expectedAnnualUtilization: str(record.expectedAnnualUtilization),
    expectedHoldMonths: str(record.expectedHoldMonths),
    expectedAnnualRevenue: str(record.expectedAnnualRevenue),
    estimatedResaleValue: str(record.estimatedResaleValue),
    exitPlan: record.exitPlan ?? "",
    alternateUsePlan: record.alternateUsePlan ?? "",
    borrowRationale: record.borrowRationale ?? "",
    leaseId: record.leaseId ?? "",
    notes: record.notes ?? "",
  };
}
