import React from "react";
import { getServerLogoDataUri } from "@/lib/actions/documents";
import { sendEmail, type EmailAttachment } from "@/lib/email/send";
import { btrReportEmail } from "@/lib/email/templates";
import { businessToday } from "@/lib/billing/calendar";
import { buildForecastWorkbook } from "@/lib/forecast/export";
import { getInventorySnapshot } from "@/lib/inventory/snapshot";
import { monthKey } from "@/lib/forecast/schedule";
import { BOOKED_STREAMS, EXPECTED_STREAMS, getForecast } from "@/lib/queries/forecast";
import { recipientsFor } from "@/lib/notifications/recipients";
import type { SendOutcome } from "@/lib/notifications/outbound";
import { describeSchedule, type Schedule } from "@/lib/notifications/reports/schedule";
import { renderPdf } from "@/lib/notifications/reports/pdf";
import type { BuiltReport } from "@/lib/notifications/reports/reports";

/**
 * The BT Report: booked and expected revenue, general utilization and the
 * inventory list, as one HTML email with the forecast workbook and the
 * inventory PDF attached.
 *
 * Built from the same `getForecast` and `getInventorySnapshot` the Forecast and
 * Inventory screens use, so the email cannot disagree with them. `build*`
 * returns the finished message without sending (the Reports page previews it);
 * the senders mail it one recipient at a time, because Resend's batch endpoint
 * takes no attachments.
 */

const HORIZON_DAYS = 14;
const stamp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

export async function buildBtrReport(schedule: Schedule | null = null): Promise<BuiltReport> {
  const now = new Date();
  const [forecast, snapshot] = await Promise.all([getForecast(now), getInventorySnapshot({ horizonDays: HORIZON_DAYS })]);

  const sum = (streams: readonly (typeof BOOKED_STREAMS)[number][], month: string) =>
    streams.reduce((total, stream) => total + (forecast.revenue[stream]?.[month] ?? 0), 0);
  // This month only: a snapshot, not a horizon.
  const key = monthKey(now);
  const current = forecast.months.find((m) => m.key === key) ?? forecast.months[0];
  const revenue = current ? sum(BOOKED_STREAMS, current.key) : 0;
  // Open quotes, one version per deal (the forecast's own de-duplication),
  // weighted by stage. Drafts are not part of this report.
  const projected = forecast.deals
    .flatMap((d) => d.orders)
    .filter((o) => o.counted && o.status !== "DRAFT")
    .reduce((total, o) => total + (o.byMonth[key] ?? 0) * o.weight, 0);
  const s = snapshot.summary;

  const attachments: EmailAttachment[] = [];
  try {
    const workbook = await buildForecastWorkbook(forecast, "month", businessToday(now));
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    attachments.push({
      filename: `forecast-${stamp()}.xlsx`,
      content,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  } catch (error) {
    console.error("BT Report forecast workbook failed, sending without it:", error);
  }
  try {
    const { InventorySnapshotPDF } = await import("@/components/documents/inventory-snapshot-pdf");
    const content = await renderPdf(
      React.createElement(InventorySnapshotPDF, { data: snapshot, title: "Inventory", logoDataUri: await getServerLogoDataUri() }),
    );
    attachments.push({ filename: `inventory-${stamp()}.pdf`, content, contentType: "application/pdf" });
  } catch (error) {
    console.error("BT Report inventory PDF failed, sending without it:", error);
  }

  const message = btrReportEmail({
    generatedAtLabel: snapshot.generatedAtLabel,
    cadenceNote: schedule ? describeSchedule(schedule) : "",
    month: { label: current?.label ?? key, revenue, projected },
    value: { out: s.monthlyRateOut, in: s.monthlyRateAvailable },
    utilizationPercent: s.utilizationPercent,
    categories: snapshot.categories
      .filter((c) => c.totals.totalUnits > 0)
      .map((c) => ({ name: c.category, percent: Math.round((c.totals.out / c.totals.totalUnits) * 100) })),
    attachments: attachments.map((a) => (a.filename.endsWith(".xlsx") ? "this month's forecast workbook (Excel)" : "the full inventory list (PDF)")),
  });
  return {
    message,
    attachments,
    detail: { revenue: Math.round(revenue), projected: Math.round(projected), units: s.totalUnits, attachments: attachments.length },
  };
}

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

/** To everyone ticked for BTR — the scheduled and Send-now path. */
export async function sendBtrReport(schedule: Schedule): Promise<SendOutcome & { detail: Record<string, unknown> }> {
  const emails = await recipientsFor("btr");
  const built = await buildBtrReport(schedule);
  return { ...(await mailEach(emails, built)), detail: built.detail };
}

/** To one address, whether or not it is ticked — "Send to me" on the report page. */
export async function sendBtrReportTo(email: string): Promise<SendOutcome & { detail: Record<string, unknown> }> {
  const built = await buildBtrReport();
  return { ...(await mailEach([email], built)), detail: built.detail };
}
