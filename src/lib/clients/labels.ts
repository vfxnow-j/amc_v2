import type { LeadSource, LeadStatus } from "@/generated/prisma/client";

/** The Clients cluster's vocabulary. Prisma-free, for the client-side strips. */

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROSPECT: "Quoted",
  BOUND: "Bound",
  UNQUALIFIED: "Unqualified",
  WON: "Won",
  LOST: "Lost",
};

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  JUSTCALL: "JustCall",
  HUBSPOT: "HubSpot",
  WEBSITE: "Website",
  REFERRAL: "Referral",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  EMAIL: "Email",
  DIRECT: "Direct",
  AD: "Ad",
  OTHER: "Other",
};

/**
 * Lead sub-views.
 *
 * `BOUND` sits under Converted rather than Won because it is neither: it means
 * the lead turned out to be a second contact on an account that already exists,
 * so the enquiry resolved without being new business. Filing it as Won would
 * overstate the win rate; filing it as Lost would understate it.
 */
export const LEAD_VIEWS = ["new", "working", "converted", "lost", "all"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const LEAD_VIEW_LABEL: Record<LeadView, string> = {
  new: "New",
  working: "Working",
  converted: "Converted",
  lost: "Lost",
  all: "All",
};

export function isLeadView(value: unknown): value is LeadView {
  return LEAD_VIEWS.includes(value as LeadView);
}

export const LEAD_VIEW_STATUS: Record<LeadView, LeadStatus[] | null> = {
  new: ["NEW"],
  working: ["CONTACTED", "QUALIFIED", "PROSPECT"],
  converted: ["WON", "BOUND"],
  lost: ["LOST", "UNQUALIFIED"],
  all: null,
};
