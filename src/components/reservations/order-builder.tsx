"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  createOrder,
  lookupAssets,
  lookupClients,
  lookupSubstitutes,
  type DraftLine,
} from "@/lib/actions/order-builder";
import type { AssetAvailability } from "@/lib/queries/order-builder";
import type { ReservationType } from "@/generated/prisma/client";
import { Notice } from "@/components/feedback/notice";
import { createAccount } from "@/lib/actions/accounts";
import { ORDER_TYPES } from "@/lib/orders/types";
import { TYPE_LABEL } from "@/lib/reservations/status";
import {
  addDays,
  businessToday,
  intendedDay,
  parseDateInput,
  toDateInput,
} from "@/lib/billing/calendar";
import { PackagePicks, usePackageSearch } from "@/components/packages/package-picks";
import {
  getFlowBasesForAssets,
  getFlowDefaults,
  type FlowAssetBasis,
} from "@/lib/actions/flow-settings";
import { previewFlowDraftEconomics } from "@/lib/actions/flow-preview";
import type { FlowDraftEconomics } from "@/lib/flow/draft-economics";
import { applyFlowDefaults, type FlowPricingDefaults } from "@/lib/flow/defaults";
import { FLOW_TERMS } from "@/lib/flow/terms";
import { FLOW_KNOB_BOUNDS, type FlowKnobKey } from "@/lib/flow/knob-bounds";
import { addTermMonths } from "@/lib/flow/stored-money";
import {
  flowConfigFromSettings,
  priceFlowLines,
  type FlowPricedLines,
} from "@/lib/pricing/flow-lines";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
/** Flow's figures are stored to the cent, so the preview shows cents. */
const CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
// Read in UTC: the builder's dates are calendar days (lib/billing/calendar), and
// formatting `new Date("2026-09-25")` in a Pacific browser printed Sep 24.
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** A `YYYY-MM-DD` value as "Sep 25", or "Sep 25, 2028" when asked for the year. */
function dayLabel(value: string, withYear = false) {
  const date = parseDateInput(value);
  return date ? (withYear ? DAY_YEAR : DAY).format(date) : value;
}

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

/**
 * What the two dates mean, per type.
 *
 * They are the same two columns on every order — `startDate` and `endDate` —
 * but they do not mean the same thing, and the stored data says so plainly: the
 * median rental spans 22 days, a cloud order 29 (a billing month) and a
 * rent-to-own 731 — which is the agreement term, not a return date. Labelling
 * all four "Starts / Ends" made three of them look like rentals that forgot to
 * come back.
 *
 * A sale has no term at all (owner, 2026-09-16) — only the date it was ordered.
 * Its end date had been a "deliver by" that v1 defaulted to 30 days out, and the
 * calendar read that as gear coming back. The column is required, so a sale
 * stores its order date in both.
 */
const DATE_LABELS: Record<ReservationType, { legend: string; start: string; end: string | null }> = {
  RENTAL: { legend: "Rental window", start: "Out", end: "Back" },
  SALE: { legend: "Order date", start: "Ordered", end: null },
  RENT_TO_OWN: { legend: "Agreement term", start: "Starts", end: "Ends" },
  FLOW: { legend: "Subscription start / end", start: "Starts", end: "Ends" },
  CLOUD: { legend: "Billing period", start: "Starts", end: "Renews" },
};

/** What each type does once it is saved, said before it is saved. */
const TYPE_NOTE: Record<ReservationType, string> = {
  RENTAL: "Billed per period across the window; units are expected back.",
  SALE: "Billed once. No term — just the order date, and the quote's expiry once it is sent.",
  RENT_TO_OWN:
    "Recurring monthly. The payment and buyout are worked out from the term and the order total, so they can't disagree with what it costs.",
  FLOW: "Recurring monthly from its schedule, stepping down after each 12-month anniversary. The gear always comes back.",
  CLOUD: "Recurring per billing period. No physical units unless you add some.",
};

/** The types this builder can make: all of them. */
const BUILDER_TYPES = ORDER_TYPES;

/** Terms offered on a rent-to-own, matching what the existing agreements use. */
const RTO_TERMS = [3, 6, 12, 24, 36];

/**
 * Flow terms, as v1 offers them. The default, 24, is submitted, not just shown.
 * FLOW_TERMS is the same array the server checks a term against (lib/flow/terms) —
 * the builder never offers a length the server would refuse, and vice versa.
 */
const FLOW_DEFAULT_TERM = 24;

type FlowKnob = FlowKnobKey;

/** The knob rows, in display order, each carrying the shared bounds. */
const FLOW_KNOB_ORDER: FlowKnob[] = [
  "marginPct",
  "financePct",
  "purchaseTaxPct",
  "recoverByMonth",
  "deprPct",
  "lifeMonths",
  "stepPct",
];
const FLOW_KNOBS = FLOW_KNOB_ORDER.map((key) => ({ key, ...FLOW_KNOB_BOUNDS[key] }));

type FlowKnobText = Record<FlowKnob, string>;
const BLANK_KNOBS: FlowKnobText = {
  marginPct: "",
  financePct: "",
  purchaseTaxPct: "",
  recoverByMonth: "",
  deprPct: "",
  lifeMonths: "",
  stepPct: "",
};

/** A typed number, or undefined when the field is blank or not a number. */
function typedNumber(text: string | undefined): number | undefined {
  if (text == null || text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

type Client = { id: string; name: string; companyName: string | null };

type Line = DraftLine & {
  /** Units free across the whole window when the line was added or last checked. */
  free: number;
  freeFrom: string | null;
  /** Flow only: the basis as typed. Blank prices off the asset's landed cost. */
  basisText?: string;
};

/** A stored day, or a date from the server, as a date input value. */
function iso(date: Date) {
  return toDateInput(intendedDay(date));
}

/**
 * The new-order builder.
 *
 * The conflict pattern is the point of this screen, and it is the rule for the
 * whole app: a line that can't be filled is never a blocked save. It says what
 * is actually free, and offers substitute / move the window / book anyway —
 * priced, so the person choosing knows what they are choosing.
 *
 * One adaptation the design didn't have to account for: `ReservationItem`
 * carries no dates, so "start this line on Aug 2" cannot be stored per line.
 * The offer moves the whole order's window instead, and says so, rather than
 * pretending to a granularity the schema doesn't have.
 */
/**
 * `initialClient` is set when the builder is opened from an account record —
 * the client is already known, so asking for it again is a step backwards. It
 * is resolved on the server from the `client` query parameter, so an id that
 * doesn't exist arrives here as null and the picker appears as normal rather
 * than the screen half-filling with a phantom.
 */
export function OrderBuilder({
  initialClient = null,
}: {
  initialClient?: Client | null;
}) {
  const router = useRouter();
  // Today in Pacific time. UTC's today turned over at 5pm, so an order built in
  // the evening defaulted to starting tomorrow.
  const today = businessToday();
  const [start, setStart] = useState(toDateInput(today));
  const [rangeEnd, setEnd] = useState(toDateInput(addDays(today, 7)));
  const [projectName, setProjectName] = useState("");
  const [type, setType] = useState<ReservationType>("RENTAL");
  const [rtoTerm, setRtoTerm] = useState(24);
  const isFlow = type === "FLOW";
  // Flow: the term is real state from the start, so an untouched form submits 24
  // months rather than nothing (v1 a33476a/c35a1f6).
  const [flowTerm, setFlowTerm] = useState(FLOW_DEFAULT_TERM);
  const [flowKnobs, setFlowKnobs] = useState<FlowKnobText>(BLANK_KNOBS);
  const [flowTaxExempt, setFlowTaxExempt] = useState<boolean | null>(null);
  const [flowDefaults, setFlowDefaults] = useState<FlowPricingDefaults | null>(null);
  const [flowDefaultsError, setFlowDefaultsError] = useState("");
  const [flowBases, setFlowBases] = useState<Record<string, FlowAssetBasis>>({});
  const [flowBasesError, setFlowBasesError] = useState("");
  const [flowEconomics, setFlowEconomics] = useState<{
    key: string;
    value: FlowDraftEconomics | null;
  } | null>(null);
  const basesAsked = useRef(new Set<string>());
  const economicsTicket = useRef(0);
  // A sale has no term, so its window is the one day it is ordered. A Flow
  // order runs exactly its term, so its end follows from the start.
  const flowEnd = (() => {
    const day = parseDateInput(start);
    return day ? toDateInput(addTermMonths(day, flowTerm)) : start;
  })();
  const end = type === "SALE" ? start : isFlow ? flowEnd : rangeEnd;

  const [client, setClient] = useState<Client | null>(initialClient);
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<Client[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientError, setNewClientError] = useState("");

  const [assetQuery, setAssetQuery] = useState("");
  const packageHits = usePackageSearch(assetQuery);
  const [packageNote, setPackageNote] = useState<string | null>(null);
  const [assetHits, setAssetHits] = useState<AssetAvailability[]>([]);

  const [lines, setLines] = useState<Line[]>([]);
  const [subs, setSubs] = useState<Record<string, AssetAvailability[]>>({});
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const typed = useRef(false);

  useEffect(() => {
    // Clearing on an empty query happens on the same timer as a search, so the
    // effect never sets state synchronously and cascades a second render.
    const timer = setTimeout(() => {
      if (!clientQuery.trim()) setClientHits([]);
      else lookupClients(clientQuery).then(setClientHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [clientQuery]);

  useEffect(() => {
    if (!typed.current || !assetQuery.trim()) return;
    const timer = setTimeout(() => {
      lookupAssets(assetQuery, start, end).then(setAssetHits);
    }, 200);
    return () => clearTimeout(timer);
  }, [assetQuery, start, end]);

  function addLine(asset: AssetAvailability) {
    setAssetQuery("");
    setAssetHits([]);
    setLines((current) => [
      ...current,
      {
        assetId: asset.assetId,
        name: asset.name,
        quantity: 1,
        rate: asset.rate,
        pricingType: asset.pricingType,
        free: asset.free,
        freeFrom: asset.freeFrom ? iso(new Date(asset.freeFrom)) : null,
      },
    ]);
  }

  function update(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function short(line: Line) {
    return Math.max(0, line.quantity - line.free);
  }

  async function offerSubstitutes(line: Line) {
    const found = await lookupSubstitutes(
      line.assetId,
      line.quantity,
      start,
      end,
    );
    setSubs((current) => ({ ...current, [line.assetId]: found }));
  }

  /**
   * Choosing Flow the first time seeds the pricing assumptions from the house
   * defaults (Settings). They are real values in the fields, so what is shown is
   * what is sent; a field the person clears goes as blank, and the server fills
   * a blank from the same defaults.
   */
  function chooseType(option: ReservationType) {
    setType(option);
    if (option !== "FLOW" || flowDefaults) return;
    setFlowDefaultsError("");
    getFlowDefaults()
      .then((d) => {
        setFlowDefaults(d);
        setFlowKnobs((current) => {
          const seeded: FlowKnobText = { ...current };
          const from: Partial<Record<FlowKnob, number>> = {
            marginPct: d.marginPct,
            financePct: d.financePct,
            purchaseTaxPct: d.purchaseTaxPct,
            recoverByMonth: d.recoverByMonth,
            deprPct: d.deprPct,
            lifeMonths: d.lifeMonths,
          };
          for (const [key, value] of Object.entries(from) as [FlowKnob, number][]) {
            if (seeded[key] === "") seeded[key] = String(value);
          }
          return seeded;
        });
        setFlowTaxExempt((current) => current ?? d.taxExempt);
      })
      .catch(() => setFlowDefaultsError("The Flow pricing defaults couldn't be loaded."));
  }

  // Flow prices each line off its asset's landed cost, resolved on the server
  // once per asset — the same resolveFlowBasis the order is stored with.
  const missingBases = isFlow
    ? [...new Set(lines.map((l) => l.assetId))].filter((id) => !(id in flowBases)).join(",")
    : "";
  useEffect(() => {
    if (!missingBases) return;
    const ids = missingBases.split(",").filter((id) => !basesAsked.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => basesAsked.current.add(id));
    getFlowBasesForAssets(ids)
      .then((found) => setFlowBases((current) => ({ ...current, ...found })))
      .catch(() => {
        ids.forEach((id) => basesAsked.current.delete(id));
        setFlowBasesError("The landed cost of the new line couldn't be loaded.");
      });
  }, [missingBases]);

  // The knobs as sent: a blank field goes as undefined for the server to fill.
  const knobValues = {
    marginPct: typedNumber(flowKnobs.marginPct),
    financePct: typedNumber(flowKnobs.financePct),
    purchaseTaxPct: typedNumber(flowKnobs.purchaseTaxPct),
    taxExempt: flowTaxExempt ?? undefined,
    recoverByMonth: typedNumber(flowKnobs.recoverByMonth),
    deprPct: typedNumber(flowKnobs.deprPct),
    lifeMonths: typedNumber(flowKnobs.lifeMonths),
    stepPct:
      typedNumber(flowKnobs.stepPct) == null
        ? null
        : Math.round(typedNumber(flowKnobs.stepPct)! * 100) / 100,
  };
  const knobProblem = FLOW_KNOBS.map(({ key, label, min, max, whole }) => {
    const text = flowKnobs[key];
    if (text.trim() === "") return null;
    const n = typedNumber(text);
    if (n == null || n < min || n > max || (whole && !Number.isInteger(n))) {
      return `${label} must be ${whole ? "a whole number " : ""}between ${min} and ${max}.`;
    }
    return null;
  }).find(Boolean);

  /** A Flow line's basis as sent: the typed figure, to the cent, or undefined. */
  function typedBasis(line: Line): number | undefined {
    const n = typedNumber(line.basisText);
    return n == null || n < 0 ? undefined : Math.round(n * 100) / 100;
  }

  // The client price, live, through the same pure call the server stores with.
  // Blank knobs are filled from the defaults exactly as createReservation fills
  // them, so the preview is the order that will be saved.
  const flowConfig =
    isFlow && flowDefaults
      ? flowConfigFromSettings(
          applyFlowDefaults(
            {
              flowTermMonths: flowTerm,
              flowMarginPct: knobValues.marginPct ?? null,
              flowFinancePct: knobValues.financePct ?? null,
              flowPurchaseTaxPct: knobValues.purchaseTaxPct ?? null,
              flowTaxExempt: knobValues.taxExempt ?? null,
              flowRecoverByMonth: knobValues.recoverByMonth ?? null,
              flowDeprPct: knobValues.deprPct ?? null,
              flowLifeMonths: knobValues.lifeMonths ?? null,
              flowStepPct: knobValues.stepPct,
              flowPeriodsBilled: 0,
            },
            flowDefaults,
          ),
        )
      : null;
  const flowPriced =
    flowConfig && lines.length > 0
      ? priceFlowLines(
          lines.map((line) => {
            const trueCost = flowBases[line.assetId]?.basis ?? null;
            const typed = typedBasis(line);
            return {
              name: line.name,
              // The server floors the basis at true cost; priceFlowLines does too.
              costBasis: typed ?? trueCost,
              trueCost,
              quantity: line.quantity,
            };
          }),
          flowConfig,
        )
      : null;

  const basesLoading = lines.some((l) => !(l.assetId in flowBases));
  const incompleteLines = lines.filter((l) => {
    const b = flowBases[l.assetId];
    return b && (b.incomplete || !(b.basis > 0));
  });
  const flowProblem: string | null = !isFlow
    ? null
    : flowDefaultsError ||
      (!flowDefaults
        ? "Loading the Flow pricing defaults…"
        : flowBasesError ||
          (basesLoading
            ? "Loading the landed cost of the gear…"
            : incompleteLines.length > 0
              ? `${incompleteLines.map((l) => l.name).join(", ")}: the landed cost is incomplete (some units carry no purchase price), so ${
                  incompleteLines.length === 1 ? "it" : "they"
                } can't be priced as Flow. Fix the unit costs first.`
              : knobProblem ||
                (lines.length > 0 && flowPriced && !flowPriced.ok ? flowPriced.problem : null)));

  // The internal strip — hardware cost, lease balance, net cash, profit — needs
  // unit costs and lease balances, so it comes from the server, on the same draft.
  const economicsRequest =
    isFlow && flowPriced?.ok && !flowProblem
      ? {
          termMonths: flowTerm,
          knobs: knobValues,
          lines: lines.map((line) => ({
            assetId: line.assetId,
            quantity: line.quantity,
            costBasis: typedBasis(line) ?? null,
          })),
        }
      : null;
  const economicsKey = economicsRequest ? JSON.stringify(economicsRequest) : "";
  useEffect(() => {
    if (!economicsKey || !economicsRequest) return;
    const ticket = ++economicsTicket.current;
    const timer = setTimeout(() => {
      // economicsRequest is already the object economicsKey was stringified from —
      // no need to round-trip it back through JSON to get it again.
      previewFlowDraftEconomics(economicsRequest)
        .then((value) => {
          if (ticket === economicsTicket.current) setFlowEconomics({ key: economicsKey, value });
        })
        .catch(() => {
          if (ticket === economicsTicket.current) setFlowEconomics({ key: economicsKey, value: null });
        });
    }, 300);
    return () => clearTimeout(timer);
    // economicsKey is economicsRequest's content, so it alone decides when this
    // reruns; re-running on every economicsRequest identity would break the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [economicsKey]);
  const economics =
    flowEconomics && flowEconomics.key === economicsKey ? flowEconomics : null;

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await createOrder({
        clientId: client?.id ?? "",
        type,
        start,
        end,
        projectName,
        ...(type === "RENT_TO_OWN" ? { rtoTermMonths: rtoTerm } : {}),
        ...(isFlow ? { flow: { termMonths: flowTerm, ...knobValues } } : {}),
        lines: lines.map((full) => {
          const { free, freeFrom, basisText, ...line } = full;
          void free;
          void freeFrom;
          void basisText;
          // Flow: the typed basis, or blank for the server to price off landed cost.
          return isFlow ? { ...line, costBasis: typedBasis(full) } : line;
        }),
      });
      if (result.status === "error") setError(result.message);
      else router.push(`/dashboard/orders/${result.reservationId}`);
    });
  }

  const total = lines.reduce((sum, l) => sum + l.rate * l.quantity, 0);
  const unresolved = lines.filter((l) => short(l) > 0 && !l.overbooked);

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
        <header className="flex items-center gap-2 px-4 pb-3">
          <h2 className="text-card-title">Equipment</h2>
          <span className="text-detail text-ink-muted">
            {/* A window that crosses a year (a Flow term, a long rental) names
                the years, or two years read as "Sep 26 – Sep 26". */}
            Availability is checked across{" "}
            {dayLabel(start, start.slice(0, 4) !== end.slice(0, 4))}
            {end === start
              ? ""
              : ` – ${dayLabel(end, start.slice(0, 4) !== end.slice(0, 4))}`}
          </span>
        </header>

        <div className="px-4 pb-3">
          <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
            <Search className="size-4 flex-none text-ink-faint" aria-hidden />
            <input
              value={assetQuery}
              onChange={(event) => {
                typed.current = true;
                setAssetQuery(event.target.value);
              }}
              placeholder="Search assets and our packages"
              aria-label="Search assets and packages"
              className="w-full border-0 bg-transparent text-body outline-none placeholder:text-ink-faint"
            />
          </label>

          {packageNote ? (
            <p className="mt-2 text-detail text-ink-muted">{packageNote}</p>
          ) : null}
          {assetHits.length > 0 || packageHits.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-px rounded-well bg-sunken p-1">
              <PackagePicks
                hits={packageHits}
                start={start}
                end={end}
                onLines={(added, note) => {
                  setPackageNote(note);
                  if (added.length === 0) return;
                  setAssetQuery("");
                  setAssetHits([]);
                  setLines((current) => [
                    ...current,
                    ...added.map((line) => ({
                      assetId: line.assetId,
                      name: line.name,
                      quantity: line.quantity,
                      rate: line.rate,
                      pricingType: line.pricingType,
                      free: line.free,
                      freeFrom: line.freeFrom ? iso(new Date(line.freeFrom)) : null,
                    })),
                  ]);
                }}
              />
              {assetHits.map((asset) => (
                <li key={asset.assetId}>
                  <button
                    type="button"
                    onClick={() => addLine(asset)}
                    className="grid w-full grid-cols-[1fr_96px_80px] items-center gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="truncate">{asset.name}</span>
                    <span
                      className={
                        asset.free > 0 ? "text-ink-muted" : "text-accent-text"
                      }
                    >
                      {asset.free} of {asset.fleet} free
                    </span>
                    {/* Flow never prices off the catalog rate. */}
                    <span className="text-right tabular-nums">
                      {isFlow ? "" : MONEY.format(asset.rate)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
          {lines.length === 0 ? (
            <li className="px-2 py-6 text-center text-body text-ink-muted">
              Nothing on this order yet — search above to add the first line.
            </li>
          ) : null}

          {lines.map((line, index) => {
            const missing = short(line);
            const substitutes = subs[line.assetId] ?? [];
            return (
              <li key={`${line.assetId}-${index}`} className="rounded-bubble bg-row-alt p-2">
                <div
                  className={`grid items-center gap-2 px-1 ${
                    isFlow
                      ? "grid-cols-[1fr_64px_104px_96px_28px]"
                      : "grid-cols-[1fr_64px_88px_88px_28px]"
                  }`}
                >
                  <span className="truncate font-bold">{line.name}</span>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    aria-label={`Quantity of ${line.name}`}
                    onChange={(event) =>
                      update(index, {
                        quantity: Math.max(1, Number(event.target.value) || 1),
                        // A changed quantity is a new question.
                        overbooked: false,
                      })
                    }
                    className="h-7 rounded-row border-0 bg-panel px-2 text-right text-detail tabular-nums outline-none"
                  />
                  {isFlow ? (
                    // Flow prices off the basis, not a rate: landed cost by
                    // default, which may be raised but is floored at true cost.
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.basisText ?? (flowBases[line.assetId] ? String(flowBases[line.assetId].basis) : "")}
                      placeholder={line.assetId in flowBases ? "Basis" : "Loading…"}
                      aria-label={`Cost basis per unit of ${line.name}`}
                      onChange={(event) => update(index, { basisText: event.target.value })}
                      className="h-7 rounded-row border-0 bg-panel px-2 text-right text-detail tabular-nums outline-none"
                    />
                  ) : (
                    <span className="text-right text-detail tabular-nums text-ink-muted">
                      {MONEY.format(line.rate)}
                      <span className="text-ink-faint">
                        /{line.pricingType.toLowerCase().slice(0, 2)}
                      </span>
                    </span>
                  )}
                  <span className="text-right font-bold tabular-nums">
                    {isFlow
                      ? flowPriced?.ok
                        ? CENTS.format(flowPriced.subtotals[index] ?? 0)
                        : "—"
                      : MONEY.format(line.rate * line.quantity)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() =>
                      setLines((c) => c.filter((_, i) => i !== index))
                    }
                    className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>

                {isFlow ? (
                  <p className="mt-1 px-1 text-detail text-ink-muted">
                    {(() => {
                      const b = flowBases[line.assetId];
                      if (!b) return "Loading the landed cost…";
                      if (b.incomplete || !(b.basis > 0)) {
                        return (
                          <span className="text-destructive">
                            Landed cost incomplete — {b.costedUnits} of {b.consideredUnits} units carry
                            a cost. Fix the unit costs first.
                          </span>
                        );
                      }
                      const typed = typedBasis(line);
                      const floored = typed != null && typed < b.basis;
                      return (
                        <>
                          True cost {CENTS.format(b.basis)}
                          {flowPriced?.ok
                            ? ` · ${CENTS.format(flowPriced.rates[index] ?? 0)} contract a unit`
                            : ""}
                          {floored ? (
                            <span className="text-accent-text">
                              {" "}· below true cost, so it prices at {CENTS.format(b.basis)}
                            </span>
                          ) : null}
                        </>
                      );
                    })()}
                  </p>
                ) : null}

                {missing > 0 && !line.overbooked ? (
                  <div className="mt-2 rounded-well bg-accent-tint p-2">
                    <p className="text-detail font-bold text-accent-on-tint">
                      {line.free === 0
                        ? `No ${line.name} is free for the whole window`
                        : `Only ${line.free} of ${line.quantity} ${line.name} are free for the whole window`}
                      {line.freeFrom
                        ? ` — the rest are out until ${dayLabel(line.freeFrom)}`
                        : ""}
                      .
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => offerSubstitutes(line)}
                        className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid"
                      >
                        Find a substitute
                      </button>
                      {line.freeFrom ? (
                        <button
                          type="button"
                          onClick={() => setStart(line.freeFrom!)}
                          className="rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover"
                        >
                          Start the order {DAY.format(new Date(line.freeFrom))}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => update(index, { overbooked: true })}
                        className="rounded-pill bg-panel px-3 py-1 text-pill text-ink hover:bg-row-hover"
                      >
                        Book anyway, flag ops
                      </button>
                    </div>

                    {line.freeFrom ? (
                      // Said out loud: ReservationItem has no dates, so a line
                      // cannot start on its own day.
                      <p className="mt-2 text-detail text-accent-on-tint">
                        Moving the start moves the whole order — a line can&rsquo;t
                        begin on its own date.
                      </p>
                    ) : null}

                    {substitutes.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-px">
                        {substitutes.map((sub) => (
                          <li key={sub.assetId}>
                            <button
                              type="button"
                              onClick={() => {
                                update(index, {
                                  assetId: sub.assetId,
                                  name: sub.name,
                                  rate: sub.rate,
                                  pricingType: sub.pricingType,
                                  free: sub.free,
                                  freeFrom: null,
                                  overbooked: false,
                                });
                                setSubs((c) => ({ ...c, [line.assetId]: [] }));
                              }}
                              className="grid w-full grid-cols-[1fr_88px_72px] items-center gap-2 rounded-row bg-panel px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                            >
                              <span className="truncate">
                                Substitute {sub.name}
                              </span>
                              <span className="text-ink-muted">
                                {sub.free} free
                              </span>
                              <span className="text-right tabular-nums">
                                {MONEY.format(sub.rate)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {line.overbooked ? (
                  <p className="mt-2 rounded-well bg-sunken px-2 py-1 text-detail text-ink-muted">
                    Booked over what&rsquo;s free. Ops will be flagged on this
                    order.{" "}
                    <button
                      type="button"
                      onClick={() => update(index, { overbooked: false })}
                      className="text-accent-text underline-offset-2 hover:underline"
                    >
                      Undo
                    </button>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="flex flex-col gap-3">
        <section className="rounded-card bg-panel px-4 py-[14px] shadow-sm">
          <h2 className="mb-3 text-card-title">Order</h2>

          <span className={LABEL}>Type</span>
          <div
            role="radiogroup"
            aria-label="Order type"
            className="mb-2 grid grid-cols-2 gap-1"
          >
            {BUILDER_TYPES.map((option) => {
              const selected = option === type;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseType(option)}
                  className={`rounded-well px-3 py-2 text-pill transition-colors ${
                    selected
                      ? "bg-accent-tint text-accent-on-tint"
                      : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink"
                  }`}
                >
                  {TYPE_LABEL[option]}
                </button>
              );
            })}
          </div>
          <p className="mb-3 text-detail text-ink-muted">{TYPE_NOTE[type]}</p>

          <label className={LABEL} htmlFor="client">
            Client
          </label>
          {client ? (
            <div className="mb-3 flex items-center gap-2 rounded-well bg-sunken px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-body">
                {client.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setClient(null);
                  setClientQuery("");
                }}
                className="text-detail text-accent-text hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="mb-3">
              <input
                id="client"
                value={clientQuery}
                onChange={(event) => setClientQuery(event.target.value)}
                placeholder="Search clients"
                className={FIELD}
              />
              {clientHits.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-px rounded-well bg-sunken p-1">
                  {clientHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClient(hit);
                          setClientHits([]);
                        }}
                        className="w-full truncate rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                      >
                        {hit.name}
                        {hit.companyName ? (
                          <span className="text-ink-faint"> · {hit.companyName}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* A client who is not in the system yet is the normal way an
                  order starts — a call from somebody new. Sending the person to
                  the Accounts screen to make one loses everything typed into
                  this builder so far, so the account is created here, from the
                  name already in the box, and selected. */}
              {clientQuery.trim().length >= 2 && clientHits.length === 0 ? (
                <div className="mt-1 rounded-well bg-sunken p-2">
                  {newClientError ? (
                    <p role="alert" className="mb-2 text-detail text-destructive">
                      {newClientError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={creatingClient}
                    onClick={() => {
                      const name = clientQuery.trim();
                      setNewClientError("");
                      setCreatingClient(true);
                      createAccount({ name }).then((result) => {
                        setCreatingClient(false);
                        if (result.status === "ok") {
                          setClient({ id: result.id, name: result.name, companyName: null });
                          setClientQuery("");
                        } else if (result.status === "duplicate") {
                          setClient({
                            id: result.existing.id,
                            name: result.existing.name,
                            companyName: result.existing.companyName,
                          });
                          setClientQuery("");
                        } else {
                          setNewClientError(result.message);
                        }
                      });
                    }}
                    className="w-full rounded-row px-2 py-[6px] text-left text-detail text-accent-text hover:bg-row-hover disabled:opacity-50"
                  >
                    {creatingClient
                      ? "Creating…"
                      : `No match — create “${clientQuery.trim()}” as a new account`}
                  </button>
                  <p className="px-2 pt-1 text-micro text-ink-faint">
                    Creates it with just the name. Fill in the rest on the
                    account record later.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          <span className={LABEL}>{DATE_LABELS[type].legend}</span>
          <div
            className={`mb-3 grid gap-2 ${
              DATE_LABELS[type].end ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            <div>
              <label
                className="mb-[6px] block text-detail text-ink-muted"
                htmlFor="start"
              >
                {DATE_LABELS[type].start}
              </label>
              <input
                id="start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className={FIELD}
              />
            </div>
            {DATE_LABELS[type].end ? (
              <div>
                <label
                  className="mb-[6px] block text-detail text-ink-muted"
                  htmlFor="end"
                >
                  {DATE_LABELS[type].end}
                </label>
                {/* A Flow order runs exactly its term, so its end is not typed. */}
                <input
                  id="end"
                  type="date"
                  value={isFlow ? flowEnd : rangeEnd}
                  readOnly={isFlow}
                  aria-readonly={isFlow}
                  title={isFlow ? "The start plus the term" : undefined}
                  onChange={(event) => {
                    if (!isFlow) setEnd(event.target.value);
                  }}
                  className={`${FIELD} ${isFlow ? "text-ink-muted" : ""}`}
                />
              </div>
            ) : null}
          </div>

          {/* The one field that only exists on one type. The payment and buyout
              are not asked for: createReservation derives both from this and the
              order total, so a typed monthly that contradicted the lines is not
              a state this form can reach. */}
          {type === "RENT_TO_OWN" ? (
            <div className="mb-3">
              <label className={LABEL} htmlFor="rto-term">
                Term
              </label>
              <select
                id="rto-term"
                value={rtoTerm}
                onChange={(event) => setRtoTerm(Number(event.target.value))}
                className={FIELD}
              >
                {RTO_TERMS.map((months) => (
                  <option key={months} value={months}>
                    {months} months
                  </option>
                ))}
              </select>
              <p className="mt-[6px] text-detail text-ink-muted">
                {total > 0
                  ? `About ${MONEY.format(total / rtoTerm)} a month before tax, from the lines added so far.`
                  : "Add lines and the monthly payment follows from the total."}
              </p>
            </div>
          ) : null}

          {/* Flow's own fields, laid out like the rent-to-own term. The term is
              always sent; the assumptions are the house defaults, overridable. */}
          {isFlow ? (
            <div className="mb-3">
              <label className={LABEL} htmlFor="flow-term">
                Term
              </label>
              <select
                id="flow-term"
                value={flowTerm}
                onChange={(event) => setFlowTerm(Number(event.target.value))}
                className={FIELD}
              >
                {FLOW_TERMS.map((months) => (
                  <option key={months} value={months}>
                    {months} months
                  </option>
                ))}
              </select>
              <p className="mt-[6px] text-detail text-ink-muted">
                The gear comes back at the end. A 12-month term bills level; longer
                terms recover the hardware in year one, then step down.
              </p>

              <details className="mt-2 rounded-well bg-sunken px-3 py-2">
                <summary className="cursor-pointer text-detail font-bold text-ink">
                  Pricing assumptions
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {FLOW_KNOBS.map(({ key, label, min, max, whole }) => (
                    <div key={key}>
                      <label
                        className="mb-[6px] block text-detail text-ink-muted"
                        htmlFor={`flow-${key}`}
                      >
                        {label}
                      </label>
                      <input
                        id={`flow-${key}`}
                        type="number"
                        min={min}
                        max={max}
                        step={whole ? 1 : "0.01"}
                        value={flowKnobs[key]}
                        placeholder={key === "stepPct" ? "Off" : flowDefaults ? "Default" : "Loading…"}
                        onChange={(event) =>
                          setFlowKnobs((current) => ({ ...current, [key]: event.target.value }))
                        }
                        className="h-8 w-full rounded-row border-0 bg-panel px-2 text-right text-detail tabular-nums text-ink outline-none"
                      />
                    </div>
                  ))}
                  <label className="col-span-2 flex items-center gap-2 text-detail text-ink">
                    <input
                      type="checkbox"
                      checked={flowTaxExempt ?? false}
                      onChange={(event) => setFlowTaxExempt(event.target.checked)}
                    />
                    Exempt from purchase tax
                  </label>
                </div>
                <p className="mt-2 text-detail text-ink-muted">
                  Purchase tax is what we&rsquo;d pay buying the gear, not the
                  client&rsquo;s sales tax. Leave the step blank to shape the
                  schedule by the recover-by month. A cleared field takes the house
                  default.
                </p>
              </details>
            </div>
          ) : null}

          <label className={LABEL} htmlFor="project">
            Project
          </label>
          <input
            id="project"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Optional"
            className={FIELD}
          />
        </section>

        <section className="rounded-card bg-panel px-4 py-[14px] shadow-sm">
          {isFlow ? (
            <FlowPreview
              priced={flowPriced?.ok ? flowPriced : null}
              lineCount={lines.length}
              problem={flowProblem}
              economics={economics?.value ?? null}
              economicsPending={!!economicsKey && !economics}
            />
          ) : (
            <>
            <div className="flex items-baseline justify-between">
              {/* A sale bills once; the other three bill per period. Calling the
                  same number "Per period" on a sale overstated it by the length
                  of the window. */}
              <span className="text-card-title">
                {type === "SALE" ? "Order total" : "Per period"}
              </span>
              <span className="text-page-title text-[22px] tabular-nums">
                {MONEY.format(total)}
              </span>
            </div>
            <p className="mt-1 text-detail text-ink-muted">
              {lines.length === 0
                ? "Nothing added yet"
                : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${
                    type === "SALE"
                      ? "billed once when the order is approved"
                      : "the record prices the full term"
                  }`}
            </p>
            </>
          )}

          {error ? (
            <Notice tone="error" className="mt-3">
              {error}
            </Notice>
          ) : null}

          {unresolved.length > 0 ? (
            <Notice tone="ok" className="mt-3">
              {unresolved.length} {unresolved.length === 1 ? "line needs" : "lines need"}{" "}
              an answer before this can be saved — substitute, move the start, or
              book anyway.
            </Notice>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={
              busy ||
              !client ||
              lines.length === 0 ||
              unresolved.length > 0 ||
              (isFlow && !!flowProblem)
            }
            className="mt-3 h-10 w-full rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
          >
            {busy ? "Creating…" : `Create draft ${TYPE_LABEL[type].toLowerCase()}`}
          </button>
          <p className="mt-2 text-detail text-ink-muted">
            Saved as a draft, which holds no stock. Approving it is what commits
            the units.
          </p>
        </section>
      </aside>
    </div>
  );
}

/**
 * The Flow order's live preview: what the client pays in month one, when it
 * steps down and to what, and the contract — then, below a rule, the internal
 * strip, which is staff-only and never reaches a client surface: what the gear
 * cost us, what it still owes on its leases, month one's net cash after the
 * lease payments, and the profit.
 */
function FlowPreview({
  priced,
  lineCount,
  problem,
  economics,
  economicsPending,
}: {
  priced: FlowPricedLines | null;
  lineCount: number;
  problem: string | null;
  economics: FlowDraftEconomics | null;
  economicsPending: boolean;
}) {
  const schedule = priced?.result.schedule;
  const stepMonth = schedule && schedule.steps.length > 1 ? schedule.steps[1] : null;
  const internal: [string, number | undefined][] = [
    ["Hardware cost", economics?.hardware],
    ["Lease balance on the gear", economics?.leaseBalance],
    ["Monthly net cash", economics?.monthlyNet],
    ["Profit", economics?.profit],
  ];
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-card-title">Month 1</span>
        <span className="text-page-title text-[22px] tabular-nums">
          {priced ? CENTS.format(priced.monthlyNow) : "—"}
        </span>
      </div>
      {priced ? (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-detail">
          <dt className="text-ink-muted">
            {stepMonth ? `Steps down in month ${stepMonth} to` : "Level for the whole term"}
          </dt>
          <dd className="text-right tabular-nums">
            {stepMonth ? `${CENTS.format(priced.result.rateForMonth(stepMonth))}/mo` : ""}
          </dd>
          <dt className="text-ink-muted">Contract value</dt>
          <dd className="text-right font-bold tabular-nums">
            {CENTS.format(priced.contractValue)}
          </dd>
        </dl>
      ) : (
        <p className="mt-1 text-detail text-ink-muted">
          {lineCount === 0 ? "Nothing added yet" : (problem ?? "Pricing…")}
        </p>
      )}
      {priced && priced.flooredLines > 0 ? (
        <p className="mt-2 text-detail text-accent-text">
          {priced.flooredLines} {priced.flooredLines === 1 ? "line was" : "lines were"} priced
          below what the gear cost us, so {priced.flooredLines === 1 ? "it is" : "they are"} raised
          to true cost.
        </p>
      ) : null}
      {priced && problem ? (
        <p className="mt-2 text-detail text-destructive">{problem}</p>
      ) : null}

      {priced ? (
        <div className="mt-3 rounded-well bg-sunken px-3 py-2">
          <p className="mb-1 text-micro uppercase text-ink-muted">
            Internal · never shown to the client
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-detail">
            {internal.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd
                  className={`text-right tabular-nums ${
                    value != null && value < 0 ? "text-destructive" : ""
                  }`}
                >
                  {value != null ? CENTS.format(value) : economicsPending ? "…" : "—"}
                </dd>
              </div>
            ))}
          </dl>
          {economics && economics.assumedUnits > 0 ? (
            <p className="mt-1 text-micro text-ink-faint">
              About {economics.assumedUnits} {economics.assumedUnits === 1 ? "unit sits" : "units sit"} on
              a lease with no recorded terms; its balance is assumed.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
