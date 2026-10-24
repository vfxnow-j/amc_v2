// Pure catalog of order-flag categories, reasons, playbooks and outcomes. No Prisma
// runtime import: the flag dialog and panel (client components) read this directly.
import type { FlagOutcome } from "@/generated/prisma/client";

export const FLAG_CATEGORIES = [
  "returns",
  "condition",
  "payment",
  "fulfillment",
  "shipping",
  "data",
  "client",
  "compliance",
  "sales",
  "other",
] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<FlagCategory, string> = {
  returns: "Returns",
  condition: "Condition",
  payment: "Payment",
  fulfillment: "Fulfillment",
  shipping: "Shipping",
  data: "Data",
  client: "Client",
  compliance: "Compliance",
  sales: "Sales",
  other: "Other",
};

export type ReasonDef = {
  code: string;
  category: FlagCategory;
  label: string;
  severity: "INFO" | "ATTENTION" | "CRITICAL";
  /** Plain strings so raising a flag can copy them into OrderFlagStep rows. */
  playbook: string[];
  tracksUnits: boolean;
  asksCarrier: boolean;
};

const BASIC = ["Confirm details", "Record how it was resolved"];

function r(
  code: string,
  category: FlagCategory,
  label: string,
  severity: ReasonDef["severity"] = "ATTENTION",
  playbook: string[] = BASIC,
  extra: Partial<Pick<ReasonDef, "tracksUnits" | "asksCarrier">> = {},
): ReasonDef {
  return { code, category, label, severity, playbook, tracksUnits: false, asksCarrier: false, ...extra };
}

export const REASONS: ReasonDef[] = [
  r("overdue_return", "returns", "Overdue return", "ATTENTION", [
    "Contact the client",
    "Confirm a return date or extension",
    "Arrange pickup or a return label",
    "Escalate if no response in 3 days",
  ]),
  r("partial_return", "returns", "Partial return"),
  r("return_unresponsive", "returns", "Return not responding"),
  r("extension_requested", "returns", "Extension requested", "INFO"),
  r("extension_unpaid", "returns", "Extension unpaid"),

  r("damage_reported", "condition", "Damage reported", "ATTENTION", [
    "Record the damage and photos",
    "Open a work order",
    "Decide who bears the cost",
    "Bill the client or absorb the cost",
  ]),
  r("missing_accessory", "condition", "Missing accessory or part"),
  r("failed_inspection", "condition", "Failed check-in inspection"),
  r("wear_dispute", "condition", "Cosmetic wear dispute"),

  r("payment_overdue", "payment", "Payment overdue", "ATTENTION", [
    "Send a payment reminder",
    "Call the client",
    "Agree a payment date",
    "Place a credit hold if the date is missed",
  ]),
  r("card_declined", "payment", "Card declined"),
  r("deposit_missing", "payment", "Deposit not received"),
  r("credit_hold", "payment", "Credit hold", "CRITICAL"),
  r("chargeback", "payment", "Chargeback or dispute", "CRITICAL"),
  r("tax_cert_missing", "payment", "Tax-exempt certificate missing"),

  r("stock_shortage", "fulfillment", "Stock shortage"),
  r("substitute_needed", "fulfillment", "Substitute unit needed"),
  r("build_pending", "fulfillment", "Build or config pending"),
  r("backorder", "fulfillment", "On backorder"),
  r("vendor_wait", "fulfillment", "Waiting on vendor"),
  r("ship_date_risk", "fulfillment", "Ship date at risk"),

  r("carrier_delay", "shipping", "Carrier delay"),
  r(
    "lost_in_transit",
    "shipping",
    "Lost in transit",
    "CRITICAL",
    [
      "Record carrier, tracking number and last scan",
      "Open a trace with the carrier",
      "Check declared value and insurance coverage",
      "Set the claim deadline",
      "File the claim and record the claim number",
    ],
    { tracksUnits: true, asksCarrier: true },
  ),
  r("wrong_address", "shipping", "Wrong address"),
  r("signature_required", "shipping", "Signature required", "INFO"),
  r("customs_hold", "shipping", "Customs or international hold"),

  r("missing_serial", "data", "Missing serial"),
  r("serial_mismatch", "data", "Serial mismatch"),
  r("unit_swapped", "data", "Unit swapped in the field"),

  r("vip", "client", "VIP", "INFO"),
  r("new_client", "client", "New client", "INFO"),
  r("high_value", "client", "High-value order", "INFO"),
  r("repeat_late_payer", "client", "Repeat late payer"),
  r("special_handling", "client", "Special handling instructions", "INFO"),

  r("po_mismatch", "compliance", "PO or contract mismatch"),
  r("insurance_expired", "compliance", "Insurance certificate expired"),
  r("id_check", "compliance", "ID or KYC check"),
  r("approval_needed", "compliance", "Approval needed"),

  r("quote_revision", "sales", "Quote in revision", "INFO"),
  r("price_override", "sales", "Price override"),
  r("margin_floor", "sales", "Margin below floor"),
  r("conversion_pending", "sales", "Sale-to-rental conversion pending"),
  r("warranty_rma", "sales", "Warranty or RMA open"),

  r("other", "other", "Other", "INFO"),
];

export function reasonByCode(code: string): ReasonDef | undefined {
  return REASONS.find((x) => x.code === code);
}

export function reasonsIn(category: FlagCategory): ReasonDef[] {
  return REASONS.filter((x) => x.category === category);
}

export type OutcomeDef = {
  code: FlagOutcome;
  label: string;
  needsAmount: boolean;
  /** What happens to the case's units when it closes with this outcome. */
  unitsEnd: "restore" | "damage" | "retire" | "keep";
};

export const OUTCOMES: OutcomeDef[] = [
  { code: "FOUND_RETURNED", label: "Found and received", needsAmount: false, unitsEnd: "restore" },
  { code: "FOUND_DAMAGED", label: "Found, damaged", needsAmount: false, unitsEnd: "damage" },
  { code: "CLAIM_PAID", label: "Carrier claim paid", needsAmount: true, unitsEnd: "retire" },
  { code: "CLIENT_BILLED", label: "Client billed", needsAmount: true, unitsEnd: "retire" },
  { code: "WRITTEN_OFF", label: "Written off", needsAmount: false, unitsEnd: "retire" },
];

export const ALL_OUTCOME_CODES = OUTCOMES.map((o) => o.code);

export function outcomeDef(code: FlagOutcome): OutcomeDef {
  const d = OUTCOMES.find((o) => o.code === code);
  if (!d) throw new Error(`Unknown flag outcome ${code}`);
  return d;
}
