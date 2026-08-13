import type { AssetStatus } from "@/generated/prisma/client";
import { oneOf } from "@/lib/guards";

/**
 * Display names for the inventory enums.
 *
 * Prisma-free on purpose — the filter strips are client components, and a client
 * import that reaches `lib/prisma` drags the pg driver into the browser bundle
 * and fails the build on `dns`. The `where` clauses live in
 * `lib/queries/inventory.ts`; only the vocabulary lives here.
 */

export const UNIT_STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: "Available",
  CHECKED_OUT: "Out",
  MAINTENANCE: "Service",
  RESERVED: "Reserved",
  RETIRED: "Retired",
  SOLD: "Sold",
};

/** Asset list sub-views. `retired` was a sibling route in v1; here it's a tab. */
export const ASSET_VIEWS = ["active", "retired", "all"] as const;
export type AssetView = (typeof ASSET_VIEWS)[number];

export const ASSET_VIEW_LABEL: Record<AssetView, string> = {
  active: "Active",
  retired: "Retired",
  all: "All",
};

export const isAssetView = oneOf(ASSET_VIEWS);

/** Unit list sub-views. "In fleet" is the working default, not "all". */
export const UNIT_VIEWS = [
  "in-fleet",
  "available",
  "out",
  "service",
  "gone",
  "all",
] as const;
export type UnitView = (typeof UNIT_VIEWS)[number];

export const UNIT_VIEW_LABEL: Record<UnitView, string> = {
  "in-fleet": "In fleet",
  available: "Available",
  out: "Out",
  service: "Service",
  gone: "Retired & sold",
  all: "All",
};

export const isUnitView = oneOf(UNIT_VIEWS);

/** Audits & scan lists is one screen with two tabs — the Stage 3 merge. */
export const AUDIT_TABS = ["audits", "scan-lists"] as const;
export type AuditTab = (typeof AUDIT_TABS)[number];

export const AUDIT_TAB_LABEL: Record<AuditTab, string> = {
  audits: "Audits",
  "scan-lists": "Scan lists",
};

export const isAuditTab = oneOf(AUDIT_TABS);
