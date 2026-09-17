/**
 * Who, besides the people a message is about, receives the company's mail —
 * the shape of the `notification_recipients` setting, and what each tick means.
 *
 * **The stored shape is v1's.** v1 keeps an array of
 * `{ email, leads, reservations, insights, traffic, purchaseOrders, inventory,
 * funding }` under that key, and a refresh from v1 (scripts/refresh-from-v1.sh)
 * lays v1's row down over v2's. So v2 only ever *adds* keys — `name`,
 * `depreciation`, `coverage` — and never renames, removes or re-types one.
 * Anything v2 does not recognise on a stored entry is kept on save, so a key v1
 * adds tomorrow survives an edit made here today. The refresh script re-applies
 * v2's additive keys by address after it restores v1's list.
 *
 * **One tick per kind of mail, and nothing that isn't sent.** Each category is
 * here because a sender reads it (named in `senders`); `docs/notifications.md`
 * carries the full table of category → email → sender → when. A category whose
 * last sender is removed must go too, or the screen offers a switch that does
 * nothing.
 *
 * Plain module with no Prisma and no server imports, because the editor — a
 * client component — reads the labels.
 */

export const RECIPIENT_CATEGORIES = [
  "leads",
  "reservations",
  "purchaseOrders",
  "funding",
  "coverage",
  "insights",
  "traffic",
  "inventory",
  "depreciation",
] as const;

export type RecipientCategory = (typeof RECIPIENT_CATEGORIES)[number];

export type CategoryMeta = {
  /** Column header. Short. */
  short: string;
  label: string;
  /** What arrives, and when. One line. */
  what: string;
  /** The functions that read this category, for the doc and for grep. */
  senders: string[];
  /** A key v1 does not have. Re-applied by address after a refresh. */
  v2Only?: boolean;
};

export const CATEGORY_META: Record<RecipientCategory, CategoryMeta> = {
  leads: {
    short: "Leads",
    label: "New leads",
    what: "A new lead, the moment it is created — from the web form, the API, Zapier or JustCall.",
    senders: ["notifyNewLead"],
  },
  reservations: {
    short: "Orders",
    label: "Orders and quote replies",
    what: "An order is confirmed (with the prep list), or a client approves, declines or asks for changes on a quote link. As it happens.",
    senders: ["notifyReservationConfirmed", "approveQuote", "denyQuote", "requestQuoteChanges"],
  },
  purchaseOrders: {
    short: "POs",
    label: "Purchase orders submitted",
    what: "A purchase order is submitted to its vendor, with the PO PDF attached. As it happens.",
    senders: ["notifyPurchaseOrderSubmitted"],
  },
  funding: {
    short: "Funding",
    label: "Funding requests submitted",
    what: "A funding request is submitted for review, with the request form PDF attached. As it happens.",
    senders: ["notifyFundingRequestSubmitted"],
  },
  coverage: {
    short: "Coverage",
    label: "Service coverage expiring",
    what: "Service coverages ending within 30 days, each repeated at most weekly. On its schedule below.",
    senders: ["sendCoverageExpiryNotifications"],
    v2Only: true,
  },
  insights: {
    short: "Digests",
    label: "Day at a glance and weekly report",
    what: "The business digests: today's orders, shipping and returns each morning, and last week against the week before. On their schedules below.",
    senders: ["notifyDailyDigest", "notifyWeeklyReport"],
  },
  traffic: {
    short: "Traffic",
    label: "Daily traffic report",
    what: "What was checked out and returned today, by client. On its schedule below.",
    senders: ["notifyDailyTrafficReport"],
  },
  inventory: {
    short: "Inventory",
    label: "Inventory report",
    what: "Stock, what is going out and coming back, and monthly rates, with the full list as a PDF. On its schedule below.",
    senders: ["sendInventoryReport"],
  },
  depreciation: {
    short: "Deprec.",
    label: "Depreciation report",
    what: "Cost, accumulated depreciation and book value, this period's expense and what is fully depreciating — PDF and a CSV for accounting. On its schedule below.",
    senders: ["sendDepreciationReport"],
    v2Only: true,
  },
};

export type NotificationRecipient = {
  email: string;
  /** Who or what the address is: "Accounting", "Sales list". Optional. */
  name?: string;
} & Partial<Record<RecipientCategory, boolean>> & {
    /** Keys this version doesn't know, carried through untouched. */
    [key: string]: unknown;
  };

/** Loose on purpose: distribution lists and aliases are fine. */
export function isAddress(value: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim());
}

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether this entry receives a category.
 *
 * `coverage` is new in v2, and v1 sends the coverage email to `reservations`
 * recipients. So an entry that has never been given a `coverage` answer — every
 * entry restored from v1 — inherits it from `reservations`, and nobody who got
 * that email from v1 stops getting it from v2. Once the box is saved here, the
 * stored answer wins.
 */
export function receives(entry: NotificationRecipient, category: RecipientCategory): boolean {
  const value = entry[category];
  if (typeof value === "boolean") return value;
  if (category === "coverage") return entry.reservations === true;
  return false;
}

/** Read a stored value back into a clean list. Drops only what can't be an entry. */
export function normalizeRecipients(raw: unknown): NotificationRecipient[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NotificationRecipient[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.email !== "string" || !entry.email.trim()) continue;
    const key = normalizeAddress(entry.email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, email: entry.email.trim() } as NotificationRecipient);
  }
  return out;
}
