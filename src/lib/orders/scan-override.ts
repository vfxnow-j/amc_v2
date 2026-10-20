import type { MissingLine } from "@/lib/orders/handover";

/**
 * The super-admin override of the scan gate (lib/orders/handover).
 *
 * The gate stops an order shipping or activating while any unit is unscanned.
 * Occasionally the kit really is out and the scan was missed, and a super admin
 * may say so, by typing their own credentials and a reason. This file holds the
 * parts with rules: who counts as a super admin, what the shortfall was, how it
 * reads in the history, and the one-shot grant that lets the gate stand down
 * for exactly one order and one move.
 *
 * Kept out of the 'use server' files on purpose. Everything exported from one
 * of those is a callable endpoint, and a function that lifts the gate must not
 * be one.
 */

export type OverrideMove = "activate" | "ship";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export type OverrideUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string | null;
  disabledAt: Date | null;
};

/** The database and bcrypt, handed in so the rules can be tested without either. */
export type CredentialDeps = {
  findUserByEmail: (email: string) => Promise<OverrideUser | null>;
  compare: (password: string, hash: string) => Promise<boolean>;
};

export type CredentialOutcome =
  | { ok: true; admin: { id: string; name: string; email: string } }
  | { ok: false };

/** A hash that never matches, compared against when there is no real one. */
const DUMMY_HASH = "$2a$12$x".padEnd(60, "0");

/**
 * Is this email and password a live super admin?
 *
 * One outcome for every way to fail — unknown email, wrong password, wrong
 * role, disabled — so the caller can say nothing about which it was. A compare
 * runs on every path, so the time taken does not say either.
 */
export async function verifySuperAdmin(
  deps: CredentialDeps,
  email: string,
  password: string,
): Promise<CredentialOutcome> {
  const user = email ? await deps.findUserByEmail(email.trim().toLowerCase()) : null;
  const usable = !!user && !!user.passwordHash && !user.disabledAt && user.role === "SUPER_ADMIN";
  const matched = await deps.compare(password, usable ? user.passwordHash! : DUMMY_HASH);
  if (!usable || !matched || !password) return { ok: false };
  return { ok: true, admin: { id: user.id, name: user.name, email: user.email } };
}

export const MIN_REASON = 5;

/** The reason, trimmed; null when it is too thin to be a reason. */
export function cleanReason(reason: string | undefined | null): string | null {
  const text = (reason ?? "").replace(/\s+/g, " ").trim();
  return text.length >= MIN_REASON ? text.slice(0, 500) : null;
}

// ---------------------------------------------------------------------------
// The shortfall, as it stood
// ---------------------------------------------------------------------------

export type ShortfallLine = {
  item: string;
  /** The machine it goes in, for a part. */
  inside: string | null;
  ordered: number;
  scannedOut: number;
  notScanned: number;
};

export function shortfallLines(missing: MissingLine[]): ShortfallLine[] {
  return missing.map((line) => ({
    item: line.label,
    inside: line.parentLabel,
    ordered: line.ordered,
    scannedOut: line.out,
    notScanned: line.missing,
  }));
}

/** "2 x Mac Studio (in Edit Bay), 1 x RAM" — for the history note. */
export function shortfallText(lines: ShortfallLine[]): string {
  if (lines.length === 0) return "nothing was outstanding";
  return lines
    .map((line) => `${line.notScanned} x ${line.item}${line.inside ? ` (in ${line.inside})` : ""}`)
    .join(", ");
}

export function overrideLabel(move: OverrideMove): string {
  return move === "ship" ? "Shipped without scanning" : "Activated without scanning";
}

/** The note on the order's history row: unmistakably an override. */
export function historyNote(args: {
  move: OverrideMove;
  actor: string;
  admin: string;
  reason: string;
  lines: ShortfallLine[];
}): string {
  const units = args.lines.reduce((sum, line) => sum + line.notScanned, 0);
  return (
    `SCAN OVERRIDE: ${overrideLabel(args.move).toLowerCase()}. ` +
    `Authorised by super admin ${args.admin}${args.admin === args.actor ? "" : `, entered by ${args.actor}`}. ` +
    `Reason: ${args.reason}. ` +
    `Not scanned (${units} ${units === 1 ? "unit" : "units"}): ${shortfallText(args.lines)}.`
  );
}

// ---------------------------------------------------------------------------
// The one-shot grant
// ---------------------------------------------------------------------------

const GRANT_TTL_MS = 60_000;

// Pinned to globalThis: the action file and the reservations file can be
// bundled apart, and both must see the same grants.
const globalForGrants = globalThis as unknown as { __scanOverrideGrants?: Map<string, number> };
const grants = (globalForGrants.__scanOverrideGrants ??= new Map<string, number>());

const grantKey = (orderId: string, move: OverrideMove) => `${orderId}:${move}`;

/** Called only by the override action, after the credentials checked out. */
export function grantScanOverride(orderId: string, move: OverrideMove, now = Date.now()): void {
  grants.set(grantKey(orderId, move), now + GRANT_TTL_MS);
}

export function revokeScanOverride(orderId: string, move: OverrideMove): void {
  grants.delete(grantKey(orderId, move));
}

/** Is a grant standing? Does not use it up. */
export function hasScanOverride(orderId: string, move: OverrideMove, now = Date.now()): boolean {
  const until = grants.get(grantKey(orderId, move));
  return until !== undefined && until > now;
}

/** The gate asks here; a grant answers yes once, for that order and move only. */
export function consumeScanOverride(orderId: string, move: OverrideMove, now = Date.now()): boolean {
  const ok = hasScanOverride(orderId, move, now);
  grants.delete(grantKey(orderId, move));
  return ok;
}
