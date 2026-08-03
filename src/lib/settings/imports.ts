/**
 * What each spreadsheet import expects to find in the file.
 *
 * These column names are not a convention somebody chose — they are the export
 * headers of the asset system this data came out of, matched literally in
 * `lib/actions/import.ts`. A sheet whose header row has been tidied up by hand
 * parses to nothing, and the failure looks like an empty file rather than a
 * naming mismatch, so the screens name the columns up front.
 *
 * A plain module: `lib/actions/import.ts` is `"use server"` and may only export
 * async functions.
 */

export type ImportKind = {
  id: string;
  label: string;
  href: string;
  /** What it does to the database, in one line. */
  blurb: string;
  /** The headers it matches, in the order they matter. */
  columns: string[];
  /** The header row is required — one of these must be present. */
  key: string;
};

export const IMPORT_KINDS: ImportKind[] = [
  {
    id: "assets",
    label: "Assets",
    href: "/dashboard/settings/import/assets",
    blurb:
      "Loads hardware into inventory, and can create the categories, locations, vendors and clients the sheet mentions along the way.",
    key: "Asset - Asset Identification Number",
    columns: [
      "Asset - Asset Identification Number",
      "Asset - Asset#",
      "Asset - Name",
      "Asset - Description",
      "Asset - Group",
      "Asset - Subgroup",
      "Asset - State",
      "Asset - Location",
      "Asset - Vendor",
      "Asset - Cost Price ($)",
      "Asset - Purchased On",
      "Asset - Custody (Full Name)",
    ],
  },
  {
    id: "ratecard",
    label: "Rate card",
    href: "/dashboard/settings/import/ratecard",
    blurb:
      "Repoints monthly rental rates and sale prices on assets that already exist, matched by name. Creates nothing.",
    key: "Asset - Name",
    columns: [
      "Asset - Name",
      "Asset - Description",
      "Group - Name",
      "Rental Price - Monthly Rent",
      "Asset - Sale Price",
    ],
  },
  {
    id: "retired",
    label: "Retirements",
    href: "/dashboard/settings/import/retired",
    blurb:
      "Takes units out of the fleet and records when and why. Optionally files hardware this database never held, already retired.",
    key: "Asset Identification Number",
    columns: [
      "Asset Identification Number",
      "Asset#",
      "Name",
      "Model",
      "Serial Number",
      "Group",
      "Sub Group",
      "Location",
      "Vendor",
      "Cost Price ($)",
      "Purchased On",
      "Salvage Value ($)",
      "Straight Line Depreciation Useful Life (Months)",
      "Retired On",
      "Reason",
      "Comments",
    ],
  },
];

export function importKind(id: string): ImportKind | undefined {
  return IMPORT_KINDS.find((kind) => kind.id === id);
}
