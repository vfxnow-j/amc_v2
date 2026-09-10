import { prisma } from "@/lib/prisma";
import { defaultModeFor, type Role } from "@/lib/roles";
import {
  appearanceDefaults,
  AXES,
  normalizeAppearance,
  type AppearanceValues,
  type AxisId,
} from "@/lib/theme";

export type Appearance = AppearanceValues;

/** Every axis's column, so the select widens with the list rather than by hand. */
const APPEARANCE_SELECT = Object.fromEntries(
  AXES.map((axis) => [axis.column, true]),
) as Record<string, true>;

/**
 * What the root layout hands the pre-paint script.
 *
 * Read from the User row rather than the session, because a session token
 * minted before a change would carry a stale one and the whole point of these
 * columns is that the choice follows the person. It is a primary-key lookup on
 * a row already in the connection's cache, on a layout that renders for every
 * authenticated request.
 *
 * Anything unrecognised — a hand-edited row, a theme renamed out of
 * `lib/theme` — falls back rather than being trusted onto the attribute, where
 * it would select ramps that no longer exist and paint an unstyled app. Every
 * column is nullable and every one of the nine restored users has all five
 * unset, so "no value" is the ordinary case and not an error.
 *
 * The row is read back untyped on purpose: the columns are chosen by walking
 * `AXES`, so there is no static shape to name, and every value is run through
 * the same validation as a hand-edited localStorage entry anyway.
 */
export async function getAppearance(
  userId: string | undefined,
  role: Role | undefined,
): Promise<Appearance> {
  const fallback = appearanceDefaults({ mode: defaultModeFor(role) });
  if (!userId) return fallback;

  const row = (await prisma.user.findUnique({
    where: { id: userId },
    select: APPEARANCE_SELECT,
  })) as Record<string, unknown> | null;

  const stored: Partial<Record<AxisId, unknown>> = {};
  for (const axis of AXES) stored[axis.id] = row?.[axis.column];

  return normalizeAppearance(stored, fallback);
}
