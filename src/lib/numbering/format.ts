/**
 * Document numbers: what each kind of record is called, as a pattern the
 * business can change (Settings → Business).
 *
 * A pattern is literal text plus three tokens:
 *   {SEQ}   the running number, zero-padded to the kind's width
 *   {YYYY}  the four-digit year      {YY}  the two-digit year
 * so `RES-{YYYY}-{SEQ}` is today's RES-2026-00118, and
 * `vfxnow-res-{SEQ}-{YY}` would make it vfxnow-res-00118-26.
 *
 * The defaults are exactly the formats v1 and v2 have always generated, so
 * nothing changes until someone edits a pattern. A quote has no number of its
 * own — it is an order at quote stage and carries the order's number — so the
 * four order types are the quote numbers too.
 *
 * Pure: the settings form previews numbers in the browser with the same code
 * the server uses to issue them.
 */

export const NUMBER_KINDS = [
  "rental",
  "sale",
  "rentToOwn",
  "cloud",
  "invoice",
  "purchaseOrder",
  "fundingRequest",
  "workOrder",
  "lease",
] as const;

export type NumberKind = (typeof NUMBER_KINDS)[number];

export type NumberingRule = {
  pattern: string;
  /** Digits {SEQ} is padded to. */
  padding: number;
  /** "yearly" restarts at 1 each year; "never" runs on for ever. */
  reset: "yearly" | "never";
  /**
   * The number to issue next, when set. The generator issues this or one past
   * the highest already issued under the pattern, whichever is greater — so it
   * can move numbering forward (say, to 1000 at go-live) but can never reissue
   * a number that exists.
   */
  next: number | null;
};

export const NUMBER_KIND_LABEL: Record<NumberKind, string> = {
  rental: "Rental orders & quotes",
  sale: "Sales & sale quotes",
  rentToOwn: "Rent-to-own orders & quotes",
  cloud: "Cloud orders & quotes",
  invoice: "Invoices",
  purchaseOrder: "Purchase orders",
  fundingRequest: "Funding requests",
  workOrder: "Work orders",
  lease: "Leases",
};

export const DEFAULT_NUMBERING: Record<NumberKind, NumberingRule> = {
  rental: { pattern: "RES-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  sale: { pattern: "SALE-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  rentToOwn: { pattern: "RTO-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  cloud: { pattern: "CLD-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  invoice: { pattern: "INV-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  purchaseOrder: { pattern: "PO-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  fundingRequest: { pattern: "FR-{YYYY}-{SEQ}", padding: 5, reset: "yearly", next: null },
  workOrder: { pattern: "WO-{YYYY}-{SEQ}", padding: 4, reset: "yearly", next: null },
  lease: { pattern: "LSE-{SEQ}", padding: 4, reset: "never", next: null },
};

export function renderNumber(rule: NumberingRule, sequence: number, year: number): string {
  return rule.pattern
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year % 100).padStart(2, "0"))
    .replace(/\{SEQ\}/g, String(sequence).padStart(rule.padding, "0"));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A matcher for numbers issued under `rule` in `year`, capturing the sequence.
 * With `reset: "never"` a year token still has to match a year, but any year.
 */
export function numberMatcher(rule: NumberingRule, year: number): RegExp {
  const parts = rule.pattern.split(/(\{YYYY\}|\{YY\}|\{SEQ\})/);
  const source = parts
    .map((part) => {
      if (part === "{SEQ}") return "(\\d+)";
      if (part === "{YYYY}") return rule.reset === "yearly" ? String(year) : "\\d{4}";
      if (part === "{YY}")
        return rule.reset === "yearly" ? String(year % 100).padStart(2, "0") : "\\d{2}";
      return escapeRegex(part);
    })
    .join("");
  return new RegExp(`^${source}$`, "i");
}

/** The literal text before the first token — narrows the database lookup. */
export function literalPrefix(pattern: string): string {
  const index = pattern.search(/\{(YYYY|YY|SEQ)\}/);
  return index < 0 ? pattern : pattern.slice(0, index);
}

/** Why a rule can't be saved, or null when it can. */
export function numberingProblem(rule: NumberingRule): string | null {
  const pattern = rule.pattern.trim();
  if (!pattern) return "A pattern can't be empty.";
  if ((pattern.match(/\{SEQ\}/g) ?? []).length !== 1)
    return "A pattern needs {SEQ} exactly once — it is what keeps every number different.";
  if (/[{}]/.test(pattern.replace(/\{(YYYY|YY|SEQ)\}/g, "")))
    return "Only {SEQ}, {YYYY} and {YY} can go in braces.";
  if (!/^[A-Za-z0-9{}\-_./# ]+$/.test(pattern))
    return "Use letters, numbers, spaces and - _ . / # only.";
  if (pattern.length > 40) return "Keep a pattern to 40 characters.";
  if (rule.reset === "yearly" && !/\{YYYY\}|\{YY\}/.test(pattern))
    return "A yearly reset needs {YYYY} or {YY} in the pattern, or January would reissue last year's numbers.";
  if (!Number.isInteger(rule.padding) || rule.padding < 1 || rule.padding > 8)
    return "Padding is between 1 and 8 digits.";
  if (rule.next !== null && (!Number.isInteger(rule.next) || rule.next < 1 || rule.next > 99_999_999))
    return "Next number has to be a whole number of at least 1.";
  return null;
}

export function parseNumbering(value: unknown): Record<NumberKind, NumberingRule> {
  const raw = (value ?? {}) as Partial<Record<NumberKind, Partial<NumberingRule>>>;
  const result = {} as Record<NumberKind, NumberingRule>;
  for (const kind of NUMBER_KINDS) {
    const fallback = DEFAULT_NUMBERING[kind];
    const candidate: NumberingRule = {
      pattern: typeof raw[kind]?.pattern === "string" ? raw[kind]!.pattern! : fallback.pattern,
      padding: typeof raw[kind]?.padding === "number" ? raw[kind]!.padding! : fallback.padding,
      reset: raw[kind]?.reset === "never" || raw[kind]?.reset === "yearly" ? raw[kind]!.reset! : fallback.reset,
      next: typeof raw[kind]?.next === "number" ? raw[kind]!.next! : null,
    };
    // A stored rule that no longer validates falls back whole, rather than
    // issuing a number that could collide.
    result[kind] = numberingProblem(candidate) ? fallback : candidate;
  }
  return result;
}
