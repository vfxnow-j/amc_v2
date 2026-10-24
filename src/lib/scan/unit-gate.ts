import { prisma } from "@/lib/prisma";
import { decideGate, type GateFacts, type GateResult } from "./unit-gate-rules";

/** Look a scanned code up and decide whether the unit may carry on. `null` = no such unit. */
export async function gateUnit(
  code: string,
  opts: { scannedSerial?: string; move: GateFacts["move"] } = { move: "lookup" },
): Promise<GateResult | null> {
  const value = code.trim();
  const unit = await prisma.assetUnit.findFirst({
    where: { OR: [{ barcode: value }, { serialNumber: { equals: value, mode: "insensitive" } }] },
    select: {
      id: true, barcode: true, serialNumber: true, dataFlag: true, status: true, retirementReason: true,
      asset: { select: { name: true, requiresSerial: true } },
    },
  });
  if (!unit) return null;

  // On an open case and not yet found, or written off as lost with its case closed.
  const retiredLost = unit.status === "RETIRED" && unit.retirementReason === "LOST";
  const link = await prisma.orderFlagUnit.findFirst({
    where: retiredLost
      ? { assetUnitId: unit.id, flag: { resolvedAt: { not: null } } }
      : { assetUnitId: unit.id, foundAt: null, flag: { resolvedAt: null } },
    orderBy: { flag: { raisedAt: "desc" } },
    select: {
      flag: {
        select: {
          id: true, reason: true, outcome: true, claimNumber: true, outcomeAmount: true,
          reservation: { select: { reservationNumber: true } },
        },
      },
    },
  });
  const openCase = link
    ? {
        flagId: link.flag.id,
        reservationNumber: link.flag.reservation.reservationNumber,
        reasonCode: link.flag.reason,
        outcome: link.flag.outcome,
        claimNumber: link.flag.claimNumber,
        outcomeAmount: link.flag.outcomeAmount === null ? null : Number(link.flag.outcomeAmount),
      }
    : null;
  return decideGate({
    unitId: unit.id, barcode: unit.barcode, assetName: unit.asset.name,
    serialNumber: unit.serialNumber, requiresSerial: unit.asset.requiresSerial,
    dataFlag: unit.dataFlag, scannedSerial: opts.scannedSerial, move: opts.move,
    openCase, retiredLost,
  });
}
