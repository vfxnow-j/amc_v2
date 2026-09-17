import React from "react";
import { getServerLogoDataUri } from "@/lib/actions/documents";
import { sendEmail, type EmailAttachment } from "@/lib/email/send";
import {
  depreciationReportEmail,
  inventoryReportEmail,
  type InventoryReportCategory,
  type RenderedEmail,
} from "@/lib/email/templates";
import { moneyExact } from "@/lib/format";
import { buildDepreciationReport, depreciationCsv, type DepreciationReport } from "@/lib/inventory/depreciation-report";
import { getInventorySnapshot, type InventorySnapshotCategory } from "@/lib/inventory/snapshot";
import { recipientsFor } from "@/lib/notifications/recipients";
import type { SendOutcome } from "@/lib/notifications/outbound";
import { REPORTS, type InventoryOptions } from "@/lib/notifications/reports/registry";
import { describeSchedule, type Schedule } from "@/lib/notifications/reports/schedule";
import { renderPdf } from "@/lib/notifications/reports/pdf";

/**
 * The two attachment-carrying reports: inventory (ported from v1) and
 * depreciation (new in v2). Each is a `build*` that returns the finished
 * message and its attachments without sending — so Send now, the scheduler and
 * the template gallery all show the same thing — and a `send*` that mails it
 * one recipient at a time (Resend's batch endpoint takes no attachments).
 */

export type BuiltReport = { message: RenderedEmail; attachments: EmailAttachment[]; detail: Record<string, unknown> };

async function mailEach(emails: string[], built: BuiltReport): Promise<SendOutcome> {
  let sent = 0;
  let error: string | undefined;
  for (const to of emails) {
    const result = await sendEmail({ to, ...built.message, attachments: built.attachments });
    if (result.success) sent += 1;
    else error ??= result.error;
  }
  return { sent, recipients: emails.length, error };
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/**
 * Keep the rows a salesperson cares about most — anything moving first, then
 * the deepest stock — within `maxRows`. Category totals stay category-wide, and
 * the PDF has every row. v1's rule, unchanged.
 */
function trimForEmail(categories: InventorySnapshotCategory[], maxRows: number) {
  const total = categories.reduce((sum, category) => sum + category.rows.length, 0);
  const keep = new Set(
    categories
      .flatMap((category) => category.rows.map((row) => ({ id: row.assetId, score: (row.goingOut + row.lateToShip + row.comingBack + row.quoted) * 1000 + row.inStock })))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxRows)
      .map((row) => row.id),
  );
  const trimmed: InventoryReportCategory[] = [];
  for (const category of categories) {
    const rows = category.rows.filter((row) => keep.has(row.assetId));
    if (rows.length === 0) continue;
    trimmed.push({
      category: category.category,
      rows: rows.map((row) => ({
        assetName: row.assetName,
        detail: [row.manufacturer, row.model].filter(Boolean).join(" · "),
        inStock: row.inStock,
        out: row.out,
        goingOut: row.goingOut + row.lateToShip,
        comingBack: row.comingBack,
        monthlyRate: row.monthlyRate,
      })),
      totals: { inStock: category.totals.inStock, out: category.totals.out },
    });
  }
  const shown = trimmed.reduce((sum, category) => sum + category.rows.length, 0);
  return { categories: trimmed, shown, total };
}

export async function buildInventoryReport(schedule: Schedule & Partial<InventoryOptions>): Promise<BuiltReport> {
  const options = { ...REPORTS.inventory.defaults, ...schedule } as Schedule & InventoryOptions;
  const snapshot = await getInventorySnapshot({ horizonDays: options.horizonDays });
  const trimmed = trimForEmail(snapshot.categories, options.maxEmailRows);

  const attachments: EmailAttachment[] = [];
  if (options.attachPdf) {
    try {
      const { InventorySnapshotPDF } = await import("@/components/documents/inventory-snapshot-pdf");
      const content = await renderPdf(React.createElement(InventorySnapshotPDF, { data: snapshot, title: options.title, logoDataUri: await getServerLogoDataUri() }));
      attachments.push({ filename: `inventory-report-${today()}.pdf`, content, contentType: "application/pdf" });
    } catch (error) {
      // The HTML body stands alone; a PDF failure must not cost the email.
      console.error("Inventory report PDF failed, sending without it:", error);
    }
  }

  const s = snapshot.summary;
  const message = inventoryReportEmail({
    title: options.title,
    generatedAtLabel: snapshot.generatedAtLabel,
    horizonLabel: snapshot.horizonLabel,
    horizonDays: snapshot.horizonDays,
    cadenceNote: describeSchedule(options),
    summary: { totalUnits: s.totalUnits, inStock: s.inStock, out: s.out, goingOut: s.goingOut + s.lateToShip, comingBack: s.comingBack, utilizationPercent: s.utilizationPercent },
    categories: trimmed.categories,
    truncated: trimmed.shown < trimmed.total ? { shown: trimmed.shown, total: trimmed.total } : undefined,
    hasAttachment: attachments.length > 0,
  });
  return { message, attachments, detail: { units: s.totalUnits, models: trimmed.total, pdf: attachments.length > 0 } };
}

export async function sendInventoryReport(schedule: Schedule & Partial<InventoryOptions>): Promise<SendOutcome & { detail: Record<string, unknown> }> {
  const emails = await recipientsFor("inventory");
  const built = await buildInventoryReport(schedule);
  return { ...(await mailEach(emails, built)), detail: built.detail };
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

/** The report's own account of its method and its data, measured on this run. */
export function depreciationNotes(report: DepreciationReport): string[] {
  const n = report.notes;
  const v = report.totals.valuedUnits;
  return [
    "Straight-line from the date a unit was received, or its purchase date when no receipt is recorded, down to the model's salvage value; a month is 30 days, counted in whole months. The same schedule the model and unit records show.",
    `${n.fromPurchaseDate} of ${v} valued units have no received date, so their schedule runs from the purchase date.`,
    `${n.defaultLife} of ${v} use a 60-month life, which is the schema default — for most models nobody chose it. ${n.withSalvage} ${n.withSalvage === 1 ? "has" : "have"} a salvage value; the rest depreciate to zero.`,
    `${n.purchaseDateIsRecordDate} of ${v} have a purchase date on the day their record was created, which may be when they were entered rather than bought.`,
    "Period expense is book value at the start of the period less book value at its end, over today's fleet. Units sold or retired during the period are not in it.",
    "Lease and loan financing is not reflected: AssetUnit.loanAmount holds the whole lease on every unit and is never summed.",
  ];
}

export function depreciationEmail(report: DepreciationReport, schedule: Schedule, attachments: string[]): RenderedEmail {
  const shownGroups = report.groups.slice(0, 15);
  const rest = report.groups.slice(15);
  const reasons = Object.entries(
    report.excluded.reduce<Record<string, number>>((acc, unit) => ({ ...acc, [unit.reason]: (acc[unit.reason] ?? 0) + 1 }), {}),
  ).map(([reason, count]) => `${reason.toLowerCase()}: ${count}`);
  return depreciationReportEmail({
    asOfLabel: DAY.format(report.asOf),
    periodLabel: report.period.label,
    cadenceNote: describeSchedule(schedule),
    totals: report.totals,
    groups: shownGroups,
    otherGroups: rest.length
      ? {
          count: rest.length,
          cost: rest.reduce((sum, g) => sum + g.cost, 0),
          accumulated: rest.reduce((sum, g) => sum + g.accumulated, 0),
          book: rest.reduce((sum, g) => sum + g.book, 0),
          periodExpense: rest.reduce((sum, g) => sum + g.periodExpense, 0),
        }
      : null,
    soon: report.fullyDepreciatingSoon.slice(0, 12).map((unit) => ({ barcode: unit.barcode, model: unit.model, on: DAY.format(unit.fullyDepreciatedOn), book: unit.book })),
    soonMore: Math.max(0, report.fullyDepreciatingSoon.length - 12),
    excluded: { count: report.excluded.length, reasons },
    notes: depreciationNotes(report),
    attachments,
  });
}

export async function composeDepreciationReport(schedule: Schedule): Promise<BuiltReport> {
  const report = await buildDepreciationReport(schedule.frequency);
  const stamp = today();
  const attachments: EmailAttachment[] = [
    { filename: `depreciation-schedule-${stamp}.csv`, content: Buffer.from(depreciationCsv(report), "utf8"), contentType: "text/csv" },
  ];
  try {
    const { DepreciationReportPDF } = await import("@/components/documents/depreciation-report-pdf");
    const content = await renderPdf(React.createElement(DepreciationReportPDF, { report, notes: depreciationNotes(report), logoDataUri: await getServerLogoDataUri() }));
    attachments.unshift({ filename: `depreciation-report-${stamp}.pdf`, content, contentType: "application/pdf" });
  } catch (error) {
    console.error("Depreciation report PDF failed, sending the CSV only:", error);
  }
  const message = depreciationEmail(
    report,
    schedule,
    attachments.map((a) => (a.contentType === "text/csv" ? "a CSV of every valued unit" : "the full report as a PDF")),
  );
  return {
    message,
    attachments,
    detail: { valued: report.totals.valuedUnits, excluded: report.excluded.length, book: moneyExact(report.totals.book), periodExpense: moneyExact(report.totals.periodExpense), period: report.period.label, pdf: attachments.length > 1 },
  };
}

export async function sendDepreciationReport(schedule: Schedule): Promise<SendOutcome & { detail: Record<string, unknown> }> {
  const emails = await recipientsFor("depreciation");
  const built = await composeDepreciationReport(schedule);
  return { ...(await mailEach(emails, built)), detail: built.detail };
}

