"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireEditor } from "@/lib/auth-utils";
import { actorFor, decide, historyFor, isApprover } from "@/lib/approvals/core";
import { mayEditFunding } from "@/lib/procurement/access";
import type {
  CustomerCommitment,
  FundingPurchaseType,
} from "@/generated/prisma/client";
import {
  attachPurchaseOrderToFundingRequest,
  attachReservationToFundingRequest,
  cancelFundingRequest,
  createFundingRequest,
  detachPurchaseOrderFromFundingRequest,
  detachReservationFromFundingRequest,
  markFundingRequestFulfilled,
  markFundingRequestFunded,
  reviseFundingRequest,
  submitFundingRequest,
  updateFundingRequest,
  type AccountingDispatch,
  type FundingRequestFormData,
} from "@/lib/actions/funding-requests";
import {
  CUSTOMER_COMMITMENT_LABEL,
  FUNDING_LOCKED,
  FUNDING_PURCHASE_TYPE_LABEL,
} from "@/lib/procurement/funding-labels";

/**
 * Funding requests, as outcomes a screen can render.
 *
 * The same shape as `lib/actions/accounts.ts`: the ported actions in
 * `lib/actions/funding-requests.ts` hold the transactions and the lifecycle
 * guards and throw when refused, and a form needs a sentence it can show. This
 * layer also does the checking v1 left to its client-side schema — which in v2
 * would mean trusting whatever reached the server action.
 *
 * The form sends every field as the string that was typed. Parsing here, once,
 * means a blank is always "not given" and never a zero: on a request, an empty
 * interest rate and a 0% loan are different statements, and the payback
 * markers treat them differently.
 */

export type FundingOutcome =
  | { status: "ok"; id: string; message?: string }
  | { status: "error"; message: string };

export type FundingItemInput = {
  description: string;
  quantity: string;
  unitCost: string;
};

export type FundingRequestInput = {
  requestedBy: string;
  /** yyyy-mm-dd, as a date input gives it. */
  requestDate: string;
  neededByDate: string;
  amountRequested: string;
  businessPurpose: string;

  purchaseType: FundingPurchaseType | "";
  equipmentSummary: string;
  items: FundingItemInput[];
  clientId: string;
  projectName: string;
  customerCommitment: CustomerCommitment | "";
  customerRentalRate: string;
  billableUnits: string;
  /** Only read when rate × units cannot be derived. */
  customerRentalCharge: string;
  expectedInitialRevenue: string;
  rentalPeriod: string;
  paymentTerms: string;

  lender: string;
  amountBorrowed: string;
  /** A percentage as typed — 6.5 — stored as the fraction 0.065. */
  interestRatePercent: string;
  termMonths: string;
  monthlyPayment: string;
  financingFees: string;
  estimatedTotalInterest: string;
  firstPaymentDate: string;
  expectedPayoffDate: string;

  expectedGrossProfit: string;
  estimatedPaybackMonths: string;
  expectedAnnualUtilization: string;
  expectedHoldMonths: string;
  expectedAnnualRevenue: string;
  estimatedResaleValue: string;
  exitPlan: string;

  alternateUsePlan: string;
  borrowRationale: string;

  leaseId: string;
  notes: string;

  /** Create only: the PO a request was started from (`?po=`). */
  purchaseOrderIds?: string[];
};

/** The largest value a `Decimal(12, 2)` column holds. */
const MONEY_MAX = 9_999_999_999.99;

class InputError extends Error {}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseMoney(value: string, label: string, { allowNegative = false } = {}): number | null {
  const raw = value.trim().replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new InputError(`${label} is not a number.`);
  if (!allowNegative && n < 0) throw new InputError(`${label} cannot be negative.`);
  if (Math.abs(n) > MONEY_MAX) throw new InputError(`${label} is larger than the system can store.`);
  return Math.round(n * 100) / 100;
}

function parseWhole(value: string, label: string, { min = 0, max = 100_000 } = {}): number | null {
  const raw = value.trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new InputError(`${label} is a whole number.`);
  if (n < min || n > max) throw new InputError(`${label} must be between ${min} and ${max}.`);
  return n;
}

function parsePercent(value: string, label: string): number | null {
  const raw = value.trim().replace(/%/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new InputError(`${label} is a percentage between 0 and 100.`);
  }
  return n;
}

/**
 * A calendar day, stored at noon UTC. Midnight UTC is the previous evening
 * anywhere west of Greenwich, and this business is in the Americas — a request
 * dated the 1st would print as the 31st.
 */
function parseDay(value: string, label: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new InputError(`${label} is not a date.`);
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a date.`);
  return date;
}

function oneOfKeys<T extends string>(value: string, labels: Record<T, string>, label: string): T | null {
  if (!value) return null;
  if (!(value in labels)) throw new InputError(`${label} is not one of the choices.`);
  return value as T;
}

async function toFormData(input: FundingRequestInput): Promise<FundingRequestFormData> {
  const requestedBy = text(input.requestedBy);
  if (!requestedBy) throw new InputError("Say who is requesting the funds.");

  const requestDate = parseDay(input.requestDate, "Request date");
  if (!requestDate) throw new InputError("A request needs its date.");

  const amountRequested = parseMoney(input.amountRequested, "Amount requested");
  if (amountRequested === null) throw new InputError("Enter the amount requested.");

  const purchaseType = oneOfKeys(input.purchaseType, FUNDING_PURCHASE_TYPE_LABEL, "Purchase type");
  // Required, as on v1's form: it decides how the return is read — a resale
  // earns once, a rental every month — so a request without it is unreviewable.
  if (!purchaseType) throw new InputError("Say what the hardware is for — rental, resale or cloud.");

  // A row left entirely blank is an unused row, not an invalid one.
  const items = input.items
    .filter((item) => item.description.trim() || item.quantity.trim() || item.unitCost.trim())
    .map((item, index) => {
      const description = text(item.description);
      const row = `Equipment line ${index + 1}`;
      if (!description) throw new InputError(`${row} needs a description.`);
      const quantity = parseWhole(item.quantity || "1", `${row} quantity`, { min: 1 });
      const unitCost = parseMoney(item.unitCost || "0", `${row} unit cost`);
      return { description, quantity: quantity ?? 1, unitCost: unitCost ?? 0 };
    });

  const customerRentalRate = parseMoney(input.customerRentalRate, "Rental rate");
  const billableUnits = parseWhole(input.billableUnits, "Billable units");
  // Derived, not typed, whenever it can be: the payback markers divide the
  // whole request's cost by this total, and a per-unit rate typed into it reads
  // as a payback several times too long. v1's form made the same call.
  const customerRentalCharge =
    customerRentalRate !== null && billableUnits
      ? Math.round(customerRentalRate * billableUnits * 100) / 100
      : parseMoney(input.customerRentalCharge, "Monthly rental charge");

  const interestPercent = parsePercent(input.interestRatePercent, "Interest rate");

  const clientId = text(input.clientId);
  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new InputError("That customer no longer exists.");
  }

  const leaseId = text(input.leaseId);
  if (leaseId) {
    const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { id: true } });
    if (!lease) throw new InputError("That loan no longer exists.");
  }

  return {
    requestedBy,
    requestDate,
    neededByDate: parseDay(input.neededByDate, "Funding needed by"),
    amountRequested,
    businessPurpose: text(input.businessPurpose),

    purchaseType,
    equipmentSummary: text(input.equipmentSummary),
    items,
    clientId,
    projectName: text(input.projectName),
    customerCommitment: oneOfKeys(
      input.customerCommitment,
      CUSTOMER_COMMITMENT_LABEL,
      "Customer commitment",
    ),
    customerRentalRate,
    billableUnits,
    customerRentalCharge,
    expectedInitialRevenue: parseMoney(input.expectedInitialRevenue, "Expected initial revenue"),
    rentalPeriod: text(input.rentalPeriod),
    paymentTerms: text(input.paymentTerms),

    lender: text(input.lender),
    amountBorrowed: parseMoney(input.amountBorrowed, "Amount borrowed"),
    interestRate: interestPercent === null ? null : Math.round(interestPercent * 100) / 10_000,
    termMonths: parseWhole(input.termMonths, "Term", { max: 600 }),
    monthlyPayment: parseMoney(input.monthlyPayment, "Monthly payment"),
    financingFees: parseMoney(input.financingFees, "Fees"),
    estimatedTotalInterest: parseMoney(input.estimatedTotalInterest, "Estimated total interest"),
    firstPaymentDate: parseDay(input.firstPaymentDate, "First payment date"),
    expectedPayoffDate: parseDay(input.expectedPayoffDate, "Expected payoff date"),

    // A loss on the initial rental is a real answer, so this one may be negative.
    expectedGrossProfit: parseMoney(input.expectedGrossProfit, "Expected gross profit", {
      allowNegative: true,
    }),
    estimatedPaybackMonths: parseWhole(input.estimatedPaybackMonths, "Estimated payback", { max: 600 }),
    expectedAnnualUtilization: parsePercent(input.expectedAnnualUtilization, "Expected utilization"),
    expectedHoldMonths: parseWhole(input.expectedHoldMonths, "Hold period", { max: 600 }),
    expectedAnnualRevenue: parseMoney(input.expectedAnnualRevenue, "Ongoing annual revenue"),
    estimatedResaleValue: parseMoney(input.estimatedResaleValue, "Estimated resale value"),
    exitPlan: text(input.exitPlan),

    alternateUsePlan: text(input.alternateUsePlan),
    borrowRationale: text(input.borrowRationale),

    leaseId,
    notes: text(input.notes),
  };
}

function failure(error: unknown, fallback: string): FundingOutcome {
  return {
    status: "error",
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}

/**
 * The role floor for each export. Phase 6 (docs/procurement.md): STAFF raise
 * and move their own requests — the ported actions check ownership — while
 * funding, fulfilling, canceling and the evidence joins stay with admins.
 */
async function gate(floor: "editor" | "admin" = "admin"): Promise<FundingOutcome | null> {
  const auth = floor === "editor" ? await requireEditor() : await requireAdmin();
  return auth.authorized
    ? null
    : { status: "error", message: auth.error ?? "Unauthorized" };
}

export async function createFunding(input: FundingRequestInput): Promise<FundingOutcome> {
  const denied = await gate("editor");
  if (denied) return denied;

  try {
    const data = await toFormData(input);

    // Only the PO the request was started from arrives this way; anything
    // else is attached on the record. Checked here so a stale link fails with a
    // sentence rather than a Prisma connect error.
    const poIds = Array.from(new Set(input.purchaseOrderIds ?? []));
    if (poIds.length > 0) {
      const found = await prisma.purchaseOrder.findMany({
        where: { id: { in: poIds }, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (found.length !== poIds.length) {
        throw new InputError("The purchase order this was started from is gone or canceled.");
      }
    }

    const created = await createFundingRequest({
      ...data,
      purchaseOrderIds: poIds,
      reservationIds: [],
    });
    return { status: "ok", id: (created as { id: string }).id };
  } catch (error) {
    return failure(error, "That request could not be created.");
  }
}

export async function updateFunding(id: string, input: FundingRequestInput): Promise<FundingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  try {
    const existing = await prisma.fundingRequest.findUnique({
      where: { id },
      select: { status: true, requestedById: true },
    });
    if (!existing) return { status: "error", message: "That funding request no longer exists." };
    if (FUNDING_LOCKED.includes(existing.status)) {
      return {
        status: "error",
        message: "A fulfilled or canceled request is the record of what happened — it is not edited.",
      };
    }
    if (!mayEditFunding({ id: auth.userId, role: auth.role }, existing)) {
      return {
        status: "error",
        message: "Staff edit their own draft requests. An administrator can change this one.",
      };
    }

    const data = await toFormData(input);
    // No join ids: the update leaves attachments exactly as they are.
    const saved = (await updateFundingRequest(id, data)) as {
      approval: { message: string } | null;
    };
    return { status: "ok", id, message: saved.approval?.message };
  } catch (error) {
    return failure(error, "That request could not be saved.");
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * What to tell the person who just pressed Submit about the email.
 *
 * On this instance the honest answer is almost always that nothing went out —
 * no Resend key, or no recipient with funding notifications switched on — and
 * a confirmation that implies accounting has the request would be the one
 * fabricated statement on the screen.
 */
function describeDispatch(dispatch: AccountingDispatch): string {
  const filed = dispatch.documentOnFile
    ? "The request form is saved to the record."
    : "The request form could not be saved to the record.";

  if (dispatch.recipients === 0) {
    return `${filed} Nobody was emailed: no notification recipient has funding requests switched on.`;
  }
  if (dispatch.sent === 0) {
    return `${filed} Nobody was emailed — outbound email is switched off on this instance${
      dispatch.error ? ` (${dispatch.error})` : ""
    }.`;
  }
  return `${filed} Emailed ${dispatch.sent} of ${dispatch.recipients} funding recipients.`;
}

async function step(
  id: string,
  run: () => Promise<unknown>,
  fallback: string,
  message?: (result: unknown) => string | undefined,
  floor: "editor" | "admin" = "admin",
): Promise<FundingOutcome> {
  const denied = await gate(floor);
  if (denied) return denied;
  try {
    const result = await run();
    return { status: "ok", id, message: message?.(result) };
  } catch (error) {
    return failure(error, fallback);
  }
}

export async function submitFunding(id: string): Promise<FundingOutcome> {
  return step(
    id,
    () => submitFundingRequest(id),
    "That request could not be submitted.",
    (result) => {
      const { dispatch, approval } = result as {
        dispatch: AccountingDispatch;
        approval: { message: string };
      };
      return `${approval.message} ${describeDispatch(dispatch)}`;
    },
    "editor",
  );
}

export async function reviseFunding(id: string): Promise<FundingOutcome> {
  return step(
    id,
    () => reviseFundingRequest(id),
    "That request could not be pulled back.",
    () => "Back to draft. The open request for approval was withdrawn; submitting again asks again.",
    "editor",
  );
}

/**
 * Approve or decline a submitted request — the approval decision, made through
 * `lib/approvals` so it is recorded from the session, refused to its requester,
 * and never edited afterwards. v1's three typed sign-off names are gone from
 * this path; what they recorded was what somebody typed.
 *
 * A request submitted before approvals were recorded (v1 has one) has no open
 * ask to decide. It gets one here, in its original requester's name, and is
 * decided in the same breath — so approving it still leaves a trail that says
 * who asked and who answered.
 */
async function decideFunding(id: string, approve: boolean, reason: string | null): Promise<FundingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const request = await prisma.fundingRequest.findUnique({
    where: { id },
    select: { status: true, requestNumber: true, requestedBy: true, requestedById: true, amountRequested: true },
  });
  if (!request) return { status: "error", message: "That funding request no longer exists." };
  if (request.status !== "SUBMITTED") {
    return {
      status: "error",
      message: `${request.requestNumber} is not waiting on a decision. A decision, once made, is not changed — pull it back to draft and submit it again to ask again.`,
    };
  }

  const actor = await actorFor(auth.userId, auth.role);
  if (!(await isApprover(actor, "FUNDING_REQUEST"))) {
    return {
      status: "error",
      message: "You are not an approver for funding requests. A super admin sets that in Settings → Users.",
    };
  }

  let pending = (await historyFor("FUNDING_REQUEST", id)).find((row) => row.status === "PENDING");
  if (!pending) {
    if (request.requestedById === auth.userId) {
      return { status: "error", message: "You raised this request, so another approver has to decide it." };
    }
    pending = await prisma.approvalRequest.create({
      data: {
        recordType: "FUNDING_REQUEST",
        recordId: id,
        recordLabel: request.requestNumber,
        requestedById: request.requestedById,
        requestedByName: request.requestedBy,
        amountAtRequest: request.amountRequested,
        note: "Submitted before approvals were recorded",
      },
    });
  }

  const outcome = await decide(pending.id, actor, approve, reason);
  revalidatePath(`/dashboard/funding/${id}`);
  revalidatePath("/dashboard/funding");
  revalidatePath("/dashboard/approvals");
  return outcome.status === "ok"
    ? { status: "ok", id, message: outcome.message }
    : { status: "error", message: outcome.message };
}

export async function approveFunding(id: string): Promise<FundingOutcome> {
  return decideFunding(id, true, null);
}

export async function declineFunding(id: string, reason: string): Promise<FundingOutcome> {
  // v1 accepted a decline with no reason. The reason is the only thing a
  // declined request is for — the requester reads it to decide whether to
  // revise — so v2 asks for one.
  const why = text(reason);
  if (!why) return { status: "error", message: "Say why it was declined." };
  return decideFunding(id, false, why);
}

export async function fundFunding(id: string, leaseId: string): Promise<FundingOutcome> {
  return step(
    id,
    () => markFundingRequestFunded(id, text(leaseId)),
    "That request could not be marked funded.",
    (result) => {
      const moved = (result as { purchaseOrdersMoved: number }).purchaseOrdersMoved;
      return moved > 0
        ? `${moved} attached purchase ${moved === 1 ? "order" : "orders"} moved onto the loan, with the units received against ${moved === 1 ? "it" : "them"}.`
        : undefined;
    },
  );
}

export async function fulfilFunding(id: string): Promise<FundingOutcome> {
  return step(id, () => markFundingRequestFulfilled(id), "That request could not be closed out.");
}

export async function cancelFunding(id: string): Promise<FundingOutcome> {
  return step(id, () => cancelFundingRequest(id), "That request could not be canceled.");
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export async function attachPurchaseOrder(id: string, poId: string): Promise<FundingOutcome> {
  if (!poId) return { status: "error", message: "Pick a purchase order to attach." };
  return step(
    id,
    () => attachPurchaseOrderToFundingRequest(id, poId),
    "That purchase order could not be attached.",
  );
}

export async function detachPurchaseOrder(id: string, poId: string): Promise<FundingOutcome> {
  return step(
    id,
    () => detachPurchaseOrderFromFundingRequest(id, poId),
    "That purchase order could not be detached.",
  );
}

export async function attachOrder(id: string, reservationId: string): Promise<FundingOutcome> {
  if (!reservationId) return { status: "error", message: "Pick an order to attach." };
  const outcome = await step(
    id,
    () => attachReservationToFundingRequest(id, reservationId),
    "That order could not be attached.",
  );
  if (outcome.status === "ok") revalidatePath(`/dashboard/orders/${reservationId}`);
  return outcome;
}

export async function detachOrder(id: string, reservationId: string): Promise<FundingOutcome> {
  const outcome = await step(
    id,
    () => detachReservationFromFundingRequest(id, reservationId),
    "That order could not be detached.",
  );
  if (outcome.status === "ok") revalidatePath(`/dashboard/orders/${reservationId}`);
  return outcome;
}
