/**
 * How a unit was sold, and what the sale put in our pocket.
 *
 * Per unit, not per order: a bundle can go to a customer and a single card to
 * eBay in the same week, and the sync carries these columns from v1 as they
 * are. Net received is the sold-for price less the selling fees; a sale with no
 * fees recorded reads as net = price, and callers say so.
 *
 * Prisma-free so the sell dialog can share the same rules as the action.
 */

export const SALE_CHANNELS = ["CUSTOMER", "EBAY", "OTHER"] as const;
export type SaleChannelValue = (typeof SALE_CHANNELS)[number];

export const SALE_CHANNEL_LABEL: Record<SaleChannelValue, string> = {
  CUSTOMER: "Customer",
  EBAY: "eBay",
  OTHER: "Other",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isSaleChannel(value: unknown): value is SaleChannelValue {
  return SALE_CHANNELS.includes(value as SaleChannelValue);
}

/** Price less fees; null when there is no price to net. Missing fees count as 0. */
export function netReceived(
  price: number | null,
  fees: number | null,
): number | null {
  return price === null ? null : round2(price - (fees ?? 0));
}

/**
 * Older sales predate the channel column. Read it off the buyer text for a
 * form's starting choice only; nothing is written from this guess until the
 * person saves.
 */
export function guessChannel(
  channel: SaleChannelValue | null,
  soldTo: string | null,
): SaleChannelValue {
  if (channel) return channel;
  if (soldTo && /\be-?bay\b/i.test(soldTo)) return "EBAY";
  return soldTo ? "OTHER" : "CUSTOMER";
}

export type SaleInput = {
  saleChannel?: SaleChannelValue | null;
  soldTo?: string | null;
  soldPrice: number;
  saleFees?: number | null;
};

/**
 * Validate the channel, buyer, price and fees together and return what to store.
 * Throws a message fit to show. eBay is stored as the buyer "eBay" so reports
 * group by buyer without a dozen spellings, and eBay sales must carry fees.
 */
export function normalizeSale(input: SaleInput): {
  saleChannel: SaleChannelValue | null;
  soldTo: string;
  saleFees: number | null;
} {
  const saleChannel = input.saleChannel ?? null;
  if (saleChannel !== null && !isSaleChannel(saleChannel)) {
    throw new Error("Unknown sale channel");
  }
  const soldTo = saleChannel === "EBAY" ? "eBay" : (input.soldTo?.trim() ?? "");
  if (!soldTo) throw new Error("Sold to is required");
  if (!Number.isFinite(input.soldPrice) || input.soldPrice < 0) {
    throw new Error("Sale price must be zero or more");
  }
  const saleFees = input.saleFees ?? null;
  if (saleChannel === "EBAY" && saleFees === null) {
    throw new Error("eBay fees are required");
  }
  if (saleFees !== null) {
    if (!Number.isFinite(saleFees) || saleFees < 0) {
      throw new Error("Fees must be zero or more");
    }
    if (saleFees > input.soldPrice) {
      throw new Error("Fees cannot exceed the sale price");
    }
  }
  return { saleChannel, soldTo, saleFees };
}
