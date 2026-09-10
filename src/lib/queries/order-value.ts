import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * What an order is worth — from the package the client actually approved.
 *
 * **Why this exists.** `Reservation.subtotal` and `Reservation.total` are stored
 * figures, and they are wrong in two different ways on this database.
 *
 * 1. **They can include a package the client turned down.** An order carries
 *    several packages when a client is offered alternative configurations; one
 *    is marked active and the rest are the options they did not take. On five
 *    orders the stored subtotal sums all of them. RES-2026-00107 offered three
 *    GPU configurations and stores $13,575 against a chosen package worth
 *    $3,375 — four times the real deal. SALE-2026-00023, which is APPROVED,
 *    stores $385,219.92 against $198,979.44.
 * 2. **They go stale.** Three orders store *less* than their live lines come to,
 *    because a line changed after the total was last written and nothing
 *    recomputed it. RES-2026-00043 is the clearest: its `total` is $40 below
 *    `subtotal + tax`, because the total was right when it was written and the
 *    subtotal moved afterwards.
 *
 * Both faults have one cause — a cached number nobody recomputes — so both have
 * one cure: derive it. 140 of 149 orders already agree with what this computes,
 * so this is a correction to nine rows, not a new definition.
 *
 * **The definition, in the owner's words: booked value is what the client
 * approved.** That is the active package, and only the active package.
 * `dashboard.ts` already draws this line for the fleet ranking (`COUNTED_LINES`
 * carries `package: { isActive: true }`) and `margin.ts` draws it for the sale
 * book. This module exists so the money figures draw it too, from one place —
 * three definitions of "booked" is what let them disagree.
 *
 * **Nothing here is estimated.** The arithmetic was checked against all 149
 * stored orders before it was written: `taxAmount` equals net × `taxRate`/100 on
 * 149 of 149, and `total` equals net + tax + shipping on 148 — the exception
 * being the stale row above. So a derived total is the same number the app would
 * have stored had it recomputed, not a plausible substitute for it.
 *
 * Every order in this database has exactly one active package and every line
 * belongs to a package (853 of 853), so nothing falls outside this sum. If that
 * ever stops being true, `activeLines` is the one place that assumption lives.
 */

export type OrderValue = {
  id: string;
  /** Active-package lines, before discount and tax. */
  gross: number;
  discount: number;
  /** gross − discount. What tax is charged on. */
  net: number;
  tax: number;
  /** Delivery and return, plus whatever margin is charged on them. */
  shipping: number;
  /** net + tax + shipping. */
  total: number;
};

const num = (value: unknown): number => Number(value ?? 0);

/** Lines that count: the approved package only. Components ride in their parent. */
const activeLines = {
  where: { package: { isActive: true } },
  select: { subtotal: true },
} as const;

const MONEY_FIELDS = {
  id: true,
  discountType: true,
  discountValue: true,
  discountAmount: true,
  taxRate: true,
  deliveryCost: true,
  returnCost: true,
  shippingMarginType: true,
  shippingMargin: true,
} as const;

type MoneyRow = {
  id: string;
  discountType: string | null;
  discountValue: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  deliveryCost: Prisma.Decimal | null;
  returnCost: Prisma.Decimal | null;
  shippingMarginType: string | null;
  shippingMargin: Prisma.Decimal | null;
  items: { subtotal: Prisma.Decimal }[];
};

/**
 * A percentage discount has to be recomputed, a fixed one does not.
 *
 * `discountAmount` was derived from the inflated subtotal on exactly the orders
 * this module is here to fix, so reusing it on a PERCENTAGE order would carry
 * the fault into the correction. A FIXED discount is a sum somebody typed and
 * means the same against any subtotal, so it is kept as stored.
 */
function discountFor(row: MoneyRow, gross: number): number {
  if (row.discountType === "PERCENTAGE") return (gross * num(row.discountValue)) / 100;
  if (row.discountType === "FIXED") return num(row.discountAmount);
  return 0;
}

/** Shipping is charged at cost plus a margin that is fixed or a percentage. */
function shippingFor(row: MoneyRow): number {
  const base = num(row.deliveryCost) + num(row.returnCost);
  if (base === 0) return 0;
  if (row.shippingMarginType === "PERCENTAGE") return base + (base * num(row.shippingMargin)) / 100;
  if (row.shippingMarginType === "FIXED") return base + num(row.shippingMargin);
  return base;
}

function valueOf(row: MoneyRow): OrderValue {
  const gross = row.items.reduce((sum, item) => sum + num(item.subtotal), 0);
  const discount = discountFor(row, gross);
  const net = gross - discount;
  // Matches the stored rounding exactly: taxRate is a percentage, and the cents
  // are rounded once at the end rather than per line.
  const tax = Math.round(net * num(row.taxRate)) / 100;
  const shipping = shippingFor(row);
  return { id: row.id, gross, discount, net, tax, shipping, total: net + tax + shipping };
}

/** Every matching order, valued from its approved package. */
export const orderValues = cache(async function orderValues(
  where: Prisma.ReservationWhereInput,
): Promise<OrderValue[]> {
  const rows = await prisma.reservation.findMany({
    where,
    select: { ...MONEY_FIELDS, items: activeLines },
  });
  return (rows as MoneyRow[]).map(valueOf);
});

/** The sum and count a headline figure needs. */
export async function sumOrderValue(
  where: Prisma.ReservationWhereInput,
): Promise<{ total: number; count: number }> {
  const values = await orderValues(where);
  return {
    total: values.reduce((sum, row) => sum + row.total, 0),
    count: values.length,
  };
}
