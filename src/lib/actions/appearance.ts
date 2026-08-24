"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { isColorMode, isThemeId, type ColorMode, type ThemeId } from "@/lib/theme";

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
  mode?: ColorMode;
  theme?: ThemeId;
}): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");

  const data: { colorMode?: string; themeName?: string } = {};
  if (isColorMode(input.mode)) data.colorMode = input.mode;
  if (isThemeId(input.theme)) data.themeName = input.theme;
  if (Object.keys(data).length === 0) return;

  await prisma.user.update({ where: { id: user.id }, data });
}
