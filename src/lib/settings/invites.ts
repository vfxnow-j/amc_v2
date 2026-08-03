"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import { isEmailConfigured } from "@/lib/email";
import { createUser, resendInvite } from "@/lib/actions/users";
import type { UserRole } from "@/generated/prisma/client";

/**
 * Inviting somebody, on an instance that cannot send email.
 *
 * `createUser` mints an ACCOUNT_SETUP token, mails the link and — when the mail
 * fails — logs the failure and returns the user anyway. That is the right call
 * for the action (a delivery problem shouldn't roll back the account), but it
 * leaves an admin looking at a new row that can never sign in, with no way to
 * find the link that would let them.
 *
 * `RESEND_API_KEY` is blank in v2 by design, so that is not an edge case here,
 * it is every invite. This wrapper reads the token back and hands the setup URL
 * to the screen so the admin can pass it on themselves. When email *is*
 * configured the URL is withheld: the link is a password-reset-grade
 * credential, and it should live in the recipient's inbox rather than on
 * somebody else's screen.
 *
 * A `"use server"` module, so every export is an async function — the role
 * constants and copy this area needs live in `lib/settings/pages.ts` instead.
 */

export type InviteResult =
  | {
      status: "ok";
      /** Whether the invite email actually went out. */
      delivered: boolean;
      /** Present only when it did not, so somebody has to relay it by hand. */
      setupUrl?: string;
      email: string;
    }
  | { status: "error"; message: string };

async function setupUrlFor(email: string): Promise<string | undefined> {
  const token = await prisma.emailToken.findFirst({
    where: {
      identifier: email.toLowerCase(),
      type: "ACCOUNT_SETUP",
      used: false,
      expires: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });
  if (!token) return undefined;

  const base =
    process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3001";
  return `${base}/setup-account?token=${encodeURIComponent(token.token)}`;
}

export async function inviteUser(input: {
  name: string;
  email: string;
  role: UserRole;
}): Promise<InviteResult> {
  // createUser gates too; checking here keeps the failure a message rather than
  // a thrown error crossing the action boundary.
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) {
    return { status: "error", message: "Give them a name — the invite email uses it." };
  }

  try {
    await createUser({ name: input.name.trim(), email, role: input.role });
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not create the account.",
    };
  }

  const delivered = isEmailConfigured();
  return {
    status: "ok",
    delivered,
    email,
    setupUrl: delivered ? undefined : await setupUrlFor(email),
  };
}

/** Mint a fresh setup link for somebody whose invite expired or never arrived. */
export async function reissueInvite(userId: string): Promise<InviteResult> {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Unauthorized" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) return { status: "error", message: "That account no longer exists." };

  try {
    await resendInvite(userId);
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not reissue the invite.",
    };
  }

  const delivered = isEmailConfigured();
  return {
    status: "ok",
    delivered,
    email: user.email,
    setupUrl: delivered ? undefined : await setupUrlFor(user.email),
  };
}
