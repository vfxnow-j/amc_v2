import { dueAlerts, type Problem } from "./status";

/** The dedupe record, with a compare-and-swap so two overlapping callers cannot both win. */
export type AlertStore = {
  read(): Promise<{ sent: Record<string, string>; version: string | null }>;
  /** Write `next` only if the record is still at `version`; false when someone else got there first. */
  swap(version: string | null, next: Record<string, string>): Promise<boolean>;
};

/**
 * Decide what to send AND record it before anything is sent. Returns the
 * problems this caller now owns; an empty list means nothing is due or another
 * caller claimed it. A failed write sends nothing (an alert is better late than
 * mailed every hour).
 */
export async function claimAlerts(store: AlertStore, problems: Problem[], now: Date): Promise<Problem[]> {
  const { sent, version } = await store.read();
  const { send, next } = dueAlerts(problems, sent, now);
  if (JSON.stringify(next) === JSON.stringify(sent)) return [];
  try {
    if (!(await store.swap(version, next))) return [];
  } catch {
    return [];
  }
  return send;
}
