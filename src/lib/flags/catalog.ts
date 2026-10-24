// Pure catalog of order-flag categories, reasons, playbooks and outcomes. No Prisma
// runtime import: the flag dialog and panel (client components) read this directly.
import type { FlagOutcome } from "@/generated/prisma/client";

export const FLAG_CATEGORIES = [
  "returns",
  "condition",
  "payment",
  "fulfillment",
  "shipping",
  "transport",
  "warehouse",
  "site",
  "vendor",
  "data",
  "client",
  "compliance",
  "sales",
  "internal",
  "risk",
  "other",
] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<FlagCategory, string> = {
  returns: "Returns",
  condition: "Condition",
  payment: "Payment",
  fulfillment: "Fulfillment",
  shipping: "Shipping (carrier)",
  transport: "Transport (ours)",
  warehouse: "Warehouse",
  site: "Site and install",
  vendor: "Vendor",
  data: "Data",
  client: "Client",
  compliance: "Compliance",
  sales: "Sales",
  internal: "Internal",
  risk: "Loss and risk",
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
  /**
   * The outcomes this kind of case can close with (a unit found, a claim paid,
   * the client billed, a write-off). Empty means there is no such ending: it
   * closes with a note saying how it was resolved.
   */
  outcomes: FlagOutcome[];
};

const BASIC = ["Confirm details", "Record how it was resolved"];

function r(
  code: string,
  category: FlagCategory,
  label: string,
  severity: ReasonDef["severity"] = "ATTENTION",
  playbook: string[] = BASIC,
  extra: Partial<Pick<ReasonDef, "tracksUnits" | "asksCarrier" | "outcomes">> = {},
): ReasonDef {
  return { code, category, label, severity, playbook, tracksUnits: false, asksCarrier: false, outcomes: [], ...extra };
}

const LOSS: FlagOutcome[] = ["FOUND_RETURNED", "FOUND_DAMAGED", "CLAIM_PAID", "CLIENT_BILLED", "WRITTEN_OFF"];
const COST: FlagOutcome[] = ["CLAIM_PAID", "CLIENT_BILLED", "WRITTEN_OFF"];

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
  ], { outcomes: COST }),
  r("missing_accessory", "condition", "Missing accessory or part", "ATTENTION", BASIC, { outcomes: ["CLIENT_BILLED", "WRITTEN_OFF"] }),
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
    { tracksUnits: true, asksCarrier: true, outcomes: LOSS },
  ),
  r("wrong_address", "shipping", "Wrong address"),
  r("signature_required", "shipping", "Signature required", "INFO"),
  r("customs_hold", "shipping", "Customs or international hold"),

  // Our own movement of goods: trucks, drivers, pickups and deliveries we run or book.
  r("freight_booking_failed", "transport", "Freight or truck booking failed"),
  r("driver_unavailable", "transport", "Driver or vehicle unavailable"),
  r("pickup_missed", "transport", "Pickup missed or rescheduled"),
  r("delivery_window_missed", "transport", "Delivery window missed"),
  r("transit_delay", "transport", "Transit delay or ETA slip"),
  r(
    "damaged_in_transit",
    "transport",
    "Damaged in transit",
    "CRITICAL",
    [
      "Photograph the damage and the packaging",
      "Note the damage on the delivery receipt",
      "Notify the carrier inside the claim window",
      "File the claim and record the claim number",
      "Open a work order for the unit",
    ],
    { asksCarrier: true, outcomes: COST },
  ),
  r("packaging_issue", "transport", "Packaging or crating problem"),
  r("freight_cost_over", "transport", "Freight cost over quote"),

  // The building: picking, packing, testing and counting.
  r("pick_error", "warehouse", "Pick or pack error"),
  r("wrong_unit_sent", "warehouse", "Wrong unit sent", "ATTENTION", [
    "Confirm what was sent and what was ordered",
    "Arrange the swap or pickup",
    "Correct the order's unit links",
  ]),
  r("failed_burn_in", "warehouse", "Failed test or burn-in"),
  r("count_mismatch", "warehouse", "Stock count mismatch"),
  r("labeling_problem", "warehouse", "Labeling or barcode problem"),

  // The client's site, where our work depends on it being ready.
  r("site_not_ready", "site", "Site not ready"),
  r("power_cooling_not_ready", "site", "Power or cooling not ready"),
  r("install_delayed", "site", "Install delayed"),
  r("remote_hands_needed", "site", "Remote hands needed"),
  r("site_access", "site", "No access at pickup or delivery site"),

  // Suppliers we buy from.
  r("vendor_delay", "vendor", "Vendor delivery delay"),
  r("vendor_short_ship", "vendor", "Short-shipped by vendor"),
  r("vendor_doa", "vendor", "Vendor unit dead on arrival", "ATTENTION", [
    "Photograph and record the fault",
    "Open the RMA with the vendor",
    "Arrange the replacement or credit",
  ], { outcomes: ["WRITTEN_OFF", "FOUND_RETURNED"] }),
  r("vendor_rma_open", "vendor", "Vendor RMA open"),
  r("vendor_price_change", "vendor", "Vendor price change"),

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

  r("staff_error", "internal", "Internal error to correct"),
  r("pricing_error", "internal", "Pricing or quote error"),
  r("scheduling_conflict", "internal", "Scheduling conflict"),
  r("missed_handoff", "internal", "Missed handoff between teams"),
  r("capacity_shortfall", "internal", "Capacity or staffing shortfall"),

  r(
    "theft_loss",
    "risk",
    "Theft or unexplained loss",
    "CRITICAL",
    [
      "Record what is missing and when it was last seen",
      "Check the last scan and the location history",
      "Notify the owner and, if needed, the police",
      "Open an insurance claim if covered",
    ],
    { tracksUnits: true, outcomes: LOSS },
  ),
  r("audit_discrepancy", "risk", "Audit discrepancy", "ATTENTION", BASIC, { tracksUnits: true, outcomes: ["FOUND_RETURNED", "WRITTEN_OFF"] }),
  r("insurance_claim_open", "risk", "Insurance claim open"),

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
