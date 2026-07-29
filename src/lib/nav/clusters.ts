import type { Role } from "@/lib/roles";

/**
 * The v2 information architecture: ~28 sibling routes grouped into six clusters
 * (design/README.md, "Information architecture").
 *
 * Paths are the live v1 paths, verified against the v1 tree at
 * ../vfxnow-amc/src/app/(dashboard)/dashboard/ — everything sits under
 * /dashboard, so v2 keeps those URLs and no links break. The merges (Desk,
 * Contracts, Audits & scan lists) are step 4 of the build order and change URLs,
 * so each still points at its primary v1 route for now.
 */

export type ClusterId =
  | "operate"
  | "inventory"
  | "service"
  | "revenue"
  | "clients"
  | "insight";

export type NavPage = {
  id: string;
  label: string;
  href: string;
  /**
   * Match the href exactly. Overview owns /dashboard itself, not every route
   * beneath it.
   */
  exact?: boolean;
  /**
   * The v1 route(s) this screen is rebuilt from. More than one means the v2
   * screen merges them. Absent means it's new in v2 with no v1 screen behind it.
   */
  from?: string[];
};

export type NavCluster = {
  id: ClusterId;
  /** Two-letter code in the mark tile. */
  code: string;
  label: string;
  /** Carries the NEW pill in the rail. */
  isNew?: boolean;
  /** Gated here rather than per-page, per the handoff. */
  roles: Role[];
  pages: NavPage[];
};

const ALL_ADMIN: Role[] = ["SUPER_ADMIN", "ADMIN"];

export const NAV_CLUSTERS: NavCluster[] = [
  {
    id: "operate",
    code: "OP",
    label: "Operate",
    // VIEWER gets Operate read-only; that's enforced per action, not by hiding
    // the cluster.
    roles: [...ALL_ADMIN, "STAFF", "VIEWER"],
    pages: [
      {
        id: "reservations",
        label: "Reservations",
        href: "/dashboard/reservations",
        from: ["/dashboard/reservations"],
      },
      {
        // TODO(step 4): becomes one two-mode screen at /dashboard/desk, with
        // redirects from all three v1 paths.
        id: "desk",
        label: "Desk — check-out / in",
        href: "/dashboard/checkout",
        from: [
          "/dashboard/checkout",
          "/dashboard/checkin",
          "/dashboard/checkouts",
        ],
      },
      {
        id: "mobile",
        label: "Mobile scan",
        href: "/dashboard/mobile",
        from: ["/dashboard/mobile"],
      },
      {
        id: "calendar",
        label: "Calendar",
        href: "/dashboard/calendar",
        from: ["/dashboard/calendar"],
      },
      {
        // Promoted out of reservations; the Package model already exists.
        id: "packages",
        label: "Packages",
        href: "/dashboard/packages",
      },
    ],
  },
  {
    id: "inventory",
    code: "IN",
    label: "Inventory",
    roles: [...ALL_ADMIN, "STAFF"],
    pages: [
      {
        // Absorbs two v1 siblings: `retired` becomes a filter tab on this list,
        // `register` becomes an action on it.
        id: "assets",
        label: "Assets",
        href: "/dashboard/assets",
        from: [
          "/dashboard/assets",
          "/dashboard/assets/retired",
          "/dashboard/assets/register",
        ],
      },
      {
        // Serialized units are only reachable through an asset in v1
        // (/dashboard/assets/[id]/units); v2 promotes them to a list.
        id: "units",
        label: "Units",
        href: "/dashboard/units",
      },
      {
        // v1's top nav links to /dashboard/locations, which doesn't exist —
        // the only locations screen is the settings one.
        id: "locations",
        label: "Locations & transfers",
        href: "/dashboard/locations",
        from: ["/dashboard/settings/locations"],
      },
      {
        // TODO(step 4): one screen, two tabs.
        id: "audits",
        label: "Audits & scan lists",
        href: "/dashboard/audits",
        from: ["/dashboard/audits", "/dashboard/scan-lists"],
      },
      {
        id: "vendors",
        label: "Vendors",
        href: "/dashboard/vendors",
        from: ["/dashboard/vendors"],
      },
    ],
  },
  {
    id: "service",
    code: "SC",
    label: "Service center",
    isNew: true,
    roles: [...ALL_ADMIN, "STAFF"],
    pages: [
      {
        id: "work-orders",
        label: "Work orders",
        href: "/dashboard/service/work-orders",
      },
      {
        id: "qc-runs",
        label: "QC test runs",
        href: "/dashboard/service/qc-runs",
      },
      {
        id: "maintenance",
        label: "Maintenance log",
        href: "/dashboard/maintenance",
        from: ["/dashboard/maintenance"],
      },
      {
        id: "coverage",
        label: "Coverage & RMA",
        href: "/dashboard/service/coverage",
      },
    ],
  },
  {
    id: "revenue",
    code: "RV",
    label: "Revenue",
    roles: ALL_ADMIN,
    pages: [
      {
        id: "invoices",
        label: "Invoices",
        href: "/dashboard/invoices",
        from: ["/dashboard/invoices"],
      },
      {
        // From the Payment model + the QuickBooks sync in settings.
        id: "payments",
        label: "Payments",
        href: "/dashboard/payments",
        from: ["/dashboard/settings/quickbooks"],
      },
      {
        // TODO(step 4): one screen filtered by contract type.
        id: "contracts",
        label: "Contracts — sale · RTO · lease",
        href: "/dashboard/sales",
        from: [
          "/dashboard/sales",
          "/dashboard/rent-to-own",
          "/dashboard/leases",
        ],
      },
      {
        // v1 only has the rate-card importer; the list itself is new. Bulk rate
        // updates move here from Assets, where they don't belong.
        id: "rate-cards",
        label: "Rate cards",
        href: "/dashboard/rate-cards",
        from: [
          "/dashboard/settings/import/ratecard",
          "/dashboard/assets/bulk-update",
        ],
      },
      {
        // Subscription product line — kept in Revenue because it bills. The
        // catalogue behind it stays in settings/cloud-products.
        id: "cloud",
        label: "Cloud services",
        href: "/dashboard/cloud",
        from: ["/dashboard/cloud"],
      },
      {
        id: "services",
        label: "Services",
        href: "/dashboard/services",
        from: ["/dashboard/services"],
      },
      {
        id: "purchase-orders",
        label: "Purchase orders",
        href: "/dashboard/purchase-orders",
        from: ["/dashboard/purchase-orders"],
      },
    ],
  },
  {
    id: "clients",
    code: "CL",
    label: "Clients",
    roles: ALL_ADMIN,
    pages: [
      {
        id: "accounts",
        label: "Accounts",
        href: "/dashboard/clients",
        from: ["/dashboard/clients"],
      },
      {
        id: "leads",
        label: "Leads",
        href: "/dashboard/leads",
        from: ["/dashboard/leads"],
      },
      {
        // Reservations filtered to QUOTE_SENT. The public portal stays at
        // /quote/[token] and is not part of this rail.
        id: "quotes",
        label: "Quotes",
        href: "/dashboard/quotes",
        from: ["/dashboard/reservations"],
      },
    ],
  },
  {
    id: "insight",
    code: "IQ",
    label: "Insight",
    roles: [...ALL_ADMIN, "VIEWER"],
    pages: [
      {
        id: "overview",
        label: "Overview",
        href: "/dashboard",
        exact: true,
        from: ["/dashboard"],
      },
      {
        id: "reports",
        label: "Reports",
        href: "/dashboard/reports",
        from: ["/dashboard/reports"],
      },
      {
        id: "insights",
        label: "Insights",
        href: "/dashboard/insights",
        from: ["/dashboard/insights"],
      },
      {
        id: "nowbot",
        label: "Nowbot",
        href: "/dashboard/nowbot",
        from: ["/dashboard/nowbot"],
      },
    ],
  },
];

/**
 * Pinned at the bottom of the rail rather than living in a cluster. Its 14
 * children come across unchanged — the QuickBooks integration under
 * settings/quickbooks is demoed against the QB sandbox, so that area stays put.
 *
 * Dropped from v2 by product decision, not oversight:
 * - `/dashboard/builder` — the workstation quote builder.
 * - `/dashboard/flow` — the FLOW_USER task area; a separate app area that must
 *   never appear in this rail.
 * - `/dashboard/marketing/*` — campaigns, tactics and ad spend. A notification
 *   system takes its place.
 *
 * Also note `/dashboard/settings/vendors` is a byte-for-byte duplicate of
 * `/dashboard/vendors` in v1 (only the back-link differs); v2 has the one
 * screen, under Inventory.
 */
export const SETTINGS_PAGE: NavPage = {
  id: "settings",
  label: "Settings",
  href: "/dashboard/settings",
  from: ["/dashboard/settings"],
};

export function clustersForRole(role: Role): NavCluster[] {
  return NAV_CLUSTERS.filter((cluster) => cluster.roles.includes(role));
}

export type NavMatch = { cluster: NavCluster; page: NavPage };

/**
 * The cluster and page owning a pathname. Record routes (`/dashboard/assets/42`)
 * match their list screen, and the longest href wins so a nested route isn't
 * swallowed by a shorter sibling.
 */
export function findNavPage(pathname: string): NavMatch | null {
  let match: NavMatch | null = null;

  for (const cluster of NAV_CLUSTERS) {
    for (const page of cluster.pages) {
      const owns = page.exact
        ? pathname === page.href
        : pathname === page.href || pathname.startsWith(`${page.href}/`);
      if (owns && (!match || page.href.length > match.page.href.length)) {
        match = { cluster, page };
      }
    }
  }

  return match;
}

/** Every destination the rail can reach, for the command palette. */
export function navDestinations(role: Role): NavMatch[] {
  return clustersForRole(role).flatMap((cluster) =>
    cluster.pages.map((page) => ({ cluster, page })),
  );
}
