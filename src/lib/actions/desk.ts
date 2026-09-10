"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { openWorkOrder } from "@/lib/actions/service";
import { calculatePeriods, computeItemSubtotal } from "@/lib/pricing/periods";
import {
  checkinByBarcode,
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
  | { status: "conflict"; conflict: OverScanConflict }
  | { status: "not-on-order"; assetName: string; barcode: string };

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
  options: { allowNewAssetLine?: boolean } = {},
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

  // `checkoutByBarcode` creates a priced line for an asset the order never
  // ordered, silently, at the asset's general rate. On the order record that is
  // tolerable — you are looking at the order and can see the line appear. On a
  // standalone scan surface it is not: one wrong box off a pallet puts a
  // charged line on a client's order with nobody asked, which is the same class
  // of failure the over-scan guard exists to stop. So the bulk surface opts
  // out, checks first, and asks.
  if (options.allowNewAssetLine === false) {
    const stray = await strayAsset(reservationId, trimmed);
    if (stray) return stray;
  }

  const result = await checkoutByBarcode(reservationId, trimmed, {
    onOverScan: resolution,
  });

  if (result.success) {
    revalidatePath(`/dashboard/orders/${reservationId}`);
    return { status: "ok", message: `${trimmed} checked out.` };
  }

  if ("conflict" in result) {
    return { status: "conflict", conflict: result.conflict };
  }

  return { status: "error", message: result.error };
}

/**
 * Is this unit's asset on the order at all?
 *
 * One cheap lookup before the ported action gets a chance to invent a line for
 * it. Returns the outcome to hand back, or null when the asset is genuinely on
 * the order and the scan should proceed normally.
 *
 * Deliberately not a refusal the caller can override with a flag: the answer is
 * a question for a person — put it back, or open the order and add it there,
 * where the rate is a decision rather than a lookup.
 */
async function strayAsset(
  reservationId: string,
  barcode: string,
): Promise<ScanOutcome | null> {
  const unit = await prisma.assetUnit.findFirst({
    where: { OR: [{ barcode }, { serialNumber: barcode }] },
    select: { assetId: true, asset: { select: { name: true } } },
  });
  // An unknown barcode is the ported action's error to report, not this one's —
  // it says so more precisely than "not on the order" would.
  if (!unit) return null;

  const onOrder = await prisma.reservationItem.count({
    where: { reservationId, assetId: unit.assetId },
  });
  if (onOrder > 0) return null;

  return { status: "not-on-order", assetName: unit.asset.name, barcode };
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

  revalidatePath(`/dashboard/orders/${reservationId}`);
  return {
    status: "ok",
    message: `${barcode} checked out on a new line of its own.`,
  };
}

export type CheckinCondition = "EXCELLENT" | "GOOD" | "FAIR" | "DAMAGED";

export type CheckinOutcome =
  | {
      status: "ok";
      message: string;
      /** Set when a damaged return raised one. */
      workOrder?: { id: string; number: string };
    }
  | { status: "error"; message: string }
  /** The unit is out, but on a different order. Offer the way there. */
  | {
      status: "wrong-order";
      message: string;
      order: { id: string; reservationNumber: string };
    };

/**
 * Scan a unit back in against an order.
 *
 * A unit that is out on a *different* order is the interesting failure. v1
 * answered "not checked out from this reservation", which is true and useless —
 * the unit is in your hand and it belongs somewhere. So the miss is looked up
 * and the right order is offered instead of a dead end.
 */
export async function scanUnitIn(
  reservationId: string,
  barcode: string,
  condition: CheckinCondition = "GOOD",
  damageNotes?: string,
): Promise<CheckinOutcome> {
  const trimmed = barcode.trim();
  if (!trimmed) {
    return { status: "error", message: "Scan a barcode or type one in." };
  }

  const damaged = condition === "DAMAGED";
  const result = await checkinByBarcode(reservationId, trimmed, {
    returnCondition: condition,
    conditionIn: condition.toLowerCase(),
    damageFlag: damaged,
    damageNotes: damaged ? damageNotes : undefined,
  });

  if (result.success) {
    revalidatePath(`/dashboard/orders/${reservationId}`);

    // Damaged on return raises the work order here, in the same breath as the
    // check-in. Asking someone to go and do it afterwards is asking for a
    // damaged unit to go back on the shelf: openWorkOrder is what takes it out
    // of bookable stock.
    if (damaged) {
      const unit = await prisma.assetUnit.findUnique({
        where: { barcode: trimmed },
        select: { id: true },
      });
      if (unit) {
        const raised = await openWorkOrder({
          assetUnitId: unit.id,
          fault: damageNotes?.trim() || "Damaged on return",
          openedFromReservationId: reservationId,
        });
        if (raised.status === "ok") {
          return {
            status: "ok",
            message: `${trimmed} back, damaged — ${raised.number} raised and the unit is off the shelf.`,
            workOrder: { id: raised.workOrderId, number: raised.number },
          };
        }
        // The unit is back either way; say the work order didn't happen rather
        // than pretending the return failed.
        return {
          status: "ok",
          message: `${trimmed} back, marked damaged. No work order raised: ${raised.message}`,
        };
      }
    }

    return { status: "ok", message: `${trimmed} checked in.` };
  }

  // Not on this order — say where it actually is rather than just refusing.
  const elsewhere = await prisma.reservationItemUnit.findFirst({
    where: {
      assetUnit: { barcode: trimmed },
      checkedOutAt: { not: null },
      checkedInAt: null,
    },
    select: {
      reservationItem: {
        select: {
          reservation: { select: { id: true, reservationNumber: true } },
        },
      },
    },
  });

  if (elsewhere) {
    const order = elsewhere.reservationItem.reservation;
    return {
      status: "wrong-order",
      message: `${trimmed} is out on ${order.reservationNumber}, not this order.`,
      order,
    };
  }

  return {
    status: "error",
    message: "error" in result ? result.error : `${trimmed} isn't out anywhere.`,
  };
}
