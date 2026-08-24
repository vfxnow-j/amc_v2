import { prisma } from "@/lib/prisma";
import { defaultModeFor, type Role } from "@/lib/roles";
import {
  DEFAULT_THEME,
  isColorMode,
  isThemeId,
  type ColorMode,
  type ThemeId,
} from "@/lib/theme";

export type Appearance = {
  mode: ColorMode;
  theme: ThemeId;
};

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
 * it would select ramps that no longer exist and paint an unstyled app.
 */
export async function getAppearance(
  userId: string | undefined,
  role: Role | undefined,
): Promise<Appearance> {
  const fallback: Appearance = {
    mode: defaultModeFor(role),
    theme: DEFAULT_THEME,
  };
  if (!userId) return fallback;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { colorMode: true, themeName: true },
  });

  return {
    mode: isColorMode(row?.colorMode) ? row.colorMode : fallback.mode,
    theme: isThemeId(row?.themeName) ? row.themeName : fallback.theme,
  };
}
