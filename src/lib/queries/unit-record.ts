import { prisma } from "@/lib/prisma";
import { OPEN_CHECKOUT } from "@/lib/inventory/availability";
import { bookValue } from "@/lib/inventory/depreciation";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/** Queries behind the Units record. One per card, so each Suspends alone. */

export async function getUnitHeader(id: string) {
  const unit = await prisma.assetUnit.findUnique({
    where: { id },
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      status: true,
      condition: true,
      notes: true,
      createdAt: true,
      retiredAt: true,
      soldAt: true,
      asset: {
        select: {
          id: true,
          name: true,
          manufacturer: true,
          model: true,
          category: { select: { name: true } },
        },
      },
      location: { select: { id: true, name: true } },
      checkouts: {
        // Custody is the open checkout, not the status column. The two can
        // disagree and this one is the physical record —
        // lib/inventory/availability.ts.
        where: OPEN_CHECKOUT,
        orderBy: { checkoutDate: "desc" },
        take: 1,
        select: {
          id: true,
          checkoutDate: true,
          expectedReturn: true,
          client: { select: { id: true, name: true } },
          reservation: { select: { id: true, reservationNumber: true } },
        },
      },
      workOrders: {
        where: { status: { in: OPEN_WORK_ORDER_STATUSES } },
        orderBy: { openedAt: "desc" },
        take: 1,
        select: { id: true, number: true, status: true, fault: true },
      },
    },
  });

  if (!unit) return null;

  const open = unit.checkouts[0] ?? null;

  /**
   * A unit stamped as gone while its status still offers it for booking.
   *
   * 553 units carry a `retiredAt` with a status other than RETIRED, and almost
   * all of them are benign: 539 are SOLD, where the import stamped both dates
   * for the same event, and 10 are CHECKED_OUT, which `availability.ts` says is
   * legitimate — a unit can be retired while still physically out. The four
   * that are AVAILABLE are not benign: the record says the hardware left and
   * the fleet is offering it to the next client anyway.
   *
   * Reported on the record, not repaired. Guessing which of the two fields is
   * right would bury the evidence, and one of the two guards removed from this
   * codebase was removed for exactly that — a derived value overruling the
   * physical record.
   */
  const retiredButBookable =
    unit.retiredAt !== null &&
    (unit.status === "AVAILABLE" || unit.status === "RESERVED");

  return {
    id: unit.id,
    retiredAt: unit.retiredAt,
    soldAt: unit.soldAt,
    retiredButBookable,
    barcode: unit.barcode,
    serialNumber: unit.serialNumber,
    status: unit.status,
    condition: unit.condition,
    notes: unit.notes,
    registeredAt: unit.createdAt,
    asset: unit.asset,
    maker:
      [unit.asset.manufacturer, unit.asset.model].filter(Boolean).join(" ") ||
      null,
    location: unit.location,
    holder: open
      ? {
          clientId: open.client.id,
          clientName: open.client.name,
          orderId: open.reservation?.id ?? null,
          orderNumber: open.reservation?.reservationNumber ?? null,
          since: open.checkoutDate,
          dueBack: open.expectedReturn,
        }
      : null,
    workOrder: unit.workOrders[0] ?? null,
  };
}

/**
 * Every time this unit has left the building.
 *
 * The status timeline the build plan asks for, read off `Checkout` rather than
 * off `AssetUnit.status`: the status column holds one value and this holds the
 * history, and only one of them can answer "how often has this been out". A
 * cancelled checkout is kept and labelled, because a booking that was pulled is
 * a thing that happened to this unit — dropping it would make the log quietly
 * disagree with the order it belongs to.
 */
export async function getUnitMovements(id: string, take = 20) {
  const [records, total] = await Promise.all([
    prisma.checkout.findMany({
      where: { assetUnitId: id },
      orderBy: { checkoutDate: "desc" },
      take,
      select: {
        id: true,
        status: true,
        checkoutDate: true,
        expectedReturn: true,
        actualReturn: true,
        returnCondition: true,
        damageFlag: true,
        client: { select: { id: true, name: true } },
        reservation: { select: { id: true, reservationNumber: true } },
      },
    }),
    prisma.checkout.count({ where: { assetUnitId: id } }),
  ]);

  return {
    total,
    rows: records.map((record) => ({
      id: record.id,
      status: record.status,
      out: record.checkoutDate,
      due: record.expectedReturn,
      back: record.actualReturn,
      condition: record.returnCondition,
      damaged: record.damageFlag,
      clientName: record.client.name,
      orderId: record.reservation?.id ?? null,
      orderNumber: record.reservation?.reservationNumber ?? null,
    })),
  };
}

/**
 * Bench work against this unit, from both places it can be recorded.
 *
 * `WorkOrder` is Stage 4's model and `MaintenanceRecord` is v1's; a closing work
 * order writes a maintenance record, so the two overlap by design and are shown
 * as one history rather than as two cards that look like duplicate work.
 */
export async function getUnitService(id: string, take = 12) {
  const [workOrders, maintenance] = await Promise.all([
    prisma.workOrder.findMany({
      where: { assetUnitId: id },
      orderBy: { openedAt: "desc" },
      take,
      select: {
        id: true,
        number: true,
        status: true,
        fault: true,
        billable: true,
        openedAt: true,
        closedAt: true,
        assignedTech: { select: { name: true } },
      },
    }),
    prisma.maintenanceRecord.findMany({
      where: { assetUnitId: id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        type: true,
        status: true,
        description: true,
        scheduledDate: true,
        completionDate: true,
        totalCost: true,
        performedBy: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    workOrders,
    maintenance: maintenance.map((record) => ({
      ...record,
      totalCost: record.totalCost === null ? null : Number(record.totalCost),
      at: record.completionDate ?? record.scheduledDate ?? record.createdAt,
    })),
  };
}

/**
 * Warranty and service contracts. Two sources for one question — "if this
 * breaks, who pays" — so the warranty date lives on the unit and the contracts
 * in `ServiceCoverage`, and the card shows both together.
 */
export async function getUnitCoverage(id: string, now = new Date()) {
  const [unit, coverages] = await Promise.all([
    prisma.assetUnit.findUnique({
      where: { id },
      select: { warrantyExpiry: true, vendor: { select: { id: true, name: true } } },
    }),
    prisma.serviceCoverage.findMany({
      where: { unitId: id },
      orderBy: { endDate: "desc" },
      select: {
        id: true,
        type: true,
        name: true,
        provider: true,
        startDate: true,
        endDate: true,
        cost: true,
      },
    }),
  ]);

  return {
    warrantyExpiry: unit?.warrantyExpiry ?? null,
    warrantyLive: unit?.warrantyExpiry ? unit.warrantyExpiry > now : false,
    vendor: unit?.vendor ?? null,
    coverages: coverages.map((coverage) => ({
      ...coverage,
      cost: coverage.cost === null ? null : Number(coverage.cost),
      live: coverage.endDate > now,
    })),
  };
}

/** Where it is now, and every move that put it there. */
export async function getUnitTransfers(id: string, take = 12) {
  const [records, total] = await Promise.all([
    prisma.assetTransfer.findMany({
      where: { assetUnitId: id },
      orderBy: { transferDate: "desc" },
      take,
      select: {
        id: true,
        transferDate: true,
        transferredBy: true,
        notes: true,
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
      },
    }),
    prisma.assetTransfer.count({ where: { assetUnitId: id } }),
  ]);

  return { total, rows: records };
}

/**
 * What was paid for this unit, how it was funded, and what it is worth now.
 *
 * The depreciation schedule lives on the *asset* and the price lives on the
 * *unit*, which is why this reads both. Book value is null rather than zero
 * when either half is missing — see `lib/inventory/depreciation`.
 */
export async function getUnitOwnership(id: string) {
  const unit = await prisma.assetUnit.findUnique({
    where: { id },
    select: {
      purchaseDate: true,
      receivedDate: true,
      purchasePrice: true,
      ownershipType: true,
      totalRevenue: true,
      maintenanceCost: true,
      loanName: true,
      loanAmount: true,
      fundingBusiness: true,
      amortizationEndDate: true,
      soldAt: true,
      soldPrice: true,
      soldViaReservation: true,
      soldNotes: true,
      retiredAt: true,
      retirementReason: true,
      retiredTo: true,
      vendor: { select: { id: true, name: true } },
      lease: {
        select: {
          id: true,
          leaseNumber: true,
          leaseName: true,
          lender: true,
          status: true,
          endDate: true,
        },
      },
      asset: {
        select: {
          depreciationMethod: true,
          usefulLifeMonths: true,
          salvageValue: true,
        },
      },
    },
  });

  if (!unit) return null;

  const purchasePrice =
    unit.purchasePrice === null ? null : Number(unit.purchasePrice);

  return {
    purchaseDate: unit.purchaseDate,
    receivedDate: unit.receivedDate,
    purchasePrice,
    ownershipType: unit.ownershipType,
    revenue: Number(unit.totalRevenue),
    maintenanceCost: Number(unit.maintenanceCost),
    loanName: unit.loanName,
    loanAmount: unit.loanAmount === null ? null : Number(unit.loanAmount),
    fundingBusiness: unit.fundingBusiness,
    amortizationEndDate: unit.amortizationEndDate,
    soldAt: unit.soldAt,
    soldPrice: unit.soldPrice === null ? null : Number(unit.soldPrice),
    soldViaReservation: unit.soldViaReservation,
    soldNotes: unit.soldNotes,
    retiredAt: unit.retiredAt,
    retirementReason: unit.retirementReason,
    retiredTo: unit.retiredTo,
    vendor: unit.vendor,
    lease: unit.lease,
    method: unit.asset.depreciationMethod,
    usefulLifeMonths: unit.asset.usefulLifeMonths,
    book: bookValue(
      {
        purchasePrice,
        purchaseDate: unit.purchaseDate,
        receivedDate: unit.receivedDate,
      },
      {
        method: unit.asset.depreciationMethod,
        usefulLifeMonths: unit.asset.usefulLifeMonths,
        salvageValue:
          unit.asset.salvageValue === null
            ? null
            : Number(unit.asset.salvageValue),
      },
    ),
  };
}
