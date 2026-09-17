import type { RecipientCategory } from "@/lib/notifications/recipients-schema";
import type { Schedule } from "@/lib/notifications/reports/schedule";

/**
 * The scheduled reports: what each is, who it goes to, where its schedule is
 * kept and when it goes out by default.
 *
 * One registry so the settings screen, `/api/cron/reports` and "Send now" can't
 * disagree about what exists. Each report's *runner* — the code that builds and
 * mails it — is in `run.ts`, keyed the same way; this file is Prisma-free so the
 * schedule form can read it.
 *
 * **Where schedules live.** In `Setting` rows. The inventory report keeps v1's
 * key, `inventory_report_settings`, because v1 already stores a schedule there
 * (weekly, Monday 11:00 PT on 2026-09-16) and a refresh from v1 brings it; the
 * others are v2's own `report_schedule:<key>` rows. What was last sent is
 * `report_sent:<key>`.
 *
 * Defaults are v1's own times where v1 has a cron for the report (its crontab
 * sends the day at a glance Mon–Sat 9:00, the weekly report Sunday 12:30 and
 * traffic at 17:00); v2's cadences have no "Mon–Sat" or half-hours, so those
 * become daily 9:00 and Sunday 12:00.
 */

export const REPORT_KEYS = [
  "dayAtAGlance",
  "weekly",
  "traffic",
  "coverage",
  "inventory",
  "depreciation",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export type InventoryOptions = {
  /** Days of forward look for planned movement. */
  horizonDays: number;
  /** Attach the full list as a branded PDF. */
  attachPdf: boolean;
  /** Rows shown in the email body; the PDF always has all. */
  maxEmailRows: number;
  /** Subject, heading and PDF title. */
  title: string;
};

export type ReportDefinition = {
  key: ReportKey;
  label: string;
  what: string;
  category: RecipientCategory;
  settingKey: string;
  defaults: Schedule & Partial<InventoryOptions>;
};

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  dayAtAGlance: {
    key: "dayAtAGlance",
    label: "Day at a glance",
    what: "Today's orders starting, shipping and due back, what to act on, and the snapshot.",
    category: "insights",
    settingKey: "report_schedule:dayAtAGlance",
    defaults: { enabled: true, frequency: "DAILY", dayOfWeek: 1, dayOfMonth: 1, hour: 9 },
  },
  weekly: {
    key: "weekly",
    label: "Weekly report",
    what: "Last week against the week before, the week ahead, the snapshot and insights.",
    category: "insights",
    settingKey: "report_schedule:weekly",
    defaults: { enabled: true, frequency: "WEEKLY", dayOfWeek: 0, dayOfMonth: 1, hour: 12 },
  },
  traffic: {
    key: "traffic",
    label: "Daily traffic report",
    what: "Units checked out and returned today, grouped by client.",
    category: "traffic",
    settingKey: "report_schedule:traffic",
    defaults: { enabled: true, frequency: "DAILY", dayOfWeek: 1, dayOfMonth: 1, hour: 17 },
  },
  coverage: {
    key: "coverage",
    label: "Coverage expiring",
    what: "Service coverages ending within 30 days. Sends nothing when none are, and repeats a coverage at most weekly.",
    category: "coverage",
    settingKey: "report_schedule:coverage",
    defaults: { enabled: true, frequency: "DAILY", dayOfWeek: 1, dayOfMonth: 1, hour: 7 },
  },
  inventory: {
    key: "inventory",
    label: "Inventory report",
    what: "Stock by model, what is going out and coming back inside the outlook window, and monthly rates, with the full list as a PDF.",
    category: "inventory",
    settingKey: "inventory_report_settings",
    defaults: {
      enabled: true,
      frequency: "WEEKLY",
      dayOfWeek: 1,
      dayOfMonth: 1,
      hour: 8,
      horizonDays: 14,
      attachPdf: true,
      maxEmailRows: 40,
      title: "Inventory Report",
    },
  },
  depreciation: {
    key: "depreciation",
    label: "Depreciation report",
    what: "Cost, accumulated depreciation and net book value by family, the period's expense, and units fully depreciated or about to be. PDF and CSV attached.",
    category: "depreciation",
    settingKey: "report_schedule:depreciation",
    defaults: { enabled: true, frequency: "MONTHLY", dayOfWeek: 1, dayOfMonth: 1, hour: 8 },
  },
};

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === "string" && (REPORT_KEYS as readonly string[]).includes(value);
}

export function sentKey(key: ReportKey): string {
  return `report_sent:${key}`;
}
