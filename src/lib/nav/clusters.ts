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
  | "accounting"
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
        // Absorbs Revenue's sales and rent-to-own tabs. All four kinds of order
        // are `Reservation` rows carrying a `reservationType`; splitting them
        // across screens meant one client's rental and their sale lived in
        // different places and the same order had two records. One list, a type
        // column and a type filter.
        id: "orders",
        label: "Orders",
        href: "/dashboard/orders",
        from: [
          "/dashboard/reservations",
          "/dashboard/sales",
          "/dashboard/rent-to-own",
        ],
      },
      {
        // Not a second scanner. The owner's call, 2026-07-30: a standalone
        // check-out/check-in desk duplicates the reservation record, which is
        // where the units, the rates and the sign-off already live — v1 came to
        // the same conclusion, and its /dashboard/checkout is a signpost that
        // redirects into the order. So this screen answers "what needs hands
        // today" and every row opens the order, where the scanning happens.
        id: "today",
        label: "Today’s movements",
        href: "/dashboard/today",
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
      {
        // New in v2. Until this screen there was nowhere in the app to change
        // what a model charges: the rates live on `Asset`, the asset record
        // shows them read-only, and `setLineRate` only ever fixed one line of
        // one order. Rate cards move here from Accounting to sit beside them —
        // pricing is a decision the business makes, not a thing the books
        // record.
        id: "pricing",
        label: "Pricing",
        href: "/dashboard/pricing",
        from: [
          "/dashboard/settings/import/ratecard",
          "/dashboard/assets/bulk-update",
          "/dashboard/cloud",
        ],
      },
      {
        id: "services",
        label: "Services",
        href: "/dashboard/services",
        from: ["/dashboard/services"],
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
    // Renamed from Revenue, 2026-09-09. "Revenue" named what comes in, but the
    // cluster has always held both directions — purchase orders and leases are
    // money going out. Accounting is what the screens actually are.
    id: "accounting",
    code: "AC",
    label: "Accounting",
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
        // What is left of Contracts once sales and rent-to-own go to Orders,
        // where they belong. A lease is money owed to a *lender* for hardware
        // the business bought — no client, no lines, no window — so it was
        // never the same kind of thing, and folding it into Orders would have
        // meant a row with four empty columns.
        id: "leases",
        label: "Leases",
        href: "/dashboard/leases",
        from: ["/dashboard/leases"],
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
        // Orders filtered to QUOTE_SENT. The public portal stays at
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
      // Overview is not here any more: it is pinned at the top of the rail as
      // Dashboard (see DASHBOARD_PAGE below), because the whole-business read
      // is the thing you want from anywhere, not a page inside one cluster.
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
      // v1's AI assistant is not here. It is dropped in v2 along with
      // lib/llm and the chat models, and its route 404s by design.
    ],
  },
];

/**
 * Pinned at the *top* of the rail, above the six clusters.
 *
 * It used to be Insight → Overview, four clicks deep inside a cluster that also
 * holds Reports and Insights. That is the wrong shape for the one screen whose
 * job is the whole business at once: you want it from wherever you are, not
 * after opening the cluster you happen not to be in. It keeps the `/dashboard`
 * URL it always had, so nothing that links to it has to change.
 *
 * `exact` matters here more than anywhere: every screen in the app lives under
 * /dashboard, so without it this row would claim to be active on all of them.
 */
export const DASHBOARD_PAGE: NavPage = {
  id: "dashboard",
  label: "Dashboard",
  href: "/dashboard",
  exact: true,
  from: ["/dashboard"],
};

/**
 * Pinned at the bottom of the rail rather than living in a cluster. Its 14
 * children come across unchanged — the QuickBooks integration under
 * settings/quickbooks is demoed against the QB sandbox, so that area stays put.
 *
 * Dropped from v2 by product decision, not oversight:
 * - v1's AI assistant route — dropped along with lib/llm.
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

/**
 * A pinned row belongs to no cluster, so `cluster` is null for Dashboard and
 * Settings. Callers that color by cluster fall back rather than inventing one.
 */
export type NavMatch = { cluster: NavCluster | null; page: NavPage };

function owns(page: NavPage, pathname: string): boolean {
  return page.exact
    ? pathname === page.href
    : pathname === page.href || pathname.startsWith(`${page.href}/`);
}

/**
 * The cluster and page owning a pathname. Record routes (`/dashboard/orders/42`)
 * match their list screen, and the longest href wins so a nested route isn't
 * swallowed by a shorter sibling.
 *
 * The pinned rows are checked alongside the clusters. Dashboard is `exact`, so
 * it only ever claims `/dashboard` itself; Settings is not, so it claims its
 * fourteen children — and the longest-href rule keeps a cluster page that
 * happens to sit deeper from being stolen by either.
 */
export function findNavPage(pathname: string): NavMatch | null {
  let match: NavMatch | null = null;

  const consider = (page: NavPage, cluster: NavCluster | null) => {
    if (owns(page, pathname) && (!match || page.href.length > match.page.href.length)) {
      match = { cluster, page };
    }
  };

  for (const cluster of NAV_CLUSTERS) {
    for (const page of cluster.pages) consider(page, cluster);
  }
  consider(DASHBOARD_PAGE, null);
  consider(SETTINGS_PAGE, null);

  return match;
}

/**
 * Every destination the rail can reach, for the command palette.
 *
 * Dashboard leads, because it is the one destination that is not part of any
 * cluster and is the most likely thing somebody opening the palette wants.
 */
export function navDestinations(role: Role): NavMatch[] {
  return [
    { cluster: null, page: DASHBOARD_PAGE },
    ...clustersForRole(role).flatMap((cluster) =>
      cluster.pages.map((page) => ({ cluster, page })),
    ),
    { cluster: null, page: SETTINGS_PAGE },
  ];
}
