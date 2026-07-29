export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "STAFF"
  | "VIEWER"
  | "FLOW_USER";

export type SessionUser = {
  name: string;
  /** Shown in the avatar tile. */
  initials: string;
  /** Job title, under the name in the user pod. */
  title: string;
  role: Role;
};

/**
 * Stand-in for the session until auth lands, at which point this reads the User
 * record (and supplies the theme preference to the root layout).
 *
 * The identity is the one in the design reference. Its role is ADMIN rather than
 * STAFF so all six clusters are visible while the shell is being reviewed — the
 * reference frame shows a full rail for this person, but STAFF is gated to
 * Operate, Inventory and Service center by `clustersForRole`.
 */
export function getSessionUser(): SessionUser {
  return {
    name: "D. Reyes",
    initials: "DR",
    title: "Warehouse lead",
    role: "ADMIN",
  };
}
