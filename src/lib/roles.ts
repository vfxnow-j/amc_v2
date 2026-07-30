import { auth } from "@/lib/auth";
import type { ThemePreference } from "@/lib/theme";

export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "STAFF"
  | "VIEWER"
  | "FLOW_USER";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  /** Shown in the avatar tile. */
  initials: string;
  /**
   * Sits under the name in the user pod. The design reference shows a job title
   * ("Warehouse lead"), but `User` carries no title field — only a role. Rather
   * than invent one per person, the pod says what the record can prove.
   */
  title: string;
  role: Role;
};

const ROLE_TITLE: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Administrator",
  STAFF: "Warehouse staff",
  VIEWER: "Read-only access",
  FLOW_USER: "Flow user",
};

/** First letter of the first and last word — "Marvin Villa" → "MV". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * The signed-in user, or null. Null is not an error path the shell handles by
 * guessing: `(shell)/layout.tsx` redirects to /login, which is also what
 * `proxy.ts` does one layer earlier.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;

  const name = user.name || user.email || "Unknown user";

  return {
    id: user.id,
    name,
    email: user.email,
    initials: initialsFor(name),
    title: ROLE_TITLE[user.role as Role] ?? "User",
    role: user.role as Role,
  };
}

/**
 * The theme a user gets before they've chosen one: dark for warehouse staff
 * (warehouse lighting), light for admin and finance, per design/README.md.
 *
 * The handoff also asks for the override to be persisted on the `User` record.
 * There is no `theme` column in the schema, so for now the override lives only
 * in the localStorage mirror — it survives reloads on that browser but not a
 * move to another machine. Adding the column is a schema change worth batching
 * with the next migration rather than doing on its own.
 */
export function defaultThemeFor(role: Role | undefined): ThemePreference {
  if (role === "STAFF") return "dark";
  if (role === "SUPER_ADMIN" || role === "ADMIN") return "light";
  return "system";
}
