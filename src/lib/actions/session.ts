"use server";

import { signOut } from "@/lib/auth";

/**
 * Sign out from the user pod. NextAuth clears the session cookie and redirects,
 * so this never returns.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
