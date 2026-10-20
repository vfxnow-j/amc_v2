import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getBillingAnchor } from "@/lib/settings/business";
import { addDays, businessToday, daysBetween, intendedDay } from "@/lib/billing/calendar";
import {
  cycleInvoice,
  cycleTermsForOrder,
  type CycleLine,
  isChosenOptionItem,
  toCycleLine,
} from "@/lib/billing/cycle-invoice";
import { priceFlowLines } from "@/lib/pricing/flow-lines";
import { storedFlowConfig } from "@/lib/flow/defaults";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import {
  monthKey,
  monthKeys,
  monthStart,
  orderCharges,
  type Charge,
  type MonthKey,
} from "@/lib/forecast/schedule";
import { bookedVersionOf, groupDeals, type ChoiceMode, type Period } from "@/lib/forecast/groups";

/**
 * Accounting → Forecast: every dollar the business has set for the next twelve
 * months, month by month, and when it lands as cash.
 *
 * Three tiers, never mixed: **booked** (approved and live orders — contracted),
 * **in play** (open quotes, one version per deal, weighted by stage) and
 * **leads** (an estimate on a lead with no order yet, weighted by stage). Booked
 * is the business's true floor; the other two are labelled as expectation.
 *
 * Cash is each charge moved by its payment terms (order terms, else the client's,
 * else 30 days; Flow on autopay pays on the day). Charges billed in the last three
 * months whose due date falls in the window are carried in as cash, because
 * nothing in v2 records them as collected yet — the 50 invoices in the database
 * are v1 drafts nobody sent (see docs: billing cutover). Cash out is what is
 * contracted: lease payments and submitted purchase orders.
 */

export const HORIZON_MONTHS = 12;
const HISTORY_MONTHS = 6;
const LOOKBACK_MONTHS = 3;
const STALE_DAYS = 90;

export const BOOKED = ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] as const;
export const IN_PLAY = ["DRAFT", "QUOTE_SENT", "REVISION"] as const;

/** v1's stage weights, as Reports → Forecast uses them, so the two screens agree. */
export const ORDER_WEIGHT: Record<string, number> = { QUOTE_SENT: 0.6, REVISION: 0.4, DRAFT: 0.4 };
export const LEAD_WEIGHT: Record<string, number> = { NEW: 0.1, CONTACTED: 0.25, QUALIFIED: 0.5 };

export type Stream =
  | "rental"
  | "cloud"
  | "rto"
  | "flow"
  | "oneTime"
  | "sale"
  | "playRecurring"
  | "playOnce"
  | "leads";

export const STREAM_LABEL: Record<Stream, string> = {
  rental: "Rental — recurring",
  cloud: "Cloud — recurring",
  rto: "Rent-to-own installments",
  flow: "Flow subscriptions",
  oneTime: "Rental — one-time",
  sale: "Sales",
  playRecurring: "Recurring in quotes",
  playOnce: "Sales & one-time in quotes",
  leads: "Leads",
};

/** What an order is, whatever its stage: the booked stream it is or would be. */
export type Kind = "rental" | "cloud" | "rto" | "flow" | "oneTime" | "sale";
export const KINDS: Kind[] = ["rental", "sale", "oneTime", "cloud", "rto", "flow"];
export const KIND_LABEL: Record<Kind, string> = {
  rental: "Rental",
  sale: "Sale",
  oneTime: "One-time rental",
  cloud: "Cloud",
  rto: "Rent-to-own",
  flow: "Flow",
};

export const BOOKED_STREAMS: Stream[] = ["rental", "cloud", "rto", "flow", "oneTime", "sale"];
export const EXPECTED_STREAMS: Stream[] = ["playRecurring", "playOnce", "leads"];
const RECURRING_STREAMS = new Set<Stream>(["rental", "cloud", "rto", "flow"]);

type Row = Record<MonthKey, number>;

export type ForecastOrder = {
  id: string;
  number: string;
  client: string;
  clientId: string;
  name: string | null;
  type: string;
  status: string;
  stream: Stream;
  kind: Kind;
  /** What one regular month bills, ex-tax; null for a once-billed order. */
  monthly: number | null;
  /** Revenue inside the window, unweighted. */
  inWindow: number;
  /** The same, by the month it is billed. */
  byMonth: Row;
  weight: number;
  term: string;
  /** A committed term or Flow/RTO schedule that runs out inside the window. */
  endsOn: Date | null;
  startShifted: boolean;
  /** In play and untouched for 90 days: shown, not counted, unless you count it. */
  stale: boolean;
  quoteExpired: boolean;
  touched: Date;
  counted: boolean;
  reason: string | null;
  choice: ChoiceMode | null;
  termsDays: number;
  unitsOut: number;
  overdue: { units: number; since: Date } | null;
  /** Monthly value of priced lines on a live order with no unit ever checked out against them. */
  neverOut: number;
};

export type ForecastDeal = { key: string; client: string; orders: ForecastOrder[] };

/** One client's next twelve months: booked, and expected weighted by stage. Leads have no client yet, so aren't here. */
export type ForecastClient = {
  clientId: string;
  client: string;
  booked: Row;
  expected: Row;
  /** 12-month totals by what it is; expected weighted. */
  byKind: Record<Kind, { booked: number; expected: number }>;
  /** Booked orders billing in the window and counted open quotes, biggest first. */
  orders: ForecastOrder[];
};

export type Forecast = {
  months: { key: MonthKey; label: string; short: string }[];
  history: { key: MonthKey; short: string; earned: number }[];
  revenue: Record<Stream, Row>;
  /** Counted open quotes, weighted, split by what they are (revenue.playRecurring + playOnce, re-cut). */
  expectedByKind: Record<Kind, Row>;
  cash: Record<Stream, Row>;
  cashOut: { leases: Row; purchaseOrders: Row; expenses: Row };
  targets: Row;
  booked: ForecastOrder[];
  deals: ForecastDeal[];
  clients: ForecastClient[];
  leads: { id: string; name: string; company: string | null; status: string; value: number; weight: number }[];
  attention: {
    staleBooked: ForecastOrder[];
    notBilled: { id: string; number: string; client: string; total: number }[];
    leasesWithoutTerms: number;
    draftPurchaseOrders: { count: number; total: number };
    noBillableLines: ForecastOrder[];
    /** Marked active with every unit back. */
    nothingOut: ForecastOrder[];
    /** Gear past its return date and still out — counted, rolling month to month. */
    rolling: ForecastOrder[];
    /** Live orders with priced lines nothing was ever checked out against. */
    neverOut: ForecastOrder[];
  };
  carriedIn: number;
  generatedAt: Date;
};

const MONTH_LONG = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const num = (v: unknown) => Number(v ?? 0) || 0;
const emptyRow = (keys: MonthKey[]): Row => Object.fromEntries(keys.map((k) => [k, 0]));

function streamFor(type: string, isRecurring: boolean, booked: boolean, hasTerm: boolean): Stream {
  const recurring =
    type === "FLOW" || (type === "RENT_TO_OWN" && hasTerm) || (isRecurring && (type === "RENTAL" || type === "CLOUD"));
  if (!booked) return recurring ? "playRecurring" : "playOnce";
  if (type === "FLOW") return "flow";
  if (type === "RENT_TO_OWN") return hasTerm ? "rto" : "sale";
  if (type === "SALE") return "sale";
  if (!recurring) return "oneTime";
  return type === "CLOUD" ? "cloud" : "rental";
}

export const getForecast = cache(async (now: Date = new Date()): Promise<Forecast> => {
  const today = businessToday(now);
  const from = monthStart(today);
  const to = monthStart(today, HORIZON_MONTHS);
  const lookback = monthStart(today, -LOOKBACK_MONTHS);
  const keys = monthKeys(from, HORIZON_MONTHS);
  const inWindow = new Set(keys);
  const staleBefore = addDays(today, -STALE_DAYS);

  const [anchor, orders, leads, leases, pos, targets] = await Promise.all([
    getBillingAnchor(),
    prisma.reservation.findMany({
      where: { status: { in: [...BOOKED, ...IN_PLAY] } },
      include: {
        client: { select: { id: true, name: true, companyName: true, paymentTerms: true } },
        items: {
          include: {
            asset: { select: { name: true } },
            package: { select: { isActive: true } },
          },
        },
        checkouts: {
          where: { status: { in: ["ACTIVE", "RETURNED"] } },
          select: { status: true, expectedReturn: true, assetUnit: { select: { assetId: true } } },
        },
        packages: { select: { id: true, isActive: true, deliveryCost: true, returnCost: true } },
        forecastChoice: { select: { mode: true } },
      },
      orderBy: { startDate: "asc" },
    }),
    prisma.lead.findMany({
      where: {
        status: { in: Object.keys(LEAD_WEIGHT) as ("NEW" | "CONTACTED" | "QUALIFIED")[] },
        estimatedValue: { gt: 0 },
        convertedReservationId: null,
        boundToReservationId: null,
      },
      select: { id: true, name: true, companyName: true, status: true, estimatedValue: true },
    }),
    prisma.lease.findMany({
      where: { status: "ACTIVE" },
      select: { monthlyPayment: true, startDate: true, endDate: true, paidOffDate: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["SUBMITTED", "DRAFT"] } },
      select: { status: true, total: true, expectedDate: true, orderDate: true },
    }),
    prisma.setting.findMany({ where: { key: { in: keys.map((k) => `kpi_${k}`) } } }),
  ]);

  const revenue = Object.fromEntries(
    [...BOOKED_STREAMS, ...EXPECTED_STREAMS].map((s) => [s, emptyRow(keys)]),
  ) as Record<Stream, Row>;
  const cash = Object.fromEntries(
    [...BOOKED_STREAMS, ...EXPECTED_STREAMS].map((s) => [s, emptyRow(keys)]),
  ) as Record<Stream, Row>;
  let carriedIn = 0;

  const notBilled: Forecast["attention"]["notBilled"] = [];
  const staleBooked: ForecastOrder[] = [];
  const noBillableLines: ForecastOrder[] = [];
  const nothingOut: ForecastOrder[] = [];
  const booked: ForecastOrder[] = [];
  const bookedVersions: { number: string; clientId: string; name: string | null; assetIds: string[]; period: Period }[] = [];
  const assetIdsOf = (items: { assetId: string | null }[]) =>
    [...new Set(items.map((i) => i.assetId).filter((id): id is string => !!id))];
  const playOrders: (ForecastOrder & { charges: Charge[]; assetIds: string[]; updatedAt: Date; period: Period })[] = [];

  for (const o of orders) {
    const isBooked = (BOOKED as readonly string[]).includes(o.status);
    const clientName = o.client.companyName || o.client.name;
    if (o.notBilled) {
      if (isBooked) notBilled.push({ id: o.id, number: o.reservationNumber, client: clientName, total: num(o.total) });
      continue;
    }

    const items = o.items.filter(isChosenOptionItem);
    const activePackages = o.packages.filter((p) => p.isActive);
    const lines = items.map(toCycleLine);
    const terms = cycleTermsForOrder({ ...o, packages: activePackages });
    const total = num(o.total);
    const tax = num(o.taxAmount);

    let flow: Parameters<typeof orderCharges>[0]["order"]["flow"] = null;
    if (o.reservationType === "FLOW") {
      const config = storedFlowConfig(o);
      if (config) {
        const priced = priceFlowLines(
          items
            .filter((i) => !i.parentId)
            .map((i) => ({ name: i.description, costBasis: i.costBasis, trueCost: i.trueCost, quantity: i.quantity, addedAtMonth: i.flowAddedAtMonth })),
          config,
        );
        flow = {
          months: config.termMonths,
          start: o.flowStartDate ?? o.startDate,
          rateForMonth: priced.ok ? priced.result.rateForMonth : () => num(o.flowMonthlyPayment),
        };
      }
    }

    // A quote whose start has passed is assumed to start this month, as quoted,
    // keeping the length it was quoted for.
    const startPassed = o.startDate.getTime() < from.getTime();
    const shift = !isBooked && startPassed;
    const start = shift ? from : o.startDate;
    const shiftDays = shift ? daysBetween(intendedDay(o.startDate), from) : 0;
    const termsDays =
      o.reservationType === "FLOW" && o.flowAutopaySetupAt ? 0 : o.paymentTerms ?? o.client.paymentTerms ?? 30;
    // A cloud order of spec lines and no committed term is a subscription: it bills
    // month to month, not to the end date typed on it.
    const openCloud = o.reservationType === "CLOUD" && !o.termMonths && o.isRecurring && !items.some((i) => i.assetId);
    const order = {
      type: o.reservationType,
      isRecurring: o.isRecurring,
      cycle: o.billingCycleType,
      cycleDays: o.billingCycleDays,
      start,
      termMonths: o.termMonths,
      recurrenceEnd: o.recurrenceEndDate,
      // An order not out yet bills to the day it is due back (its end date), unless it commits to a term.
      plannedEnd: o.termMonths || openCloud ? null : addDays(intendedDay(o.endDate), 1 + shiftDays),
      netTotal: total - tax,
      taxShare: total > 0 ? tax / total : 0,
      rto: {
        months: o.rtoTermMonths,
        payment: o.rtoMonthlyPayment == null ? null : num(o.rtoMonthlyPayment),
        start: shift ? from : o.rtoStartDate,
      },
      flow: flow && shift ? { ...flow, start: from } : flow,
    };
    const chargeArgs = { anchor, from: isBooked ? lookback : from, to, termsDays };

    const rentalRecurring = o.isRecurring && (o.reservationType === "RENTAL" || o.reservationType === "CLOUD");
    const out = o.checkouts.filter((c) => c.status === "ACTIVE");
    const isOut = isBooked && (o.status === "ACTIVE" || o.status === "SHIPPED") && out.length > 0;
    let neverOut = 0;
    let charges: Charge[];
    let regular: number | null = null;
    let unitsOut = 0;
    let overdue = null as { units: number; since: Date } | null;
    let backBy = null as Date | null;

    if (rentalRecurring && isOut) {
      // Gear that has gone out bills for the units still out, each until it is
      // due back. One past its return date and still out rolls month to month.
      // Units are matched to lines by model, not by the line a unit was
      // scanned against: staff often re-price by adding a line, leaving the
      // units on the old $0 one (RES-2026-00009). Each model's units fill its
      // best-paid lines first, the longest-running units first.
      unitsOut = out.length;
      const outByAsset = new Map<string, Date[]>();
      const returnedByAsset = new Map<string, number>();
      for (const c of o.checkouts) {
        if (c.status !== "RETURNED") continue;
        returnedByAsset.set(c.assetUnit.assetId, (returnedByAsset.get(c.assetUnit.assetId) ?? 0) + 1);
      }
      for (const c of out) {
        const assetId = c.assetUnit.assetId;
        outByAsset.set(assetId, [...(outByAsset.get(assetId) ?? []), intendedDay(c.expectedReturn ?? o.endDate)]);
      }
      for (const days of outByAsset.values()) days.sort((x, y) => y.getTime() - x.getTime());
      type Segment = { plannedEnd: Date | null; lines: CycleLine[] };
      const segments = new Map<string, Segment>();
      const segment = (key: string, plannedEnd: Date | null) => {
        if (!segments.has(key)) segments.set(key, { plannedEnd, lines: [] });
        return segments.get(key)!;
      };
      const unpinned: CycleLine[] = [];
      const byRate = [...items].sort((x, y) => num(y.rate) - num(x.rate));
      for (const item of byRate) {
        const line = toCycleLine(item);
        if (!item.assetId) {
          unpinned.push(line);
          continue;
        }
        const pool = outByAsset.get(item.assetId) ?? [];
        const mine = pool.splice(0, Math.max(0, line.quantity));
        // What is neither out nor back never went out: priced, but billing nothing.
        const back = Math.min(returnedByAsset.get(item.assetId) ?? 0, line.quantity - mine.length);
        returnedByAsset.set(item.assetId, (returnedByAsset.get(item.assetId) ?? 0) - back);
        if (!line.includedInParent && !line.isOneTime) neverOut += (line.quantity - mine.length - back) * line.rate;
        const byEnd = new Map<string, { plannedEnd: Date | null; count: number }>();
        for (const day of mine) {
          let key: string;
          let plannedEnd: Date | null;
          if (o.termMonths) {
            key = "term";
            plannedEnd = null;
          } else if (day.getTime() < today.getTime()) {
            key = "rolling";
            plannedEnd = null;
            overdue = { units: (overdue?.units ?? 0) + 1, since: overdue && overdue.since < day ? overdue.since : day };
          } else {
            key = day.toISOString();
            plannedEnd = addDays(day, 1);
            if (!backBy || day > backBy) backBy = day;
          }
          const g = byEnd.get(key) ?? { plannedEnd, count: 0 };
          g.count++;
          byEnd.set(key, g);
        }
        for (const [key, g] of byEnd) segment(key, g.plannedEnd).lines.push({ ...line, quantity: g.count });
      }
      // Lines with no unit behind them (a service, a fee) bill as long as the longest-running gear.
      if (unpinned.length && segments.size) {
        const longest = [...segments.values()].sort(
          (x, y) => (y.plannedEnd?.getTime() ?? Infinity) - (x.plannedEnd?.getTime() ?? Infinity),
        )[0];
        longest.lines.push(...unpinned);
      }
      const noDelivery = { ...terms, deliveryCost: 0, returnCost: 0 };
      charges = [...segments.values()]
        .flatMap((seg, i) =>
          orderCharges({ ...chargeArgs, order: { ...order, plannedEnd: seg.plannedEnd }, lines: seg.lines, terms: i === 0 ? terms : noDelivery }),
        )
        .sort((x, y) => x.billed.getTime() - y.billed.getTime());
      const outLines = [...segments.values()].flatMap((seg) => seg.lines);
      regular = cycleInvoice({ lines: outLines, share: 1, first: false, terms }).taxable;
    } else {
      charges = orderCharges({ ...chargeArgs, order, lines, terms });
    }

    const stream = streamFor(o.reservationType, o.isRecurring, isBooked, (o.rtoTermMonths ?? 0) > 0);
    const windowCharges = charges.filter((c) => inWindow.has(monthKey(c.billed)));
    const recurring = RECURRING_STREAMS.has(stream) || stream === "playRecurring";
    if (recurring && regular === null) {
      regular = rentalRecurring
        ? cycleInvoice({ lines, share: 1, first: false, terms }).taxable
        : charges.filter((c) => monthKey(c.billed) === keys[1]).reduce((sum, c) => sum + c.amount, 0);
    }
    const lastBilled = charges.length ? charges[charges.length - 1].billed : null;
    const termMonths =
      o.reservationType === "FLOW" ? o.flowTermMonths : o.reservationType === "RENT_TO_OWN" ? o.rtoTermMonths : o.termMonths;
    const endsOn = recurring && lastBilled && monthKey(lastBilled) !== keys[keys.length - 1] ? lastBilled : null;
    let term: string;
    if (!recurring) term = o.reservationType === "SALE" ? "sale" : "billed once";
    else if (termMonths) term = `${termMonths} mo${endsOn ? ` · last bill ${DAY.format(endsOn)}` : ""}`;
    else if (rentalRecurring && isOut) {
      const parts: string[] = [];
      if (backBy) parts.push(`back by ${DAY.format(backBy)}`);
      if (overdue) parts.push(`rolling · ${overdue.units} due back ${DAY.format(overdue.since)}`);
      term = parts.join(" · ");
    } else if (rentalRecurring && !openCloud) {
      term = `${DAY.format(intendedDay(start))} – ${DAY.format(addDays(intendedDay(o.endDate), shiftDays))}`;
    } else term = "month to month";

    const row: ForecastOrder = {
      id: o.id,
      number: o.reservationNumber,
      client: clientName,
      clientId: o.clientId,
      name: o.projectName,
      type: o.reservationType,
      status: o.status,
      stream,
      kind: streamFor(o.reservationType, o.isRecurring, true, (o.rtoTermMonths ?? 0) > 0) as Kind,
      monthly: regular,
      inWindow: windowCharges.reduce((s, c) => s + c.amount, 0),
      byMonth: windowCharges.reduce((r, c) => {
        r[monthKey(c.billed)] += c.amount;
        return r;
      }, emptyRow(keys)),
      weight: isBooked ? 1 : ORDER_WEIGHT[o.status] ?? 0.4,
      term,
      endsOn,
      startShifted: shift,
      stale: !isBooked && o.updatedAt.getTime() < staleBefore.getTime(),
      quoteExpired: !isBooked && o.quoteExpiresAt != null && o.quoteExpiresAt.getTime() < today.getTime(),
      touched: o.updatedAt,
      counted: true,
      reason: null,
      choice: (o.forecastChoice?.mode as ChoiceMode) ?? null,
      termsDays,
      unitsOut,
      overdue,
      neverOut,
    };

    if (isBooked) {
      // Marked live, but every unit is back: nothing left to bill. A cloud order
      // made only of spec lines (hosts, environment) has no units to go out, so
      // it bills from its lines and this does not apply.
      const specOnlyCloud = o.reservationType === "CLOUD" && !items.some((i) => i.assetId);
      if (rentalRecurring && !specOnlyCloud && o.status === "ACTIVE" && out.length === 0) {
        nothingOut.push({ ...row, counted: false, reason: "everything is back" });
        continue;
      }
      // Approved but never started, and its date has gone: nobody can say when it bills.
      if (startPassed && (o.status === "APPROVED" || o.status === "PREPARING")) {
        staleBooked.push({ ...row, counted: false, reason: "start date passed before it went out" });
        continue;
      }
      if (recurring && row.inWindow === 0) {
        noBillableLines.push({ ...row, counted: false, reason: "out on a $0 rate" });
        continue;
      }
      for (const c of charges) {
        const rk = monthKey(c.billed);
        const ck = monthKey(c.due);
        if (inWindow.has(rk)) revenue[stream][rk] += c.amount;
        if (inWindow.has(ck)) {
          cash[stream][ck] += c.amount;
          if (!inWindow.has(rk)) carriedIn += c.amount;
        }
      }
      booked.push(row);
      bookedVersions.push({ number: row.number, clientId: row.clientId, name: row.name, assetIds: assetIdsOf(items), period: { start: o.startDate, end: o.endDate } });
    } else {
      playOrders.push({
        ...row,
        charges,
        assetIds: assetIdsOf(items),
        // As quoted, before any shift to this month — a version shares its booked order's dates.
        period: { start: o.startDate, end: o.endDate },
        updatedAt: o.updatedAt,
      });
    }
  }

  const expectedByKind = Object.fromEntries(KINDS.map((k) => [k, emptyRow(keys)])) as Record<Kind, Row>;
  const groups = groupDeals(playOrders.map((p) => ({ ...p, name: p.name })));
  for (const g of groups) {
    for (const o of g.orders) {
      const booking = bookedVersionOf(o, bookedVersions);
      if (!booking || !g.counted.has(o.id)) continue;
      g.counted.delete(o.id);
      g.reasons.set(o.id, `a version of ${booking.number}, already booked`);
    }
  }
  const deals: ForecastDeal[] = groups.map((g) => {
    for (const o of g.orders) {
      o.counted = g.counted.has(o.id);
      o.reason = g.reasons.get(o.id) ?? null;
      if (!o.counted) continue;
      for (const c of o.charges) {
        const rk = monthKey(c.billed);
        const ck = monthKey(c.due);
        if (inWindow.has(rk)) {
          revenue[o.stream][rk] += c.amount * o.weight;
          expectedByKind[o.kind][rk] += c.amount * o.weight;
        }
        if (inWindow.has(ck)) cash[o.stream][ck] += c.amount * o.weight;
      }
    }
    const orders = g.orders.map((o) => {
      const { charges, assetIds, updatedAt, period, ...rest } = o;
      void charges; void assetIds; void updatedAt; void period;
      return rest;
    });
    return { key: orders[0].id, client: orders[0].client, orders };
  });
  const dealValue = (d: ForecastDeal) =>
    d.orders.filter((o) => o.counted).reduce((s, o) => s + o.inWindow * o.weight, 0);
  deals.sort((a, b) => dealValue(b) - dealValue(a) || b.orders.length - a.orders.length);

  // Leads carry no date: spread over the next three months, due a month later.
  const leadRows = leads.map((l) => ({
    id: l.id,
    name: l.name,
    company: l.companyName,
    status: l.status,
    value: num(l.estimatedValue),
    weight: LEAD_WEIGHT[l.status] ?? 0.1,
  }));
  for (const l of leadRows) {
    const share = (l.value * l.weight) / 3;
    for (let i = 0; i < 3; i++) {
      revenue.leads[keys[i]] += share;
      if (keys[i + 1]) cash.leads[keys[i + 1]] += share;
    }
  }

  const leasesRow = emptyRow(keys);
  let leasesWithoutTerms = 0;
  for (const l of leases) {
    const pay = num(l.monthlyPayment);
    if (pay <= 0) {
      leasesWithoutTerms++;
      continue;
    }
    const ends = l.paidOffDate && l.paidOffDate < l.endDate ? l.paidOffDate : l.endDate;
    for (const k of keys) {
      if (k >= monthKey(l.startDate) && k <= monthKey(ends)) leasesRow[k] += pay;
    }
  }

  const poRow = emptyRow(keys);
  let draftPos = 0;
  let draftPosTotal = 0;
  for (const po of pos) {
    if (po.status === "DRAFT") {
      draftPos++;
      draftPosTotal += num(po.total);
      continue;
    }
    const when = po.expectedDate ?? po.orderDate;
    const k = when.getTime() < from.getTime() ? keys[0] : monthKey(when);
    if (inWindow.has(k)) poRow[k] += num(po.total);
  }

  const expenses = emptyRow(keys);
  const targetRow = emptyRow(keys);
  // The monthly targets Reports → Forecast saves (kpi_YYYY-MM): target, expenses, payroll.
  for (const t of targets) {
    const k = t.key.replace("kpi_", "");
    const v = (t.value ?? {}) as Record<string, number>;
    expenses[k] = num(v.expenses) + num(v.payroll);
    targetRow[k] = num(v.revenueTarget);
  }

  const history = await Promise.all(
    Array.from({ length: HISTORY_MONTHS }, (_, i) => {
      const start = monthStart(today, i - HISTORY_MONTHS);
      return getEarnedRevenue(start, monthStart(today, i - HISTORY_MONTHS + 1)).then((e) => ({
        key: monthKey(start),
        short: MONTH_SHORT.format(start),
        earned: e.total,
      }));
    }),
  );

  booked.sort((a, b) => (b.monthly ?? 0) - (a.monthly ?? 0) || b.inWindow - a.inWindow);

  // By client: exactly the orders the totals above count, so the clients add up to them.
  const byClient = new Map<string, ForecastClient>();
  const clientOf = (o: ForecastOrder) => {
    if (!byClient.has(o.clientId)) {
      byClient.set(o.clientId, {
        clientId: o.clientId,
        client: o.client,
        booked: emptyRow(keys),
        expected: emptyRow(keys),
        byKind: Object.fromEntries(KINDS.map((k) => [k, { booked: 0, expected: 0 }])) as ForecastClient["byKind"],
        orders: [],
      });
    }
    return byClient.get(o.clientId)!;
  };
  for (const o of booked) {
    if (o.inWindow === 0) continue;
    const c = clientOf(o);
    for (const k of keys) c.booked[k] += o.byMonth[k];
    c.byKind[o.kind].booked += o.inWindow;
    c.orders.push(o);
  }
  for (const o of deals.flatMap((d) => d.orders)) {
    if (!o.counted || o.inWindow === 0) continue;
    const c = clientOf(o);
    for (const k of keys) c.expected[k] += o.byMonth[k] * o.weight;
    c.byKind[o.kind].expected += o.inWindow * o.weight;
    c.orders.push(o);
  }
  const clientTotal = (c: ForecastClient) => keys.reduce((s, k) => s + c.booked[k] + c.expected[k], 0);
  const clients = [...byClient.values()].sort((a, b) => clientTotal(b) - clientTotal(a));
  for (const c of clients) c.orders.sort((a, b) => b.inWindow * b.weight - a.inWindow * a.weight);

  return {
    months: keys.map((k, i) => {
      const d = monthStart(from, i);
      return { key: k, label: MONTH_LONG.format(d), short: MONTH_SHORT.format(d) };
    }),
    history,
    revenue,
    expectedByKind,
    cash,
    cashOut: { leases: leasesRow, purchaseOrders: poRow, expenses },
    targets: targetRow,
    booked,
    deals,
    clients,
    leads: leadRows.sort((a, b) => b.value * b.weight - a.value * a.weight),
    attention: {
      staleBooked,
      notBilled,
      leasesWithoutTerms,
      draftPurchaseOrders: { count: draftPos, total: draftPosTotal },
      noBillableLines,
      nothingOut,
      rolling: booked.filter((b) => b.overdue),
      neverOut: [...booked, ...noBillableLines].filter((b) => b.neverOut >= 0.5),
    },
    carriedIn,
    generatedAt: now,
  };
});
