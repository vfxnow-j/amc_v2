// Pure rules of the scan-out gate, apart from handover.ts so tests need no database.
import type { Handover } from "./handover";

/** The refusal, in words — for the server when there is no dialog to show it. */
export function shortfallMessage(handover: Handover, move: HandoverMove): string {
  const { units, missing, dataFlagged } = handover;
  const doing = move === "ship" ? "shipping" : move === "complete" ? "completing the order" : "activating";
  const flagged = `${dataFlagged} ${dataFlagged === 1 ? "unit is" : "units are"} missing a serial.`;
  if (units === 0) return `${flagged} Fix them under Insight → Missing data (or ask an admin) before ${doing}.`;
  const short = `${units} ${units === 1 ? "unit is" : "units are"} still to be checked out across ${missing.length} ${
    missing.length === 1 ? "line" : "lines"
  }. Scan everything out before ${doing}.`;
  return dataFlagged > 0 ? `${short} Also, ${flagged.charAt(0).toLowerCase()}${flagged.slice(1)}` : short;
}

/** The moves the scan-out gate stands in front of. */
export type HandoverMove = "activate" | "ship" | "complete";

/**
 * Whether the scan-out gate applies to a move on this type of order.
 *
 * Ship always; activate except on cloud (its hardware is allocated, not
 * scanned); complete only on a sale. A sale is "completed" when it is fulfilled,
 * and units can be checked out yet not shipped, so completion needs its own
 * crisp rule: every unit verified out (owner, 2026-10-20; v1 blocked Complete
 * Sale until stock was checked out). A rental completes by return, which its own
 * check-in rule already enforces. Build headings are not counted by
 * handoverShortfall, and their parts are.
 */
export function gateApplies(move: HandoverMove, type: string): boolean {
  if (move === "ship") return true;
  if (move === "activate") return type !== "CLOUD";
  return type === "SALE";
}
