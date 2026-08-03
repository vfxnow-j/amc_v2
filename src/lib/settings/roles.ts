import type { Role } from "@/lib/roles";

/**
 * The five roles, as an administrator has to choose between them.
 *
 * `lib/roles.ts` already names them for the user pod ("Warehouse staff"), but
 * a pod label answers "who am I" and this answers "what will this person be
 * able to do" — which is the only question worth asking on the Users screen.
 * The detail lines are what `lib/auth-utils` actually enforces: `requireEditor`
 * lets STAFF write, `requireAdmin` gates the settings area, `requireSuperAdmin`
 * gates admin-level role changes.
 *
 * A plain module, deliberately not `lib/actions/users.ts` — that file is
 * `"use server"` and may only export async functions.
 */

export type RoleOption = {
  value: Role;
  label: string;
  detail: string;
};

export const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "SUPER_ADMIN",
    label: "Super admin",
    detail: "Everything, including promoting and demoting other admins.",
  },
  {
    value: "ADMIN",
    label: "Admin",
    detail: "Everything except changing admin-level roles.",
  },
  {
    value: "STAFF",
    label: "Staff",
    detail: "Can run the floor — orders, check-out, service. No settings.",
  },
  {
    value: "VIEWER",
    label: "Viewer",
    detail: "Can read every screen and change nothing.",
  },
  {
    value: "FLOW_USER",
    label: "Flow only",
    detail:
      "The task area, which v2 does not have — this account cannot open anything here.",
  },
];

/**
 * What an API key may be issued as.
 *
 * Narrower than the user roles on purpose. SUPER_ADMIN is left out because the
 * only thing it adds over ADMIN is changing admin-level roles, and no machine
 * should be doing that with a bearer token; FLOW_USER is left out because the
 * task area does not exist in v2, so a key holding it can reach nothing. Both
 * remain valid values in the schema — this list only governs what the form
 * offers, and `lib/api-auth.ts` still enforces whatever a key carries.
 */
export const API_KEY_ROLES: Role[] = ["VIEWER", "STAFF", "ADMIN"];

export function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

/** Assigning or removing these needs SUPER_ADMIN, per `updateUser`. */
export function isAdminLevel(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
