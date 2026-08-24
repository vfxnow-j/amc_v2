import type { Role } from "@/lib/roles";

/**
 * What lives under Settings, and who may open it.
 *
 * Settings is pinned at the bottom of the rail with no children of its own
 * (`lib/nav/clusters.ts`), so this list is the only index of the area — the
 * screen at `/dashboard/settings` renders it, and every child reads it back to
 * name itself and to say where "all settings" goes. One list, so a screen can't
 * exist without appearing in the index and an index entry can't point at a 404.
 *
 * A plain module on purpose. Half of these entries are label strings and the
 * temptation is to keep them next to the actions that use them, but
 * `lib/actions/*` are `"use server"` files, and such a module may only export
 * async functions — exporting this array from one typechecks, lints and runs in
 * dev, then fails the production build.
 *
 * Three v1 children are deliberately absent. `ai` went with the AI assistant;
 * `locations` was promoted into Inventory and is built there; `vendors` was a
 * byte-for-byte copy of `/dashboard/vendors` and v2 has the one screen.
 */

/** Who can open a screen. Editing inside one may still be narrower. */
export type SettingsAccess = "everyone" | "admin";

export type SettingsGroup =
  | "People and access"
  | "The catalog"
  | "Records"
  | "Connections";

export type SettingsPage = {
  id: string;
  label: string;
  href: string;
  /** One line, in the index. Says what the screen decides, not what it is. */
  blurb: string;
  access: SettingsAccess;
  group: SettingsGroup;
};

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: "profile",
    label: "My profile",
    href: "/dashboard/settings/profile",
    blurb: "Your account, your password, and where the second factor stands.",
    access: "everyone",
    group: "People and access",
  },
  {
    id: "users",
    label: "Users",
    href: "/dashboard/settings/users",
    blurb: "Who can sign in, and what each of them is allowed to do.",
    access: "admin",
    group: "People and access",
  },
  {
    id: "api-keys",
    label: "API keys",
    href: "/dashboard/settings/api-keys",
    blurb: "Keys that let a machine call the API without a session.",
    access: "admin",
    group: "People and access",
  },
  {
    id: "categories",
    label: "Categories",
    href: "/dashboard/settings/categories",
    blurb: "How assets are grouped, and which groups build workstations.",
    access: "everyone",
    group: "The catalog",
  },
  {
    id: "cloud-products",
    label: "Cloud pricing",
    href: "/dashboard/settings/cloud-products",
    blurb: "Cost and margin behind every line on a cloud order.",
    access: "everyone",
    group: "The catalog",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/dashboard/settings/documents",
    blurb: "Every PDF the system generated or received. Deletes are reversible.",
    access: "everyone",
    group: "Records",
  },
  {
    id: "audit-log",
    label: "Audit log",
    href: "/dashboard/settings/audit-log",
    blurb: "Who did what, when, and from which address.",
    access: "admin",
    group: "Records",
  },
  {
    id: "import",
    label: "Import",
    href: "/dashboard/settings/import",
    blurb: "Bring assets, rates and retirements in from a spreadsheet.",
    access: "admin",
    group: "Records",
  },
  {
    id: "quickbooks",
    label: "QuickBooks",
    href: "/dashboard/settings/quickbooks",
    blurb: "The accounting connection: customers, invoices and payments.",
    access: "admin",
    group: "Connections",
  },
  {
    id: "integrations",
    label: "Integrations",
    href: "/dashboard/settings/integrations",
    blurb: "Zapier and HubSpot, and what the inbound API expects.",
    access: "admin",
    group: "Connections",
  },
  {
    // Built alongside the rest of this area by the notifications workstream,
    // not here. Listed because the index is the whole map of Settings, and
    // filed under People because it is per-account: it decides what reaches
    // *you*, which is why anyone who can sign in can open it.
    id: "notifications",
    label: "Notifications",
    href: "/dashboard/settings/notifications",
    blurb: "What reaches you, and by which route.",
    access: "everyone",
    group: "People and access",
  },
];

export const SETTINGS_GROUPS: SettingsGroup[] = [
  "People and access",
  "The catalog",
  "Records",
  "Connections",
];

/** ADMIN and SUPER_ADMIN only, matching `requireAdmin` in `lib/auth-utils`. */
export function isAdminRole(role: Role): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function canOpen(page: SettingsPage, role: Role): boolean {
  return page.access === "everyone" || isAdminRole(role);
}

export function settingsPagesFor(role: Role): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => canOpen(page, role));
}

export function settingsPage(id: string): SettingsPage | undefined {
  return SETTINGS_PAGES.find((page) => page.id === id);
}
