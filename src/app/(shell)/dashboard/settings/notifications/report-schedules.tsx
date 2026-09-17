"use client";

import { useActionState, useState } from "react";
import {
  saveReportScheduleAction,
  sendReportNowAction,
} from "@/lib/actions/notification-settings";
import type { ReportKey } from "@/lib/notifications/reports/registry";
import {
  DAY_NAMES,
  FREQUENCIES,
  FREQUENCY_LABEL,
  describeSchedule,
  hourLabel,
  ordinal,
  type Frequency,
} from "@/lib/notifications/reports/schedule";

/**
 * One row per scheduled report: when it goes, who it goes to, what happened
 * last time, and Send now.
 *
 * Each row is two real forms posting Server Actions — the schedule and Send now
 * — so a save on one report can't carry another's half-edited fields with it.
 * The server re-reads and clamps every value.
 */

export type ReportRow = {
  key: ReportKey;
  label: string;
  what: string;
  categoryLabel: string;
  recipients: number;
  schedule: {
    enabled: boolean;
    frequency: Frequency;
    dayOfWeek: number;
    dayOfMonth: number;
    hour: number;
    horizonDays?: number;
    attachPdf?: boolean;
    maxEmailRows?: number;
    title?: string;
  };
  next: string | null;
  lastScheduled: string | null;
  lastManual: string | null;
};

export function ReportSchedules({ reports }: { reports: ReportRow[] }) {
  return (
    <ul className="flex flex-col gap-2 px-2 pb-3">
      {reports.map((report) => (
        <ReportItem key={report.key} report={report} />
      ))}
    </ul>
  );
}

const FIELD = "h-8 rounded-well bg-sunken px-2 text-body text-ink";

function ReportItem({ report }: { report: ReportRow }) {
  const [saveState, save, saving] = useActionState(saveReportScheduleAction, null);
  const [sendState, send, sending] = useActionState(sendReportNowAction, null);
  const [frequency, setFrequency] = useState<Frequency>(report.schedule.frequency);
  const [enabled, setEnabled] = useState(report.schedule.enabled);

  return (
    <li className="rounded-row border border-hairline px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-card-title">{report.label}</h3>
        <span className="text-detail text-ink-muted">
          to {report.recipients} {report.recipients === 1 ? "address" : "addresses"} ticked for{" "}
          <span className="font-bold">{report.categoryLabel}</span>
        </span>
      </div>
      <p className="mt-1 text-detail text-ink-muted">{report.what}</p>

      <form action={save} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="report" value={report.key} />
        <label className="flex h-8 items-center gap-2 text-body">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-[14px] accent-[var(--accent-solid)]"
          />
          On schedule
        </label>
        <label className="flex flex-col gap-1 text-detail text-ink-muted">
          How often
          <select
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as Frequency)}
            className={FIELD}
          >
            {FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {FREQUENCY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={`flex flex-col gap-1 text-detail text-ink-muted ${frequency === "WEEKLY" || frequency === "BIWEEKLY" ? "" : "hidden"}`}>
          Day
          <select name="dayOfWeek" defaultValue={report.schedule.dayOfWeek} className={FIELD}>
            {DAY_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={`flex flex-col gap-1 text-detail text-ink-muted ${frequency === "MONTHLY" ? "" : "hidden"}`}>
          Day of month
          <select name="dayOfMonth" defaultValue={report.schedule.dayOfMonth} className={FIELD}>
            {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-detail text-ink-muted">
          At (Pacific)
          <select name="hour" defaultValue={report.schedule.hour} className={FIELD}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>

        {report.key === "inventory" ? (
          <>
            <label className="flex flex-col gap-1 text-detail text-ink-muted">
              Outlook (days)
              <input name="horizonDays" type="number" min={1} max={90} defaultValue={report.schedule.horizonDays} className={`${FIELD} w-20`} />
            </label>
            <label className="flex flex-col gap-1 text-detail text-ink-muted">
              Rows in email
              <input name="maxEmailRows" type="number" min={5} max={300} defaultValue={report.schedule.maxEmailRows} className={`${FIELD} w-20`} />
            </label>
            <label className="flex min-w-[180px] flex-col gap-1 text-detail text-ink-muted">
              Title
              <input name="title" maxLength={80} defaultValue={report.schedule.title} className={FIELD} />
            </label>
            <label className="flex h-8 items-center gap-2 text-body">
              <input type="checkbox" name="attachPdf" defaultChecked={report.schedule.attachPdf} className="size-[14px] accent-[var(--accent-solid)]" />
              Attach PDF
            </label>
          </>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
      </form>
      {saveState && !saving ? (
        <p role="status" className={`mt-1 text-detail ${saveState.ok ? "text-ink-muted" : "text-destructive"}`}>
          {saveState.message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-detail text-ink-muted">
        <span>
          {describeSchedule({ ...report.schedule, enabled })}
          {enabled && report.next ? ` Next: ${report.next}.` : ""}
        </span>
        {report.lastScheduled ? <span>Last scheduled: {report.lastScheduled}</span> : null}
        {report.lastManual ? <span>Last sent by hand: {report.lastManual}</span> : null}
      </div>

      <form action={send} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="report" value={report.key} />
        <button
          type="submit"
          disabled={sending}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send now"}
        </button>
        <span className="text-detail text-ink-faint">
          Sends today&rsquo;s report to everyone ticked, now. It doesn&rsquo;t move or cancel the scheduled send.
        </span>
      </form>
      {sendState && !sending ? (
        <p role="status" className={`mt-1 text-detail ${sendState.ok ? "text-ink-muted" : "text-destructive"}`}>
          {sendState.message}
        </p>
      ) : null}
    </li>
  );
}
