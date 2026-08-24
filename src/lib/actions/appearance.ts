"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import {
  isAccentId,
  isThemePreference,
  type AccentId,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Persist the signed-in user's appearance choices onto their own row.
 *
 * Deliberately not an admin action and deliberately not parameterised by user
 * id: appearance is the one setting a person changes for themselves, so the
 * subject is always the session. There is nothing to authorise beyond being
 * signed in.
 *
 * The client has already applied the change and mirrored it to localStorage —
 * this is what makes it survive a different browser. A failure here is
 * therefore not worth interrupting anybody over; the caller reports it quietly
 * and the choice still holds on this machine.
 */
export async function saveAppearance(input: {
  preference?: ThemePreference;
  accent?: AccentId;
}): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");

  const data: { themePreference?: string; accentTheme?: string } = {};
  if (isThemePreference(input.preference)) {
    data.themePreference = input.preference;
  }
  if (isAccentId(input.accent)) {
    data.accentTheme = input.accent;
  }
  if (Object.keys(data).length === 0) return;

  await prisma.user.update({ where: { id: user.id }, data });
}
