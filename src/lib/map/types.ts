/**
 * Inventory → Map: the shapes the server query hands the map screen.
 *
 * Prisma-free so the client components can import them. docs/inventory-map.md.
 *
 * Two layers that never mix (owner, 2026-09-26): **inventory** is hardware at a
 * real delivery address or its stock location — never a client's address
 * standing in for one — and **clients** is each client at its own address.
 */

export const MAP_LAYERS = ["inventory", "clients"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Now = units out + stock. Reach = completed orders and sales. Never mixed. */
export const MAP_MODES = ["now", "reach"] as const;
export type MapMode = (typeof MAP_MODES)[number];

/**
 * What colours a point. The five order types, plus STOCK for units on a
 * shelf, plus the two client states on the Clients layer.
 */
export const MAP_KINDS = [
  "RENTAL",
  "SALE",
  "RENT_TO_OWN",
  "FLOW",
  "CLOUD",
  "STOCK",
  "CLIENT_ACTIVE",
  "CLIENT_IDLE",
] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export const MAP_KIND_LABEL: Record<MapKind, string> = {
  RENTAL: "Rental",
  SALE: "Sale",
  RENT_TO_OWN: "Rent-to-own",
  FLOW: "Flow",
  CLOUD: "Cloud",
  STOCK: "In stock",
  CLIENT_ACTIVE: "Active order",
  CLIENT_IDLE: "No active order",
};

export type GeoPrecision = "POSTAL" | "CITY" | "MANUAL";

/** A resolved coordinate for one address. */
export type GeoPoint = {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
};

/**
 * One row that belongs on the map — an order's units at its delivery address, a
 * location's stock, a client. `weight` is units (inventory) or orders (clients).
 */
export type MapItem = {
  id: string;
  kind: MapKind;
  /** "RES-2026-00123", a location name, a client name. */
  title: string;
  /** The client, "12 units", the status… */
  subtitle: string;
  href: string;
  weight: number;
  /** The raw address text it was placed from. */
  address: string;
};

/** Everything at one coordinate, aggregated. */
export type MapPlace = {
  id: string;
  lat: number;
  lng: number;
  /** "Burbank, CA 91502". */
  label: string;
  precision: GeoPrecision;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  /** Sum of the items' weights. */
  weight: number;
  /** The kind carrying the most weight here — the point's colour. */
  kind: MapKind;
  items: MapItem[];
};

export type UnplacedReason =
  | "NO_ADDRESS"
  | "TBD"
  | "NOT_FOUND"
  | "NOT_GEOCODED";

export const UNPLACED_REASON_LABEL: Record<UnplacedReason, string> = {
  NO_ADDRESS: "No address",
  TBD: "Address is TBD",
  NOT_FOUND: "Address could not be located",
  NOT_GEOCODED: "Not geocoded yet",
};

export type UnplacedRow = {
  id: string;
  kind: MapKind;
  title: string;
  subtitle: string;
  /** The record to open to fix the address. */
  href: string;
  weight: number;
  reason: UnplacedReason;
  address: string | null;
};

export type ReachRow = {
  key: string;
  label: string;
  /** Orders (inventory) or clients (clients layer). */
  records: number;
  /** Units (inventory) or orders (clients layer). */
  weight: number;
};

export type Coverage = {
  placed: number;
  total: number;
  /** "units out", "units", "orders", "clients". */
  noun: string;
  /** The sentence the screen always shows. */
  text: string;
};

export type MapFilters = {
  layer: MapLayer;
  mode: MapMode;
  /** An order type, or null for all. */
  type: string | null;
  /** An order status, or null for all. */
  status: string | null;
  clientId: string | null;
  /** ISO dates (yyyy-mm-dd), inclusive, against the order's window. */
  from: string | null;
  to: string | null;
};

export type MapPointProps = {
  placeId: string;
  weight: number;
  kind: MapKind;
  label: string;
};

export type MapFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: MapPointProps;
  }[];
};

export type MapData = {
  filters: MapFilters;
  /** "units" or "orders" — what `weight` counts on this layer. */
  weightNoun: string;
  /** "orders" or "clients" — what `records` counts in the reach strip. */
  recordNoun: string;
  places: MapPlace[];
  geojson: MapFeatureCollection;
  unplaced: UnplacedRow[];
  coverage: Coverage;
  reach: { countries: ReachRow[]; regions: ReachRow[]; cities: ReachRow[] };
  options: {
    clients: { id: string; name: string }[];
    types: { value: string; label: string }[];
    statuses: { value: string; label: string }[];
  };
};
