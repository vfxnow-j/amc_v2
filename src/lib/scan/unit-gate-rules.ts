// Pure decision of the scan gate. No Prisma: the prompt component imports the types.
import { checkMatch, checkUnit, type Gap } from "./completeness";
import type { DataFlag, FlagOutcome } from "@/generated/prisma/client";
import { reasonByCode } from "@/lib/flags/catalog";

export type GateFacts = {
  unitId: string; barcode: string; assetName: string;
  serialNumber: string | null; requiresSerial: boolean;
  dataFlag: DataFlag | null;
  scannedSerial?: string;
  move: "out" | "in" | "audit" | "lookup";
  /** The case this unit is on: open, or the closed one that wrote it off. */
  openCase?: {
    flagId: string; reservationNumber: string; reasonCode: string;
    outcome: FlagOutcome | null; claimNumber: string | null; outcomeAmount: number | null;
  } | null;
  /** Retired as lost, so a scan of it is a unit that came back. */
  retiredLost?: boolean;
};

export type GateResult =
  | { kind: "clear" }
  | { kind: "needs-data"; unitId: string; barcode: string; assetName: string; gap: Gap }
  | { kind: "mismatch"; unitId: string; barcode: string; assetName: string; expected: string; scanned: string }
  | { kind: "blocked"; unitId: string; barcode: string; assetName: string; reason: string }
  | {
      kind: "on-case"; unitId: string; barcode: string; assetName: string;
      flagId: string; reservationNumber: string; reasonLabel: string;
      unitState: "open-case" | "written-off";
      /** Set when a carrier claim was already paid: a refund may be due if the unit is reinstated. */
      claim: { claimNumber: string; amount: number } | null;
    };

export function decideGate(f: GateFacts): GateResult {
  const id = { unitId: f.unitId, barcode: f.barcode, assetName: f.assetName };
  const check = checkUnit(f);

  // A unit that is missing or written off is dealt with before its serial: it
  // came back, and what happens to the case matters more than a label.
  if (f.openCase) {
    const c = f.openCase;
    return {
      kind: "on-case", ...id,
      flagId: c.flagId, reservationNumber: c.reservationNumber,
      reasonLabel: reasonByCode(c.reasonCode)?.label ?? c.reasonCode,
      unitState: f.retiredLost ? "written-off" : "open-case",
      claim:
        c.outcome === "CLAIM_PAID" && c.claimNumber && c.outcomeAmount
          ? { claimNumber: c.claimNumber, amount: c.outcomeAmount }
          : null,
    };
  }

  // A unit already flagged cannot leave until its data is fixed. Coming back in,
  // it prompts again: the person is holding it and can read the label now.
  if (!check.complete && f.dataFlag && f.move === "out") {
    return { kind: "blocked", ...id, reason: "Serial number is missing. Fix it under Inventory → Missing data." };
  }
  if (!check.complete) return { kind: "needs-data", ...id, gap: check.gap };

  if (f.scannedSerial && checkMatch(f.serialNumber, f.scannedSerial) === "mismatch") {
    return { kind: "mismatch", ...id, expected: f.serialNumber as string, scanned: f.scannedSerial };
  }
  return { kind: "clear" };
}
