"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-utils";
import { disconnect } from "@/lib/quickbooks/qb-client";
import { syncAllCustomers, syncAllInvoices } from "@/lib/quickbooks/qb-sync";

/**
 * The QuickBooks writes the settings screen can trigger.
 *
 * `lib/actions/quickbooks.ts` already wraps the sync functions with
 * `requireAdmin`, but it throws on both authorisation and API failure — and a
 * sync of eighty-two customers against somebody else's rate-limited API fails
 * routinely and partially. A thrown error crossing the action boundary tells
 * the screen nothing it can show except "something went wrong", so these return
 * an outcome instead: how many went, how many did not, and why.
 *
 * Disconnecting is here rather than in a route handler because it is a write
 * with no redirect — v1 had it as a POST endpoint the page called with fetch,
 * which is a round trip and a revalidation this does for free.
 */

export type QuickBooksOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export async function disconnectQuickBooks(): Promise<QuickBooksOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  try {
    await disconnect();
  } catch (cause) {
    console.error("QuickBooks disconnect failed:", cause);
    return {
      status: "error",
      message:
        "The token was not revoked at Intuit's end. It has been removed here, so nothing else will use it.",
    };
  }

  revalidatePath("/dashboard/settings/quickbooks");
  return {
    status: "ok",
    message:
      "Disconnected. The QuickBooks ids already on clients and invoices are left alone — reconnecting to the same company picks up where this left off.",
  };
}

export async function pushCustomers(): Promise<QuickBooksOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  try {
    const result = await syncAllCustomers();
    revalidatePath("/dashboard/settings/quickbooks");
    return {
      status: "ok",
      message: describe("customers", result),
    };
  } catch (cause) {
    return { status: "error", message: reason(cause) };
  }
}

export async function pushInvoices(): Promise<QuickBooksOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  try {
    const result = await syncAllInvoices();
    revalidatePath("/dashboard/settings/quickbooks");
    return {
      status: "ok",
      message: describe("invoices", result),
    };
  } catch (cause) {
    return { status: "error", message: reason(cause) };
  }
}

/**
 * `syncAll*` never throws on an individual record — it collects a message per
 * failure and carries on, which is right for eighty-two customers over a
 * rate-limited API. So the count of failures is the length of that list, and
 * the first entry is worth more than the count: one rejected token or one
 * missing income account explains all of them.
 */
function describe(
  what: string,
  result: { synced: number; errors: string[] },
): string {
  if (result.errors.length === 0) {
    return result.synced === 0
      ? `Nothing to push — every ${what.replace(/s$/, "")} already carries a QuickBooks id.`
      : `Pushed ${result.synced} ${what}. Nothing failed.`;
  }
  return `Pushed ${result.synced} ${what}, ${result.errors.length} failed. First failure — ${result.errors[0]}`;
}

/**
 * A failure message safe to render. QuickBooks errors quote the request back,
 * which for a token exchange includes the client secret, so the body is logged
 * and only the shape of the failure is returned.
 */
function reason(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  console.error("QuickBooks sync failed:", text);

  if (text.includes("not connected")) {
    return "Not connected to QuickBooks. Connect first.";
  }
  if (text.includes("401") || text.includes("refresh")) {
    return "QuickBooks refused the stored token. Disconnect and connect again — a refresh token expires after 100 days of not being used.";
  }
  return "QuickBooks rejected the request. The detail is in the server log; it is withheld here because those responses quote the request back, credentials and all.";
}
