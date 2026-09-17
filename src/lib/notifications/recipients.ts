import { prisma } from "@/lib/prisma";
import {
  RECIPIENT_CATEGORIES,
  isAddress,
  normalizeAddress,
  normalizeRecipients,
  receives,
  type NotificationRecipient,
  type RecipientCategory,
} from "@/lib/notifications/recipients-schema";

/**
 * Reading and writing the `notification_recipients` setting.
 *
 * The one place that answers "who gets this category", so every sender asks the
 * same question the same way — `notifyFundingRequestSubmitted` used to read the
 * row itself because the shared helper's category list predated funding.
 *
 * No auth here: this is a server-only module, not a `"use server"` one, so
 * nothing in it is reachable by POST. The admin check lives in the action that
 * calls `saveRecipients`.
 */

export const RECIPIENTS_KEY = "notification_recipients";

export async function readRecipients(): Promise<NotificationRecipient[]> {
  const setting = await prisma.setting.findUnique({
    where: { key: RECIPIENTS_KEY },
    select: { value: true },
  });
  return normalizeRecipients(setting?.value);
}

/** Addresses ticked for a category, lower-cased and de-duplicated. */
export async function recipientsFor(category: RecipientCategory): Promise<string[]> {
  const list = await readRecipients();
  return [
    ...new Set(
      list
        .filter((entry) => receives(entry, category))
        .map((entry) => normalizeAddress(entry.email)),
    ),
  ];
}

export type RecipientInput = {
  email: string;
  name?: string;
  categories: Partial<Record<RecipientCategory, boolean>>;
};

export type SaveRecipientsResult =
  | { ok: true; saved: number }
  | { ok: false; error: string };

/**
 * Replace the list with what the editor sent, keeping what it doesn't know.
 *
 * Merged by address against the stored row: keys this version doesn't
 * recognise are carried over, so an edit here never strips a key v1 (or a later
 * v2) put on the entry. Every known category is written explicitly — true or
 * false — so a saved `coverage` stops inheriting from `reservations`.
 */
export async function saveRecipients(input: RecipientInput[]): Promise<SaveRecipientsResult> {
  if (input.length > 100) return { ok: false, error: "That is more than 100 addresses." };

  const seen = new Set<string>();
  for (const row of input) {
    const email = row.email.trim();
    if (!isAddress(email)) return { ok: false, error: `"${email || "(blank)"}" is not an email address.` };
    const key = normalizeAddress(email);
    if (seen.has(key)) return { ok: false, error: `${email} is listed twice.` };
    seen.add(key);
  }

  const stored = await readRecipients();
  const byAddress = new Map(stored.map((entry) => [normalizeAddress(entry.email), entry]));

  const next: NotificationRecipient[] = input.map((row) => {
    const previous = byAddress.get(normalizeAddress(row.email)) ?? {};
    const entry: NotificationRecipient = { ...previous, email: row.email.trim() };
    const name = row.name?.trim().slice(0, 80);
    if (name) entry.name = name;
    else delete entry.name;
    for (const category of RECIPIENT_CATEGORIES) {
      entry[category] = row.categories[category] === true;
    }
    return entry;
  });

  await prisma.setting.upsert({
    where: { key: RECIPIENTS_KEY },
    update: { value: next as object[] },
    create: { key: RECIPIENTS_KEY, value: next as object[] },
  });
  return { ok: true, saved: next.length };
}
