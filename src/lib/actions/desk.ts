"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { calculatePeriods, computeItemSubtotal } from "@/lib/pricing/periods";
import {
  checkoutByBarcode,
  checkoutReservationItem,
} from "@/lib/actions/reservations";
import type { OverScanResolution, OverScanConflict } from "@/lib/reservations/over-scan";

/**
 * The check-out surface on the order record.
 *
 * A thin v2 layer over the ported actions: it exists so the screen gets one
 * result shape it can render — done, refused, or a conflict for a person to
 * answer — instead of the three different shapes the underlying actions return.
 */

export type ScanOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string }
  | { status: "conflict"; conflict: OverScanConflict };

/**
 * Scan a unit out against an order.
 *
 * With no `resolution`, a unit scanned beyond the line's ordered quantity comes
 * back as a conflict and nothing is written — the caller has to answer it. See
 * lib/reservations/over-scan.ts.
 */
export async function scanUnitOut(
  reservationId: string,
  barcode: string,
  resolution?: OverScanResolution,
): Promise<ScanOutcome> {
  const trimmed = barcode.trim();
  if (!trimmed) {
    return { status: "error", message: "Scan a barcode or type one in." };
  }

  // 'new-line' can't go through the normal path: it needs the line to exist
  // before a unit can be checked out against it.
  if (resolution === "new-line") {
    return splitOntoNewLine(reservationId, trimmed);
  }

  const result = await checkoutByBarcode(reservationId, trimmed, {
    onOverScan: resolution,
  });

  if (result.success) {
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { status: "ok", message: `${trimmed} checked out.` };
  }

  if ("conflict" in result) {
    return { status: "conflict", conflict: result.conflict };
  }

  return { status: "error", message: result.error };
}

/**
 * Put the extra unit on a line of its own, then check it out against that.
 *
 * The new line copies the rate and pricing type from the line the unit would
 * otherwise have gone onto. That is not a guess: it's the rate already agreed
 * for this asset on this order, and it leaves the original line and its price
 * exactly as the client approved them.
 */
async function splitOntoNewLine(
  reservationId: string,
  barcode: string,
): Promise<ScanOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const unit = await prisma.assetUnit.findUnique({
    where: { barcode },
    select: { id: true, assetId: true },
  });
  if (!unit) {
    return { status: "error", message: `No unit has the barcode ${barcode}.` };
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { startDate: true, endDate: true, isRecurring: true },
  });
  if (!reservation) {
    return { status: "error", message: "That order no longer exists." };
  }

  // The sibling line for this asset supplies the agreed terms.
  const sibling = await prisma.reservationItem.findFirst({
    where: { reservationId, assetId: unit.assetId, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      rate: true,
      pricingType: true,
      packageId: true,
      isOneTime: true,
    },
  });
  if (!sibling) {
    return {
      status: "error",
      message:
        "There's no line for this asset to copy terms from. Add the line to the order first.",
    };
  }

  const periods = await calculatePeriods(
    reservation.startDate,
    reservation.endDate,
    sibling.pricingType,
    reservation.isRecurring,
  );
  const lastSort = await prisma.reservationItem.aggregate({
    where: { reservationId },
    _max: { sortOrder: true },
  });

  const line = await prisma.reservationItem.create({
    data: {
      reservationId,
      assetId: unit.assetId,
      packageId: sibling.packageId,
      pricingType: sibling.pricingType,
      rate: sibling.rate,
      isOneTime: sibling.isOneTime,
      quantity: 1,
      subtotal: computeItemSubtotal(Number(sibling.rate), 1, periods),
      sortOrder: (lastSort._max.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  const result = await checkoutReservationItem(reservationId, line.id, unit.id);
  if (result && "error" in result && result.error) {
    return { status: "error", message: result.error };
  }

  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return {
    status: "ok",
    message: `${barcode} checked out on a new line of its own.`,
  };
}
