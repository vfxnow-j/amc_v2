import type {
  AskCategory,
  AskStatus,
  Business,
  InteractionChannel,
  InteractionDirection,
  InteractionIntent,
  InteractionReach,
  NextStepKind,
  TemperatureBand,
} from "@/generated/prisma/client";

/**
 * The Client Tracker's vocabulary (docs/client-tracker.md).
 *
 * Prisma-free and type-only on the generated client, so the quick-log form and
 * the band pill can import it without dragging the pg driver into the browser.
 */

/** A band as shown. A lead is a Prospect, never a temperature. */
export type Band = TemperatureBand | "PROSPECT";

export type Tier = "A" | "B" | "C";

export const BANDS: Band[] = ["HOT", "WARM", "COLD", "SEASONAL", "DEAD", "PROSPECT"];

/** The bands a person may pin an account to. */
export const PIN_BANDS: TemperatureBand[] = ["HOT", "WARM", "COLD", "SEASONAL", "DEAD"];

export const BAND_LABEL: Record<Band, string> = {
  HOT: "Hot",
  WARM: "Warm",
  COLD: "Cold",
  SEASONAL: "Seasonal",
  DEAD: "Dead",
  PROSPECT: "Prospect",
};

/**
 * Which of the twelve tile accents carries each band.
 *
 * Borrowed rather than new: those hues already clear 4.5:1 text-on-tint in both
 * modes across every theme (globals.css, "Tile accents"), and a band pill is
 * exactly text on tint. The spec asked for a warm orange for Hot; the palette
 * has no orange, and rose is the warmest hue that is not the red this app
 * already spends on "overdue". **Dead is slate, never red** — it is an account
 * leaving the active lists, not an alarm. The label is always printed, so the
 * colour only ever reinforces it.
 */
export const BAND_ACCENT: Record<Band, string> = {
  HOT: "rose",
  WARM: "amber",
  COLD: "blue",
  SEASONAL: "violet",
  DEAD: "slate",
  PROSPECT: "teal",
};

export const BUSINESSES: Business[] = ["VFXNOW", "GPL"];
export const BUSINESS_LABEL: Record<Business, string> = {
  VFXNOW: "VFXNow",
  GPL: "GPL",
};

export const CHANNELS: InteractionChannel[] = [
  "CALL",
  "EMAIL",
  "TEXT",
  "VIDEO",
  "MEETING",
  "IN_PERSON",
  "EVENT",
];
export const CHANNEL_LABEL: Record<InteractionChannel, string> = {
  CALL: "Call",
  EMAIL: "Email",
  TEXT: "Text",
  VIDEO: "Video call",
  MEETING: "Meeting",
  IN_PERSON: "In person",
  EVENT: "Event",
};

export const DIRECTIONS: InteractionDirection[] = ["OUTBOUND", "INBOUND"];
export const DIRECTION_LABEL: Record<InteractionDirection, string> = {
  OUTBOUND: "We reached out",
  INBOUND: "They reached out",
};

export const REACHES: InteractionReach[] = ["CONNECTED", "NO_ANSWER", "VOICEMAIL", "NO_REPLY"];
export const REACH_LABEL: Record<InteractionReach, string> = {
  CONNECTED: "Connected",
  NO_ANSWER: "No answer",
  VOICEMAIL: "Left voicemail",
  NO_REPLY: "No reply",
};

/** Weakest to strongest, which is also the order the form offers them in. */
export const INTENTS: InteractionIntent[] = [
  "NO_GO",
  "NOT_NOW",
  "CURIOUS",
  "PROSPECTING",
  "READY_TO_BUY",
];
export const INTENT_LABEL: Record<InteractionIntent, string> = {
  NO_GO: "No go",
  NOT_NOW: "Not now",
  CURIOUS: "Curious",
  PROSPECTING: "Prospecting",
  READY_TO_BUY: "Ready to buy",
};

/** CURIOUS and above are a move; silence, NO_GO and NOT_NOW are not. */
export const POSITIVE_INTENTS: InteractionIntent[] = ["CURIOUS", "PROSPECTING", "READY_TO_BUY"];

export const NEXT_STEPS: NextStepKind[] = ["FOLLOW_UP", "SEND_QUOTE", "DEMO", "SITE_VISIT", "NONE"];
export const NEXT_STEP_LABEL: Record<NextStepKind, string> = {
  FOLLOW_UP: "Follow up",
  SEND_QUOTE: "Send quote",
  DEMO: "Demo",
  SITE_VISIT: "Site visit",
  NONE: "Nothing scheduled",
};

/**
 * What the form proposes after each grade — the spec's "Grading a conversation"
 * table. Defaults only: the rep can change both before saving.
 */
export const INTENT_DEFAULT_STEP: Record<
  InteractionIntent,
  { step: NextStepKind; days: number | null }
> = {
  NO_GO: { step: "NONE", days: null },
  NOT_NOW: { step: "FOLLOW_UP", days: 60 },
  CURIOUS: { step: "FOLLOW_UP", days: 14 },
  PROSPECTING: { step: "FOLLOW_UP", days: 7 },
  READY_TO_BUY: { step: "SEND_QUOTE", days: 2 },
};

/** An unanswered attempt needs no grade, only a retry date. */
export const RETRY_DAYS = 3;

export const ASK_CATEGORIES: AskCategory[] = [
  "WORKSTATION",
  "GPU",
  "STORAGE",
  "NETWORK",
  "REMOTE_ACCESS",
  "SOFTWARE",
  "CLOUD",
  "PRO_SERVICES",
  "MANAGED_SERVICES",
  "LOGISTICS",
  "OTHER",
];
export const ASK_CATEGORY_LABEL: Record<AskCategory, string> = {
  WORKSTATION: "Workstations",
  GPU: "GPUs",
  STORAGE: "Storage",
  NETWORK: "Network",
  REMOTE_ACCESS: "Remote access",
  SOFTWARE: "Software",
  CLOUD: "Cloud",
  PRO_SERVICES: "Pro services",
  MANAGED_SERVICES: "Managed services",
  LOGISTICS: "Logistics",
  OTHER: "Other",
};

export const ASK_STATUSES: AskStatus[] = ["OPEN", "QUOTED", "WON", "LOST", "CANT_SUPPLY"];
export const ASK_STATUS_LABEL: Record<AskStatus, string> = {
  OPEN: "Open",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
  CANT_SUPPLY: "Can't supply",
};
export const CLOSED_ASK_STATUSES: AskStatus[] = ["WON", "LOST", "CANT_SUPPLY"];

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: number): string {
  return MONTH[month - 1] ?? String(month);
}

/**
 * "Mar–May, Nov". Runs are collapsed so a window reads as a window, including
 * one that wraps the year ("Nov–Feb").
 */
export function formatMonths(months: number[]): string {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (set.size === 0) return "";
  if (set.size === 12) return "All year";

  // Start from a month whose predecessor is not in the set, so a run that
  // wraps December into January is read as one run.
  let start = 1;
  for (let m = 1; m <= 12; m++) {
    const prev = m === 1 ? 12 : m - 1;
    if (set.has(m) && !set.has(prev)) {
      start = m;
      break;
    }
  }

  const runs: string[] = [];
  let first: number | null = null;
  let last = start;
  const close = () => {
    if (first === null) return;
    runs.push(first === last ? monthLabel(first) : `${monthLabel(first)}–${monthLabel(last)}`);
    first = null;
  };
  for (let i = 0; i < 12; i++) {
    const month = ((start - 1 + i) % 12) + 1;
    if (set.has(month)) {
      first ??= month;
      last = month;
    } else {
      close();
    }
  }
  close();
  return runs.join(", ");
}
