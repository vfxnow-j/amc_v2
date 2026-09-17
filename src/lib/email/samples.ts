import { APP_URL, EMAIL_FROM } from "@/lib/email/client";
import type { RenderedEmail } from "@/lib/email/layout";
import * as T from "@/lib/email/templates";
import { notificationDigestEmail } from "@/lib/notifications/digest-email";

/**
 * Every email template with sample data, for the gallery in Settings →
 * Notifications → Email templates and its "Send me a sample".
 *
 * **The sample data is obviously sample.** Names are "Sample Client Co.",
 * numbers are "SAMPLE-0001", addresses are example.com and amounts are round.
 * Nothing here reads the database: a preview built from a real client's order
 * is exactly the thing that gets screenshotted and forwarded.
 *
 * `who` and `when` are the gallery's account of each message — who receives it
 * and what sends it — kept beside the sample so the two can't drift apart.
 */

export type TemplateGroup = "Security" | "Clients" | "Orders & quotes" | "Procurement" | "Digests & reports" | "People" | "Layout";

export type TemplateSample = {
  key: string;
  label: string;
  group: TemplateGroup;
  who: string;
  when: string;
  render: () => RenderedEmail;
};

const CLIENT = "Sample Client Co.";
const PERSON = "Sam Sample";
const ORDER = "SAMPLE-0001";
const URL_SAMPLE = `${APP_URL}/dashboard`;
const LINK = `${APP_URL}/quote/sample-token`;

export const TEMPLATE_SAMPLES: TemplateSample[] = [
  {
    key: "specimen",
    label: "Layout specimen",
    group: "Layout",
    who: "Whoever an admin types in",
    when: "Settings → Notifications → Send test",
    render: () => T.layoutSpecimenEmail({ sentBy: PERSON, sentAt: "Sample time", appUrl: APP_URL, from: EMAIL_FROM, redirect: process.env.EMAIL_TEST_REDIRECT?.trim() || null }),
  },
  { key: "mfaOtp", label: "Verification code", group: "Security", who: "The person signing in", when: "Sign-in with two-factor on", render: () => T.mfaOtpEmail(PERSON, "000000") },
  { key: "passwordReset", label: "Password reset", group: "Security", who: "The account holder", when: "Forgot password", render: () => T.passwordResetEmail(PERSON, "sample-token") },
  { key: "mfaEnabled", label: "Two-factor turned on", group: "Security", who: "The account holder", when: "Two-factor enabled", render: () => T.mfaEnabledEmail(PERSON) },
  { key: "mfaDisabled", label: "Two-factor turned off", group: "Security", who: "The account holder", when: "Two-factor disabled", render: () => T.mfaDisabledEmail(PERSON) },
  { key: "accountInvite", label: "Account invitation", group: "People", who: "A new user", when: "Settings → Users → invite", render: () => T.accountInviteEmail(PERSON, "sample-token", "Warehouse staff") },
  { key: "taskAssigned", label: "Task assigned", group: "People", who: "The assignee", when: "A task is assigned", render: () => T.taskAssignedEmail(PERSON, "Sample task", "sample", "HIGH", "Sample due date") },
  { key: "taskStatusChanged", label: "Task updated", group: "People", who: "The assignee", when: "A task changes status", render: () => T.taskStatusChangedEmail(PERSON, "Sample task", "sample", "IN_PROGRESS", "DONE") },
  {
    key: "notificationDigest",
    label: "Personal digest",
    group: "People",
    who: "Each user who switched the digest on",
    when: "Daily, 9:00 PT sweep",
    render: () =>
      notificationDigestEmail(PERSON, [
        { type: "OVERDUE_RETURN", title: `3 units overdue · ${CLIENT}`, message: `Still out on order ${ORDER}. The oldest is 4 days past its return date.`, link: "/dashboard/orders", createdAt: new Date() },
        { type: "FOLLOW_UP_DUE", title: `Follow-up due · ${CLIENT}`, message: "Call back was due yesterday — sample note.", link: "/dashboard/clients", createdAt: new Date() },
      ]),
  },
  {
    key: "approvalRequested",
    label: "Approval needed",
    group: "Procurement",
    who: "Every approver for the type, except whoever asked (unless their approval email is off)",
    when: "A PO, funding request or quote is sent for approval",
    render: () =>
      T.approvalRequestedEmail({
        recipientName: PERSON,
        noun: "purchase order",
        recordLabel: "PO-SAMPLE-0001",
        party: { label: "Vendor", value: "Sample Vendor Inc." },
        amount: "$1,000.00",
        requestedBy: "Alex Example",
        note: "Submit to the vendor",
        why: "Sample purpose",
        facts: [{ label: "Order date", value: "Sample date" }],
        lines: ["2 × Sample item — $500.00"],
        releases: "Submitting it to the vendor",
        url: URL_SAMPLE,
      }),
  },
  {
    key: "approvalDecided",
    label: "Approval decided",
    group: "Procurement",
    who: "Whoever asked (unless their approval email is off)",
    when: "An approver approves or denies",
    render: () => T.approvalDecidedEmail({ recipientName: PERSON, noun: "purchase order", recordLabel: "PO-SAMPLE-0001", approved: false, decidedBy: "Alex Example", amount: "$1,000.00", reason: "Sample reason", next: "It stays a draft. Change what the reason asks for and submit it again.", url: URL_SAMPLE }),
  },
  {
    key: "purchaseOrderSubmitted",
    label: "Purchase order submitted",
    group: "Procurement",
    who: "Recipients ticked for POs",
    when: "A PO is submitted (PDF attached)",
    render: () => T.purchaseOrderSubmittedEmail({ poNumber: "PO-SAMPLE-0001", vendorName: "Sample Vendor Inc.", orderType: "Inventory", orderDate: "Sample date", expectedDate: "Sample date", total: "$1,000.00", purchaseMethod: "Credit card", itemCount: 2, submittedBy: PERSON, poId: "sample" }),
  },
  {
    key: "fundingRequestSubmitted",
    label: "Funding request submitted",
    group: "Procurement",
    who: "Recipients ticked for Funding",
    when: "A funding request is submitted (form PDF attached)",
    render: () =>
      T.fundingRequestSubmittedEmail({
        requestNumber: "FR-SAMPLE-0001",
        requestedBy: PERSON,
        submittedBy: PERSON,
        requestDate: "Sample date",
        neededByDate: "Sample date",
        amountRequested: "$10,000.00",
        equipmentCost: "$10,000.00",
        equipmentSummary: "Sample equipment",
        purchaseType: "Purchase",
        itemCount: 2,
        customer: CLIENT,
        commitment: "Signed",
        lender: "Sample Lender",
        monthlyPayment: "$500.00",
        customerRentalCharge: "$1,000.00",
        businessPurpose: "Sample purpose",
        paybackMonths: 10,
        debtServiceCoverage: 2,
        breakEvenMonths: 12,
        supportingPOs: ["PO-SAMPLE-0001"],
        supportingQuotes: [ORDER],
        requestId: "sample",
      }),
  },
  {
    key: "newLead",
    label: "New lead",
    group: "Orders & quotes",
    who: "Recipients ticked for Leads",
    when: "A lead is created (form, API, Zapier, JustCall)",
    render: () => T.newLeadEmail({ name: PERSON, email: "sam@example.com", phone: "555-0100", companyName: CLIENT, source: "Website", channel: "Sample", salesRep: "Alex Example", estimatedValue: 1000 }),
  },
  {
    key: "reservationConfirmedStaff",
    label: "Order confirmed — prep list",
    group: "Orders & quotes",
    who: "Recipients ticked for Orders",
    when: "An order is approved",
    render: () =>
      T.reservationConfirmedStaffEmail({ reservationNumber: ORDER, clientName: CLIENT, startDate: "Sample start", endDate: "Sample end", projectName: "Sample project", deliveryMethod: "Delivery", items: [{ name: "Sample workstation", quantity: 2, category: "Workstations" }, { name: "Sample monitor", quantity: 2, category: "Monitors" }], total: "$1,000.00" }),
  },
  { key: "quoteApproved", label: "Client approved a quote", group: "Orders & quotes", who: "Recipients ticked for Orders", when: "The client signs on the quote link", render: () => T.quoteApprovedEmail({ clientName: CLIENT, reservationNumber: ORDER, reservationId: "sample", signerName: PERSON, total: 1000 }) },
  { key: "quoteDenied", label: "Client declined a quote", group: "Orders & quotes", who: "Recipients ticked for Orders", when: "The client declines on the quote link", render: () => T.quoteDeniedEmail({ clientName: CLIENT, reservationNumber: ORDER, reservationId: "sample", reason: "Sample reason" }) },
  { key: "quoteChangesRequested", label: "Client asked for changes", group: "Orders & quotes", who: "Recipients ticked for Orders", when: "The client asks for changes on the quote link", render: () => T.quoteChangesRequestedEmail({ clientName: CLIENT, reservationNumber: ORDER, reservationId: "sample", changeNotes: "Sample change request" }) },
  {
    key: "quotePageLink",
    label: "Quote link",
    group: "Clients",
    who: "The client",
    when: "Send quote on an order",
    render: () => T.quotePageLinkEmail({ clientName: CLIENT, reservationNumber: ORDER, quoteUrl: LINK, startDate: "Sample start", endDate: "Sample end", total: 1000, projectName: "Sample project", message: "Sample message from the sender.", validUntil: "Sample date" }),
  },
  {
    key: "reservationQuote",
    label: "Quote in the email body",
    group: "Clients",
    who: "The client",
    when: "Email quote on an order",
    render: () =>
      T.reservationQuoteEmail({ clientName: CLIENT, reservationNumber: ORDER, startDate: "Sample start", endDate: "Sample end", itemsByCategory: [{ category: "Workstations", items: [{ name: "Sample workstation", quantity: 2, pricingType: "MONTHLY", rate: 500, subtotal: 1000 }] }], subtotal: 1000, taxRate: 0, taxAmount: 0, total: 1000, notes: "Sample note", projectName: "Sample project" }),
  },
  { key: "proposal", label: "Proposal", group: "Clients", who: "The client", when: "Send proposal (PDF attached)", render: () => T.proposalEmail({ clientName: CLIENT, projectName: "Sample project", reservationNumber: ORDER, message: "Sample message." }) },
  { key: "reservationConfirmed", label: "Order confirmed", group: "Clients", who: "The client", when: "An order is approved", render: () => T.reservationConfirmedEmail(CLIENT, ORDER, "Sample start", "Sample end") },
  { key: "orderPreparing", label: "Order being prepared", group: "Clients", who: "The client", when: "An order moves to Preparing", render: () => T.orderPreparingEmail(CLIENT, ORDER, "Sample start", "Sample end") },
  { key: "orderShipped", label: "Order shipped", group: "Clients", who: "The client", when: "An order ships", render: () => T.orderShippedEmail(CLIENT, ORDER, "Sample start", "Sample end") },
  { key: "invoiceCreated", label: "Invoice issued", group: "Clients", who: "The client", when: "An invoice is sent", render: () => T.invoiceCreatedEmail(CLIENT, "INV-SAMPLE-0001", "$1,000.00", "Sample date") },
  { key: "overdueReminder", label: "Overdue reminder", group: "Clients", who: "The client", when: "Not sent by anything in v2 (v1's billing cron)", render: () => T.overdueReminderEmail(CLIENT, "INV-SAMPLE-0001", "$1,000.00", 10) },
  { key: "clientRequirementsRequest", label: "Documents requested", group: "Clients", who: "The client", when: "Request ID / COI / agreement on an account", render: () => T.clientRequirementsRequestEmail({ clientName: CLIENT, requirementTypes: ["ID", "COI", "AGREEMENT"], uploadUrl: LINK, message: "Sample message." }) },
  { key: "onboardingInvite", label: "Onboarding invitation", group: "Clients", who: "A prospect", when: "Onboard on a lead", render: () => T.onboardingInviteEmail({ name: PERSON, formUrl: LINK, companyName: CLIENT }) },
  { key: "systemAlert", label: "System alert", group: "People", who: "Admins", when: "Not sent by anything in v2 yet", render: () => T.systemAlertEmail("Sample alert", "Sample alert message.") },
  {
    key: "dailyDigest",
    label: "Day at a glance",
    group: "Digests & reports",
    who: "Recipients ticked for Digests",
    when: "Scheduled (default daily 9:00 PT)",
    render: () =>
      T.dailyDigestEmail({
        dateLabel: "Sample day",
        reservationsStarting: [{ reservationNumber: ORDER, clientName: CLIENT, projectName: "Sample project", total: "$1,000", itemCount: 2, link: "/dashboard/orders" }],
        shipping: [],
        returnsDue: [],
        actionItems: [{ label: "Overdue checkouts", count: 3, urgent: true, link: "/dashboard/orders" }],
        snapshot: { activeReservations: 10, activeCheckouts: 20, overdueCheckouts: 3, availableUnits: 100, totalUnits: 200, outstanding: "$1,000" },
        topInsights: [{ title: "Sample insight", priority: "high", description: "Sample description.", link: "/dashboard", type: "inventory" }],
      }),
  },
  {
    key: "weeklyReport",
    label: "Weekly report",
    group: "Digests & reports",
    who: "Recipients ticked for Digests",
    when: "Scheduled (default Sunday 12:00 PT)",
    render: () =>
      T.weeklyReportEmail({
        weekLabel: "Sample week",
        lastWeek: [{ label: "New orders", value: "10", change: 25 }, { label: "Returns", value: "8", change: -10 }],
        upcoming: [{ label: "Orders starting", count: 5, link: "/dashboard/orders" }],
        insights: [{ title: "Sample insight", priority: "medium", description: "Sample description.", type: "inventory" }],
        snapshot: { totalAssets: 100, availableUnits: 100, totalUnits: 200, activeReservations: 10, activeCheckouts: 20, overdueCheckouts: 0, revenue: "$1,000", outstanding: "$0", leadsInPipeline: 5 },
      }),
  },
  {
    key: "dailyTrafficReport",
    label: "Daily traffic report",
    group: "Digests & reports",
    who: "Recipients ticked for Traffic",
    when: "Scheduled (default daily 5:00 PM PT)",
    render: () =>
      T.dailyTrafficReportEmail({
        dateLabel: "Sample day",
        windowLabel: "12:00 AM – 5:00 PM PT",
        out: [{ clientName: CLIENT, units: [{ barcode: "000001", assetName: "Sample workstation", time: "10:00 AM", reservationNumber: ORDER, reservationId: "sample" }] }],
        back: [],
        totals: { clientsTouched: 1, unitsOut: 1, unitsIn: 0 },
      }),
  },
  {
    key: "coverageExpiry",
    label: "Coverage expiring",
    group: "Digests & reports",
    who: "Recipients ticked for Coverage",
    when: "Scheduled (default daily 7:00 AM PT), only when something expires",
    render: () => T.coverageExpiryEmail({ items: [{ unitBarcode: "000001", assetName: "Sample workstation", coverageName: "Sample warranty", coverageType: "Warranty", provider: "Sample Provider", endDate: "Sample date", daysRemaining: 6 }] }),
  },
  {
    key: "inventoryReport",
    label: "Inventory report",
    group: "Digests & reports",
    who: "Recipients ticked for Inventory",
    when: "Scheduled (v1's weekly Monday 11:00 PT), PDF attached",
    render: () =>
      T.inventoryReportEmail({
        title: "Inventory Report (sample)",
        generatedAtLabel: "Sample time",
        horizonLabel: "Sample window",
        horizonDays: 7,
        cadenceNote: "Sample schedule.",
        summary: { totalUnits: 200, inStock: 100, out: 90, goingOut: 5, comingBack: 3, utilizationPercent: 45 },
        categories: [{ category: "Workstations", totals: { inStock: 10, out: 5 }, rows: [{ assetName: "Sample workstation", detail: "Sample maker · Sample model", inStock: 10, out: 5, goingOut: 2, comingBack: 1, monthlyRate: 500 }] }],
        hasAttachment: true,
      }),
  },
  {
    key: "depreciationReport",
    label: "Depreciation report",
    group: "Digests & reports",
    who: "Recipients ticked for Depreciation",
    when: "Scheduled (default monthly, 1st, 8:00 AM PT), PDF and CSV attached",
    render: () =>
      T.depreciationReportEmail({
        asOfLabel: "Sample date",
        periodLabel: "Sample month",
        cadenceNote: "Sample schedule.",
        totals: { fleetUnits: 100, valuedUnits: 90, cost: 100000, accumulated: 40000, book: 60000, periodExpense: 1000, fullyDepreciated: 5, fullyDepreciatingSoon: 2 },
        groups: [{ name: "Sample family", grouped: true, units: 90, cost: 100000, accumulated: 40000, book: 60000, periodExpense: 1000 }],
        otherGroups: null,
        soon: [{ barcode: "000001", model: "Sample model", on: "Sample date", book: 10 }],
        soonMore: 1,
        excluded: { count: 10, reasons: ["no purchase price: 10"] },
        notes: ["Sample note about how the figures are made."],
        attachments: ["the full report as a PDF", "a CSV of every valued unit"],
      }),
  },
];

export function sampleFor(key: string): TemplateSample | undefined {
  return TEMPLATE_SAMPLES.find((sample) => sample.key === key);
}
