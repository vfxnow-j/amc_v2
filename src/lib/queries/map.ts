import "server-only";
import type { Prisma, ReservationStatus, ReservationType } from "@/generated/prisma/client";
import { geocodesFor } from "@/lib/geo/geocode-db";
import {
  coverageText,
  placeCandidates,
  plural,
  reachFrom,
  toGeoJSON,
  type Candidate,
} from "@/lib/map/aggregate";
import {
  MAP_LAYERS,
  MAP_MODES,
  type MapData,
  type MapFilters,
  type MapKind,
  type UnplacedRow,
} from "@/lib/map/types";
import { ORDER_TYPES } from "@/lib/orders/types";
import { prisma } from "@/lib/prisma";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";

/**
 * Inventory → Map. docs/inventory-map.md.
 *
 * Where hardware is (owner, 2026-09-26): out on an ACTIVE checkout → its
 * order's delivery address, and nothing else — a client's own address never
 * stands in for it. On a shelf (available / reserved / maintenance) → its
 * location. Everything else is Unplaced and counted in the coverage line.
 *
 * The Clients layer is separate and never mixes: each client at its own address
 * (else its billing address), to see the client base and the regions it covers.
 */

const ORDER_STATUSES = Object.keys(STATUS_LABEL) as ReservationStatus[];
const STOCK_STATUSES = ["AVAILABLE", "RESERVED", "MAINTENANCE"] as const;

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || null;
const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** URL search params → filters, with anything unrecognised dropped. */
export function parseMapFilters(params: Params): MapFilters {
  const layer = first(params.layer);
  const mode = first(params.mode);
  const type = first(params.type);
  const status = first(params.status);
  return {
    layer: MAP_LAYERS.includes(layer as never) ? (layer as MapFilters["layer"]) : "inventory",
    mode: MAP_MODES.includes(mode as never) ? (mode as MapFilters["mode"]) : "now",
    type: type && (type === "STOCK" || ORDER_TYPES.includes(type as ReservationType)) ? type : null,
    status: status && ORDER_STATUSES.includes(status as ReservationStatus) ? status : null,
    clientId: first(params.client),
    from: isDate(first(params.from)),
    to: isDate(first(params.to)),
  };
}

/** The order-level filters, as a Prisma where on Reservation. */
function orderWhere(f: MapFilters): Prisma.ReservationWhereInput {
  const where: Prisma.ReservationWhereInput = {};
  if (f.type && f.type !== "STOCK") where.reservationType = f.type as ReservationType;
  if (f.status) where.status = f.status as ReservationStatus;
  if (f.clientId) where.clientId = f.clientId;
  // The order's window overlaps the range.
  if (f.to) where.startDate = { lte: new Date(`${f.to}T23:59:59.999Z`) };
  if (f.from) where.endDate = { gte: new Date(`${f.from}T00:00:00.000Z`) };
  return where;
}

const clientName = (c: { name: string; companyName: string | null }) =>
  c.companyName?.trim() || c.name;

export async function getMapData(filters: MapFilters): Promise<MapData> {
  const [body, clients] = await Promise.all([
    filters.layer === "clients"
      ? clientsLayer(filters)
      : filters.mode === "reach"
        ? reachLayer(filters)
        : nowLayer(filters),
    prisma.client.findMany({
      where: { reservations: { some: {} } },
      select: { id: true, name: true, companyName: true },
    }),
  ]);

  const types = ORDER_TYPES.map((t) => ({ value: t as string, label: TYPE_LABEL[t] }));
  if (filters.layer === "inventory" && filters.mode === "now") {
    types.push({ value: "STOCK", label: "In stock" });
  }

  return {
    filters,
    ...body,
    geojson: toGeoJSON(body.places),
    reach: reachFrom(body.places),
    options: {
      clients: clients
        .map((c) => ({ id: c.id, name: clientName(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      types,
      statuses: ORDER_STATUSES.map((s) => ({ value: s as string, label: STATUS_LABEL[s] })),
    },
  };
}

type LayerBody = Pick<MapData, "weightNoun" | "recordNoun" | "places" | "unplaced" | "coverage">;

/** Now: units out on ACTIVE checkouts at their order's delivery address, plus stock. */
async function nowLayer(f: MapFilters): Promise<LayerBody> {
  const wantOrders = f.type !== "STOCK";
  // Stock has no order, client, status or window — any of those filters means
  // the question is about orders.
  const wantStock = (!f.type || f.type === "STOCK") && !f.status && !f.clientId && !f.from && !f.to;
  // Units out with no order behind them only belong to the unfiltered question.
  const unfiltered = !f.type && !f.status && !f.clientId && !f.from && !f.to;

  const [checkouts, current, outNoCheckout, stock] = await Promise.all([
    wantOrders
      ? prisma.checkout.findMany({
          where: {
            status: "ACTIVE",
            reservation: orderWhere(f),
          },
          select: {
            id: true,
            reservation: {
              select: {
                id: true,
                reservationNumber: true,
                reservationType: true,
                status: true,
                deliveryAddress: true,
                client: { select: { name: true, companyName: true } },
              },
            },
          },
        })
      : [],
    // A unit can carry two ACTIVE checkouts (v1 left a few un-returned when
    // the unit went out again). It is out once, on its latest checkout.
    wantOrders
      ? prisma.checkout.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, assetUnitId: true },
          orderBy: [{ checkoutDate: "desc" }, { id: "desc" }],
        })
      : [],
    // Out by its status but with no ACTIVE checkout: out somewhere nobody
    // recorded. Counted, never placed.
    wantOrders && unfiltered
      ? prisma.assetUnit.count({
          where: { status: "CHECKED_OUT", checkouts: { none: { status: "ACTIVE" } } },
        })
      : 0,
    wantStock
      ? prisma.assetUnit.groupBy({
          by: ["locationId"],
          where: { status: { in: [...STOCK_STATUSES] } },
          _count: { _all: true },
        })
      : [],
  ]);

  const latest = new Set<string>();
  const seenUnit = new Set<string>();
  for (const c of current) {
    if (seenUnit.has(c.assetUnitId)) continue;
    seenUnit.add(c.assetUnitId);
    latest.add(c.id);
  }

  // Units out, per order.
  const orders = new Map<string, Candidate>();
  let noOrder = outNoCheckout;
  for (const c of checkouts) {
    if (!latest.has(c.id)) continue;
    const r = c.reservation;
    if (!r) {
      noOrder += 1;
      continue;
    }
    const row = orders.get(r.id);
    if (row) row.weight += 1;
    else {
      orders.set(r.id, {
        id: r.id,
        kind: r.reservationType as MapKind,
        title: r.reservationNumber,
        subtitle: `${clientName(r.client)} · ${STATUS_LABEL[r.status]}`,
        href: `/dashboard/orders/${r.id}`,
        weight: 1,
        address: r.deliveryAddress,
      });
    }
  }

  const unplacedExtra: UnplacedRow[] = [];

  // Stock, per location.
  const locationIds = stock.map((s) => s.locationId).filter((id): id is string => !!id);
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true, address: true },
  });
  const locById = new Map(locations.map((l) => [l.id, l]));
  const stockRows: Candidate[] = [];
  let stockNoLocation = 0;
  for (const s of stock) {
    const loc = s.locationId ? locById.get(s.locationId) : undefined;
    if (!loc) {
      stockNoLocation += s._count._all;
      continue;
    }
    stockRows.push({
      id: `loc:${loc.id}`,
      kind: "STOCK",
      title: loc.name,
      subtitle: `${plural(s._count._all, "unit")} in stock`,
      href: `/dashboard/locations/${loc.id}`,
      weight: s._count._all,
      address: loc.address,
    });
  }

  const outRows = [...orders.values()];
  if (noOrder > 0) {
    unplacedExtra.push({
      id: "out:no-order",
      kind: "RENTAL",
      title: "Out with no order",
      subtitle: `${plural(noOrder, "unit")} out with no order behind them`,
      href: "/dashboard/units?view=out",
      weight: noOrder,
      reason: "NO_ADDRESS",
      address: null,
    });
  }
  const geo = await geocodesFor(prisma, [...outRows, ...stockRows].map((r) => r.address));
  const out = placeCandidates(outRows, geo);
  const shelf = placeCandidates(stockRows, geo);

  const unplaced: UnplacedRow[] = [...out.unplaced, ...unplacedExtra, ...shelf.unplaced];
  if (stockNoLocation > 0) {
    unplaced.push({
      id: "stock:no-location",
      kind: "STOCK",
      title: "Stock with no location",
      subtitle: `${plural(stockNoLocation, "unit")} on the shelf with no location set`,
      href: "/dashboard/units?view=available",
      weight: stockNoLocation,
      reason: "NO_ADDRESS",
      address: null,
    });
  }

  const outTotal = outRows.reduce((s, r) => s + r.weight, 0) + noOrder;
  const outPlaced = out.places.reduce((s, p) => s + p.weight, 0);
  const stockPlaced = shelf.places.reduce((s, p) => s + p.weight, 0);
  const stockTotal = stockRows.reduce((s, r) => s + r.weight, 0) + stockNoLocation;

  let text = wantOrders
    ? coverageText({
        placed: outPlaced,
        total: outTotal,
        noun: "units out",
        unplaced: out.unplaced,
        addressNoun: "delivery address",
      })
    : `Showing ${stockPlaced.toLocaleString("en-US")} of ${stockTotal.toLocaleString("en-US")} units in stock at their locations.`;
  if (noOrder > 0) text = text.replace(/\.$/, `, ${noOrder} aren't on an order.`);
  if (wantStock && wantOrders) {
    text += ` Plus ${stockPlaced.toLocaleString("en-US")} of ${stockTotal.toLocaleString("en-US")} units in stock at their locations.`;
  }

  return {
    weightNoun: "units",
    recordNoun: "orders",
    places: mergePlaces(out.places, shelf.places),
    unplaced,
    coverage: {
      placed: wantOrders ? outPlaced : stockPlaced,
      total: wantOrders ? outTotal : stockTotal,
      noun: wantOrders ? "units out" : "units in stock",
      text,
    },
  };
}

/** Reach: completed orders at their delivery address, with the units that went out on them. */
async function reachLayer(f: MapFilters): Promise<LayerBody> {
  const where = orderWhere(f);
  // Reach is completed work. A status filter narrows within it rather than
  // reaching past it.
  if (!f.status) where.status = "COMPLETED";
  else if (f.status !== "COMPLETED") where.id = "__none__";

  const orders = await prisma.reservation.findMany({
    where,
    select: {
      id: true,
      reservationNumber: true,
      reservationType: true,
      deliveryAddress: true,
      completedAt: true,
      client: { select: { name: true, companyName: true } },
      checkouts: { where: { status: { not: "CANCELLED" } }, select: { assetUnitId: true } },
    },
  });
  const sold = await prisma.assetUnit.findMany({
    where: { soldViaReservation: { in: orders.map((o) => o.id) } },
    select: { id: true, soldViaReservation: true },
  });
  const soldBy = new Map<string, string[]>();
  for (const u of sold) {
    const list = soldBy.get(u.soldViaReservation!) ?? [];
    list.push(u.id);
    soldBy.set(u.soldViaReservation!, list);
  }

  const rows: Candidate[] = orders.map((o) => {
    const units = new Set([...o.checkouts.map((c) => c.assetUnitId), ...(soldBy.get(o.id) ?? [])]);
    return {
      id: o.id,
      kind: o.reservationType as MapKind,
      title: o.reservationNumber,
      subtitle: `${clientName(o.client)} · ${plural(units.size, "unit")}`,
      href: `/dashboard/orders/${o.id}`,
      weight: units.size,
      address: o.deliveryAddress,
    };
  });

  const geo = await geocodesFor(prisma, rows.map((r) => r.address));
  const { places, unplaced } = placeCandidates(rows, geo);
  const placedOrders = places.reduce((s, p) => s + p.items.length, 0);
  // Coverage is counted in orders here — a completed order with no units
  // recorded still went somewhere.
  const byOrder = unplaced.map((u) => ({ ...u, weight: 1 }));
  const soldUnlinked = f.type || f.status || f.clientId || f.from || f.to
    ? 0
    : await prisma.assetUnit.count({ where: { status: "SOLD", soldViaReservation: null } });

  let text = coverageText({
    placed: placedOrders,
    total: rows.length,
    noun: "completed orders",
    unplaced: byOrder,
    addressNoun: "delivery address",
  });
  if (soldUnlinked > 0) {
    text += ` ${soldUnlinked.toLocaleString("en-US")} sold units aren't linked to an order, so they can't be placed.`;
  }

  return {
    weightNoun: "units",
    recordNoun: "orders",
    places,
    unplaced,
    coverage: { placed: placedOrders, total: rows.length, noun: "completed orders", text },
  };
}

/**
 * Clients: each client with a real order, at its own address (else billing).
 * "Real" is a quote that was sent or anything after it — a DRAFT nobody sent is
 * not a client relationship, so it doesn't put a client on the map or count
 * toward its size.
 */
async function clientsLayer(f: MapFilters): Promise<LayerBody> {
  const where = orderWhere(f);
  if (!f.status) where.status = { not: "DRAFT" };
  else if (f.status === "DRAFT") where.id = "__none__";
  const clients = await prisma.client.findMany({
    where: {
      ...(f.clientId ? { id: f.clientId } : {}),
      reservations: { some: where },
    },
    select: {
      id: true,
      name: true,
      companyName: true,
      address: true,
      billingAddress: true,
      reservations: { where, select: { status: true } },
    },
  });

  const rows: Candidate[] = clients.map((c) => {
    const active = c.reservations.some((r) => r.status === "ACTIVE");
    const address = c.address?.trim() ? c.address : c.billingAddress;
    return {
      id: c.id,
      kind: active ? "CLIENT_ACTIVE" : "CLIENT_IDLE",
      title: clientName(c),
      subtitle: `${plural(c.reservations.length, "order")}${active ? " · active order" : ""}`,
      href: `/dashboard/clients/${c.id}`,
      weight: c.reservations.length,
      address,
    };
  });

  const geo = await geocodesFor(prisma, rows.map((r) => r.address));
  const { places, unplaced } = placeCandidates(rows, geo);
  const placed = places.reduce((s, p) => s + p.items.length, 0);

  return {
    weightNoun: "orders",
    recordNoun: "clients",
    places,
    unplaced,
    coverage: {
      placed,
      total: rows.length,
      noun: "clients",
      text: coverageText({
        placed,
        total: rows.length,
        noun: "clients with a sent quote or order",
        unplaced: unplaced.map((u) => ({ ...u, weight: 1 })),
        addressNoun: "address",
      }),
    },
  };
}

/** Orders and stock at one coordinate share a point. */
function mergePlaces(a: MapData["places"], b: MapData["places"]): MapData["places"] {
  const byId = new Map(a.map((p) => [p.id, { ...p, items: [...p.items] }]));
  for (const p of b) {
    const hit = byId.get(p.id);
    if (!hit) byId.set(p.id, p);
    else {
      hit.items.push(...p.items);
      hit.weight += p.weight;
      // Out-with-client wins the colour over a shelf at the same point.
    }
  }
  return [...byId.values()].sort((x, y) => y.weight - x.weight);
}
