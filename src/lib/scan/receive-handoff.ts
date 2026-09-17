/**
 * Serials scanned in the Scan screen's Receive mode, carried to the PO's
 * receive screen.
 *
 * Session storage rather than the URL: a pallet of forty serials does not fit
 * comfortably in a query string, and the handoff is one tab moving from one
 * screen to the next. It is read once and cleared, so a reload of the receive
 * screen later starts clean rather than resurrecting an old scan.
 *
 * Every access is guarded. Storage can be unavailable (a private window, blocked
 * site data), and losing the handoff must never break the receive screen — the
 * serials can still be scanned there.
 */

export type ReceiveHandoff = {
  /** Serials per PO line id, in scan order. */
  lines: Record<string, string[]>;
  at: number;
};

/** Older than this and it was abandoned, not handed off. */
const STALE_MS = 60 * 60 * 1000;

const keyFor = (purchaseOrderId: string) => `scan-receive:${purchaseOrderId}`;

export function saveReceiveHandoff(purchaseOrderId: string, lines: Record<string, string[]>) {
  try {
    sessionStorage.setItem(
      keyFor(purchaseOrderId),
      JSON.stringify({ lines, at: Date.now() } satisfies ReceiveHandoff),
    );
    return true;
  } catch {
    return false;
  }
}

export function takeReceiveHandoff(purchaseOrderId: string): ReceiveHandoff | null {
  try {
    const raw = sessionStorage.getItem(keyFor(purchaseOrderId));
    if (!raw) return null;
    sessionStorage.removeItem(keyFor(purchaseOrderId));
    const parsed = JSON.parse(raw) as ReceiveHandoff;
    if (!parsed?.lines || Date.now() - parsed.at > STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
