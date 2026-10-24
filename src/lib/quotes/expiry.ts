/**
 * How long a quote's pricing holds. Pure, so the Send dialog (a client
 * component) can import it. The stored value is anchored at midday UTC, like
 * every other calendar day in this app; the link itself dies at the end of that
 * day, so the client gets the whole of the date the quote shows.
 */

export const EXPIRY_CHOICES = ["1d", "3d", "7d", "14d", "30d"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

export const EXPIRY_CHOICE_LABEL: Record<ExpiryChoice, string> = {
  "1d": "24 hours",
  "3d": "3 days",
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
};

/** Default validity for a quote with no date set. Hardware prices move; keep it short. */
export const DEFAULT_EXPIRY_CHOICE: ExpiryChoice = "7d";

export function expiryFromChoice(choice: ExpiryChoice, now: Date = new Date()): Date {
  const days = Number.parseInt(choice, 10);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 12, 0, 0));
}

/** The last instant a link with this expiry date works. */
export function endOfExpiryDay(expiry: Date): Date {
  const end = new Date(expiry);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

const OPEN_STATUSES = ["DRAFT", "REVISION", "QUOTE_SENT"];

export function canSetExpiry(
  status: string,
  date: Date,
  now: Date = new Date(),
): { ok: true } | { ok: false; message: string } {
  if (!OPEN_STATUSES.includes(status)) {
    return { ok: false, message: "The expiry can only change while the quote is a draft, in revision, or sent." };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (day < today) return { ok: false, message: "Pick today or a later date." };
  return { ok: true };
}
