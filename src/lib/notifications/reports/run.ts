import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured } from "@/lib/email/client";
import { recipientsFor } from "@/lib/notifications/recipients";
import {
  notifyDailyDigest,
  notifyDailyTrafficReport,
  notifyWeeklyReport,
  sendCoverageExpiryNotifications,
  type SendOutcome,
} from "@/lib/notifications/outbound";
import {
  REPORTS,
  REPORT_KEYS,
  sentKey,
  type InventoryOptions,
  type ReportDefinition,
  type ReportKey,
} from "@/lib/notifications/reports/registry";
import { isDue, normalizeSchedule, pacificParts, type Schedule } from "@/lib/notifications/reports/schedule";
import { raiseNotifications, type RaiseResult } from "@/lib/notifications/raise";
import { sendNotificationDigests, type DigestRun } from "@/lib/notifications/digest-email";
import { sendDepreciationReport, sendInventoryReport } from "@/lib/notifications/reports/reports";
import { refreshUnitRevenue } from "@/lib/utils/revenue";

/**
 * Running the scheduled reports: reading schedules, deciding what is due,
 * claiming an occurrence so it is sent once, and recording what happened.
 *
 * Server-only and not `"use server"`: the admin action and the cron route are
 * the two doors, and each checks its own credential before calling in here.
 */

export type ReportSchedule = Schedule & Partial<InventoryOptions>;

export type RunRecord = {
  at: string;
  sent: number;
  recipients: number;
  error?: string;
  /** Why nothing went: "no-recipients", "nothing-to-report". */
  skipped?: string;
  /** Report-specific figures, e.g. unit counts. */
  detail?: Record<string, unknown>;
  by?: string;
};

/** The `report_sent:<key>` row. */
export type SentState = {
  /** The last occurrence claimed and not released — "2026-09-16". */
  occurrence: string | null;
  /** The occurrence before it, restored if a claimed run delivers nothing. */
  previous?: string | null;
  scheduled?: RunRecord;
  manual?: RunRecord;
};

export async function readSchedule(key: ReportKey): Promise<ReportSchedule> {
  const def = REPORTS[key];
  const row = await prisma.setting.findUnique({ where: { key: def.settingKey }, select: { value: true } });
  return normalizeSchedule(row?.value, def.defaults);
}

export async function saveSchedule(key: ReportKey, schedule: ReportSchedule): Promise<ReportSchedule> {
  const def = REPORTS[key];
  const current = await prisma.setting.findUnique({ where: { key: def.settingKey }, select: { value: true } });
  // Merged over what is stored, so keys this screen doesn't edit — anything v1
  // keeps on `inventory_report_settings` — survive.
  const stored = current?.value && typeof current.value === "object" ? (current.value as Record<string, unknown>) : {};
  const clean = normalizeSchedule({ ...stored, ...schedule }, def.defaults);
  await prisma.setting.upsert({
    where: { key: def.settingKey },
    update: { value: clean },
    create: { key: def.settingKey, value: clean },
  });
  return clean;
}

export async function readSentState(key: ReportKey): Promise<SentState> {
  const row = await prisma.setting.findUnique({ where: { key: sentKey(key) }, select: { value: true } });
  const value = (row?.value ?? {}) as Partial<SentState>;
  return { ...value, occurrence: typeof value.occurrence === "string" ? value.occurrence : null };
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export type RunResult = SendOutcome & { skipped?: string; detail?: Record<string, unknown> };

type Runner = (def: ReportDefinition, schedule: ReportSchedule) => Promise<RunResult>;

/** Recipients are checked first so an empty list costs no queries and says why. */
async function withRecipients(def: ReportDefinition, run: () => Promise<RunResult>): Promise<RunResult> {
  const recipients = await recipientsFor(def.category);
  if (recipients.length === 0) return { sent: 0, recipients: 0, skipped: "no-recipients" };
  return run();
}

const RUNNERS: Partial<Record<ReportKey, Runner>> = {
  dayAtAGlance: (def) => withRecipients(def, () => notifyDailyDigest()),
  weekly: (def) =>
    withRecipients(def, async () => {
      const { insights, ...outcome } = await notifyWeeklyReport();
      return { ...outcome, detail: { insights } };
    }),
  traffic: (def) =>
    withRecipients(def, async () => {
      const { outCount, inCount, ...outcome } = await notifyDailyTrafficReport();
      return { ...outcome, detail: { out: outCount, in: inCount } };
    }),
  coverage: (def) =>
    withRecipients(def, async () => {
      const { coverages, ...outcome } = await sendCoverageExpiryNotifications();
      return coverages === 0 ? { ...outcome, skipped: "nothing-to-report", detail: { coverages } } : { ...outcome, detail: { coverages } };
    }),
  inventory: (def, schedule) => withRecipients(def, () => sendInventoryReport(schedule)),
  depreciation: (def, schedule) => withRecipients(def, () => sendDepreciationReport(schedule)),
};

async function execute(key: ReportKey, schedule: ReportSchedule): Promise<RunResult> {
  const runner = RUNNERS[key];
  if (!runner) return { sent: 0, recipients: 0, error: "This report has no sender yet." };
  try {
    return await runner(REPORTS[key], schedule);
  } catch (error) {
    console.error(`Report ${key} failed:`, error);
    return { sent: 0, recipients: 0, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

function record(result: RunResult, by?: string): RunRecord {
  return {
    at: new Date().toISOString(),
    sent: result.sent,
    recipients: result.recipients,
    ...(result.error ? { error: result.error } : {}),
    ...(result.skipped ? { skipped: result.skipped } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    ...(by ? { by } : {}),
  };
}

// ---------------------------------------------------------------------------
// Claiming an occurrence
// ---------------------------------------------------------------------------

/**
 * Take this occurrence, or learn that someone already has.
 *
 * One conditional UPDATE: Postgres re-checks the WHERE after taking the row
 * lock, so of two polls racing for "2026-09-16" exactly one gets a row count of
 * 1. The row is created first if it has never existed (the insert is a no-op
 * when it has). Raw SQL because Prisma's JSON filters can't express "is
 * distinct from" on a path.
 */
async function claim(key: ReportKey | "sweep", occurrence: string): Promise<boolean> {
  const name = sentKey(key);
  await prisma.$executeRaw`
    INSERT INTO settings (id, key, value, "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${name}, '{"occurrence": null}'::jsonb, now(), now())
    ON CONFLICT (key) DO NOTHING`;
  const taken = await prisma.$executeRaw`
    UPDATE settings
       SET value = value || jsonb_build_object('occurrence', ${occurrence}::text, 'previous', value->'occurrence'),
           "updatedAt" = now()
     WHERE key = ${name}
       AND (value->>'occurrence') IS DISTINCT FROM ${occurrence}::text`;
  return taken === 1;
}

/** Give a claimed occurrence back, so the next hourly poll tries again. */
async function release(key: ReportKey | "sweep", occurrence: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE settings
       SET value = value || jsonb_build_object('occurrence', value->'previous'),
           "updatedAt" = now()
     WHERE key = ${sentKey(key)}
       AND value->>'occurrence' = ${occurrence}::text`;
}

async function writeRecord(key: ReportKey | "sweep", field: "scheduled" | "manual", run: RunRecord): Promise<void> {
  const name = sentKey(key);
  await prisma.$executeRaw`
    INSERT INTO settings (id, key, value, "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${name}, '{"occurrence": null}'::jsonb, now(), now())
    ON CONFLICT (key) DO NOTHING`;
  await prisma.$executeRaw`
    UPDATE settings
       SET value = value || jsonb_build_object(${field}::text, ${JSON.stringify(run)}::jsonb),
           "updatedAt" = now()
     WHERE key = ${name}`;
}

// ---------------------------------------------------------------------------
// The two doors
// ---------------------------------------------------------------------------

export type ScheduledOutcome =
  | { key: ReportKey; ran: false; reason: string }
  | { key: ReportKey; ran: true; occurrence: string; result: RunResult; released: boolean };

/**
 * Send whatever is due. Called hourly by `/api/cron/reports`.
 *
 * A claimed run that delivered nothing to anyone it meant to — Resend refused,
 * no key, the builder threw — releases its occurrence, so the next poll retries
 * (until the day ends). A run with nobody to send to, or nothing to report,
 * keeps its claim: there is nothing a retry would change.
 */
export async function runDueReports(now: Date = new Date()): Promise<ScheduledOutcome[]> {
  const outcomes: ScheduledOutcome[] = [];
  for (const key of REPORT_KEYS) {
    const [schedule, state] = await Promise.all([readSchedule(key), readSentState(key)]);
    const due = isDue(schedule, state.occurrence, now);
    if (!due.due) {
      outcomes.push({ key, ran: false, reason: due.reason });
      continue;
    }
    if (!(await claim(key, due.occurrence))) {
      outcomes.push({ key, ran: false, reason: "claimed by another run" });
      continue;
    }
    const result = await execute(key, schedule);
    const failed = result.recipients > 0 && result.sent === 0 && !result.skipped;
    if (failed) await release(key, due.occurrence);
    await writeRecord(key, "scheduled", record(result, "schedule"));
    outcomes.push({ key, ran: true, occurrence: due.occurrence, result, released: failed });
  }
  return outcomes;
}

/**
 * Send one report now, regardless of its schedule — "Send now" in Settings, and
 * `?force=` on the cron route.
 *
 * It does not claim or move the scheduled occurrence: pressing Send now at
 * 10:55 does not cancel the 11:00 send. That is stated beside the button.
 */
export async function runReportNow(key: ReportKey, by: string): Promise<RunResult> {
  const schedule = await readSchedule(key);
  const result = await execute(key, schedule);
  await writeRecord(key, "manual", record(result, by));
  return result;
}

/** Said in every response, so a zero is never mistaken for a fault in the data. */
export function emailState() {
  return {
    configured: isEmailConfigured(),
    redirect: process.env.EMAIL_TEST_REDIRECT?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The daily sweep
// ---------------------------------------------------------------------------

/** The hour the in-app sweep runs, Pacific — "the 9am sweep" the preferences screen promises. */
export const SWEEP_HOUR = 9;

export type SweepOutcome =
  | { ran: false; reason: string }
  | { ran: true; raised: RaiseResult | null; digests: DigestRun | null };

/**
 * Raise the day's in-app notifications and send each opted-in person their
 * digest — once per Pacific day, from the first hourly poll at or after 9:00.
 *
 * Not a report and not configurable: it fills everyone's feed, and a feed that
 * depends on an admin's schedule setting is a bell that can silently stop.
 * Claimed like a report occurrence, so it can't double up; released if the
 * raise itself throws, so the next poll tries again.
 */
export async function runDailySweep(now: Date = new Date(), force = false): Promise<SweepOutcome> {
  const p = pacificParts(now);
  if (!force) {
    if (p.hour < SWEEP_HOUR) return { ran: false, reason: "later today" };
    if (!(await claim("sweep", p.dateKey))) return { ran: false, reason: "already ran today" };
  }
  const raised = await raiseNotifications(now).catch((error) => {
    console.error("Raising notifications failed:", error);
    return null;
  });
  if (!raised && !force) await release("sweep", p.dateKey);
  // Each new billing period credits the units still out on it.
  await refreshUnitRevenue(prisma).catch((error) => {
    console.error("Refreshing revenue earned failed:", error);
  });
  // Digests after the raise, so today's items are in today's mail.
  const digests = await sendNotificationDigests().catch((error) => {
    console.error("Notification digests failed:", error);
    return null;
  });
  return { ran: true, raised, digests };
}
