import { prisma } from "@/lib/prisma";
import { defaultThemeFor, type Role } from "@/lib/roles";
import {
  DEFAULT_ACCENT,
  isAccentId,
  isThemePreference,
  type AccentId,
  type ThemePreference,
} from "@/lib/theme";

export type Appearance = {
  preference: ThemePreference;
  accent: AccentId;
};

/**
 * What the root layout hands the pre-paint script.
 *
 * Read from the User row rather than the session, because a session token
 * minted before a theme change would carry a stale one and the whole point of
 * this column is that the choice follows the person. It is a primary-key lookup
 * on a row already in the connection's cache, on a layout that renders for
 * every authenticated request.
 *
 * Anything unrecognized — a hand-edited row, an accent renamed out of
 * `lib/theme` — falls back to the role default rather than being trusted onto
 * the attribute, where it would select a ramp that no longer exists.
 */
export async function getAppearance(
  userId: string | undefined,
  role: Role | undefined,
): Promise<Appearance> {
  const fallback: Appearance = {
    preference: defaultThemeFor(role),
    accent: DEFAULT_ACCENT,
  };
  if (!userId) return fallback;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { themePreference: true, accentTheme: true },
  });

  return {
    preference: isThemePreference(row?.themePreference)
      ? row.themePreference
      : fallback.preference,
    accent: isAccentId(row?.accentTheme) ? row.accentTheme : fallback.accent,
  };
}
