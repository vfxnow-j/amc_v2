"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { createLease, deleteLease, type LeaseStatus } from "@/lib/actions/leases";
import { actorFor, isApprover } from "@/lib/approvals/core";
import { businessToday, calendarDay, parseDateInput } from "@/lib/billing/calendar";
import { dayYear } from "@/lib/format";
import { nextNumber } from "@/lib/numbering/next";
import { isProcurementAdmin } from "@/lib/procurement/access";

/**
 * Creating leases: by hand from Accounting → Leases, and as a placeholder when a
 * funding request is approved.
 *
 * Both go through the ported `createLease` — editor access, one transaction —
 * and neither attaches units. A lease's units arrive later, through the purchase
 * orders funded against it (`markFundingRequestFunded` moves them), so picking
 * units at creation would be a second, disconnected way to say the same thing.
 * `createLease` throws; these return the house `{status, message}` shape.
 *
 * **Term drives the end date.** The form takes a start date and a term in whole
 * months and derives the end, rather than the reverse: a lender quotes "36
 * months", and an end date typed by hand is the figure that drifts from it. The
 * end is the same day of the month `termMonths` later, pulled back to the month's
 * last day when that month is shorter (Jan 31 + 1 → Feb 28). Dates are stored as
 * calendar days, noon UTC, per `lib/billing/calendar`.
 *
 * Interest is typed as a percentage and stored as a fraction, as
 * `Lease.interestRate` and `FundingRequest.interestRate` both are.
 */

export type LeaseOutcome =
  | { status: "ok"; id: string; message: string }
  | { status: "error"; message: string };

const STATUSES: LeaseStatus[] = ["ACTIVE", "PAID_OFF", "DEFAULTED", "TRANSFERRED"];

/** `termMonths` after `start`, clamped to the end of a shorter month. */
function addMonths(start: Date, months: number): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return calendarDay(year, month, Math.min(start.getUTCDate(), lastDay));
}

/** The number the form suggests: Settings → Business → Numbering, as `seedLeasesFromNotOwned` uses. */
export async function suggestLeaseNumber(): Promise<string | null> {
  const auth = await requireEditor();
  if (!auth.authorized) return null;
  return nextNumber("lease");
}

export type NewLeaseInput = {
  leaseName: string;
  leaseNumber: string;
  lender: string;
  /** Everything numeric arrives as typed, so blank is never silently zero. */
  totalAmount: string;
  monthlyPayment: string;
  interestPercent: string;
  /** yyyy-mm-dd */
  startDate: string;
  termMonths: string;
  status: string;
  notes: string;
};

function money(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

export async function createLeaseEntry(input: NewLeaseInput): Promise<LeaseOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const leaseName = input.leaseName.trim();
  const leaseNumber = input.leaseNumber.trim();
  const lender = input.lender.trim();
  if (!leaseName) return { status: "error", message: "Give the lease a name." };
  if (!leaseNumber) return { status: "error", message: "Give the lease a number." };
  if (!lender) return { status: "error", message: "Name the lender." };

  const totalAmount = money(input.totalAmount);
  if (totalAmount === null) return { status: "error", message: "Enter the amount financed, zero or more." };
  const monthlyPayment = money(input.monthlyPayment);
  if (monthlyPayment === null) return { status: "error", message: "Enter the monthly payment, zero or more." };

  const percent = Number(input.interestPercent.trim());
  // Decimal(5,4) holds a fraction below 10; nothing near that is a real rate.
  if (input.interestPercent.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent >= 100) {
    return { status: "error", message: "Enter the interest rate as a percentage, 0 to under 100." };
  }

  const startDate = parseDateInput(input.startDate);
  if (!startDate) return { status: "error", message: "Enter the start date." };

  const termMonths = Number(input.termMonths.trim());
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600) {
    return { status: "error", message: "Enter the term as a whole number of months, 1 or more." };
  }

  const status = STATUSES.includes(input.status as LeaseStatus) ? (input.status as LeaseStatus) : "ACTIVE";

  const taken = await prisma.lease.findUnique({ where: { leaseNumber }, select: { id: true } });
  if (taken) return { status: "error", message: `${leaseNumber} is already a lease number.` };

  try {
    const lease = (await createLease({
      assetUnitIds: [],
      leaseName,
      leaseNumber,
      lender,
      totalAmount,
      monthlyPayment,
      interestRate: Math.round(percent * 100) / 10000,
      startDate,
      endDate: addMonths(startDate, termMonths),
      termMonths,
      status,
      paidOffDate: null,
      notes: input.notes.trim() || null,
    })) as { id: string };
    return { status: "ok", id: lease.id, message: `${leaseNumber} created.` };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not create the lease.",
    };
  }
}

/**
 * A provisional lease for an approved funding request, linked to it.
 *
 * Offered straight after approving (on the record and in the approvals queue)
 * and, for a request approved some other way — an approver's own submission
 * clears itself — from the record's "Funded by" card. Whoever may approve
 * funding requests, or an administrator, may do it; it approves nothing.
 *
 * Prefilled from what the request says, and nothing it does not: the amount
 * borrowed, else the amount requested; the lender, rate, term and monthly
 * payment where given. Missing figures are zero, not guesses — the notes say
 * which ones, and that the lease is to be completed from the lender's
 * agreement. The number is `TBD-<request number>`, which cannot be mistaken for
 * a real one and is unique because request numbers are. It starts today.
 *
 * The request is linked with a conditional update (only while it has no lease),
 * so two approvers accepting at once cannot both link one; the loser's lease is
 * deleted again. Linking does not mark the request funded — that stays the
 * administrator's step, and its loan picker now defaults to this lease.
 */
export async function createPlaceholderLease(fundingRequestId: string): Promise<LeaseOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const actor = await actorFor(auth.userId, auth.role);
  if (!isProcurementAdmin(auth.role) && !(await isApprover(actor, "FUNDING_REQUEST"))) {
    return {
      status: "error",
      message: "Only a funding approver or an administrator can create a lease from a request.",
    };
  }

  const request = await prisma.fundingRequest.findUnique({
    where: { id: fundingRequestId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      leaseId: true,
      amountRequested: true,
      amountBorrowed: true,
      lender: true,
      interestRate: true,
      termMonths: true,
      monthlyPayment: true,
      equipmentSummary: true,
      projectName: true,
      client: { select: { name: true } },
    },
  });
  if (!request) return { status: "error", message: "That funding request no longer exists." };
  if (request.status !== "APPROVED" && request.status !== "FUNDED") {
    return {
      status: "error",
      message: `${request.requestNumber} isn't approved, so there is no lease to set up yet.`,
    };
  }
  if (request.leaseId) {
    return { status: "error", message: `${request.requestNumber} already has a lease linked.` };
  }

  const leaseNumber = `TBD-${request.requestNumber}`;
  if (await prisma.lease.findUnique({ where: { leaseNumber }, select: { id: true } })) {
    return { status: "error", message: `A placeholder lease ${leaseNumber} already exists.` };
  }

  const startDate = businessToday();
  const termMonths = request.termMonths ?? 0;
  const missing = [
    request.amountBorrowed === null ? "amount borrowed (the amount requested is used)" : null,
    request.lender ? null : "lender",
    request.interestRate === null ? "interest rate" : null,
    request.termMonths === null ? "term" : null,
    request.monthlyPayment === null ? "monthly payment" : null,
  ].filter(Boolean);
  // What it is for, kept short: the name is a list column, and an equipment
  // summary can run to a paragraph.
  const aboutText = request.client?.name ?? request.projectName ?? request.equipmentSummary ?? null;
  const about =
    aboutText && aboutText.length > 48 ? `${aboutText.slice(0, 47).trimEnd()}…` : aboutText;

  let leaseId: string;
  try {
    const lease = (await createLease({
      assetUnitIds: [],
      leaseName: `${request.requestNumber} placeholder${about ? ` — ${about}` : ""}`,
      leaseNumber,
      lender: request.lender?.trim() || "Lender to be confirmed",
      totalAmount: Number(request.amountBorrowed ?? request.amountRequested),
      monthlyPayment: request.monthlyPayment === null ? 0 : Number(request.monthlyPayment),
      interestRate: request.interestRate === null ? 0 : Number(request.interestRate),
      startDate,
      endDate: addMonths(startDate, termMonths),
      termMonths,
      status: "ACTIVE",
      paidOffDate: null,
      notes: [
        `Placeholder created on ${dayYear(startDate)} when ${request.requestNumber} was approved.`,
        missing.length > 0
          ? `The request did not give: ${missing.join(", ")} — those are zero here.`
          : "Figures are copied from the request.",
        "Replace the number, dates and payments with the lender's agreement.",
      ].join(" "),
    })) as { id: string };
    leaseId = lease.id;
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not create the lease.",
    };
  }

  const linked = await prisma.fundingRequest.updateMany({
    where: { id: request.id, leaseId: null },
    data: { leaseId },
  });
  if (linked.count === 0) {
    await deleteLease(leaseId).catch(() => {});
    return { status: "error", message: `${request.requestNumber} was linked to a lease in the meantime.` };
  }

  revalidatePath(`/dashboard/funding/${request.id}`);
  revalidatePath("/dashboard/funding");
  revalidatePath("/dashboard/leases");

  return {
    status: "ok",
    id: leaseId,
    message: `Placeholder lease ${leaseNumber} created and linked to ${request.requestNumber}.`,
  };
}
