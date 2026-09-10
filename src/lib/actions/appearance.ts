"use server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/roles";
import { AXES, isAxisValue, type AppearanceValues } from "@/lib/theme";

/**
 * Persist the signed-in user's appearance choices onto their own row.
 *
 * Deliberately not an admin action and deliberately not parameterised by user
 * id: appearance is the one setting a person changes for themselves, so the
 * subject is always the session. There is nothing to authorise beyond being
 * signed in.
 *
 * Takes any subset of the axes and writes the ones it recognises, so a control
 * sends only what it changed and a sixth axis needs no edit here — the columns
 * come from `AXES`. A value the axis does not offer is dropped rather than
 * rejected: the same rule the pre-paint script and the store follow, and the
 * only thing that could send one is a hand-crafted call.
 *
 * The client has already applied the change and mirrored it to localStorage —
 * this is what makes it survive a different browser. A failure here is
 * therefore not worth interrupting anybody over; the caller reports it quietly
 * and the choice still holds on this machine.
 */
export async function saveAppearance(
  input: Partial<AppearanceValues>,
): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");

  const data: Record<string, string> = {};
  for (const axis of AXES) {
    const value = input[axis.id];
    if (isAxisValue(axis, value)) data[axis.column] = value;
  }
  if (Object.keys(data).length === 0) return;

  await prisma.user.update({ where: { id: user.id }, data });
}
