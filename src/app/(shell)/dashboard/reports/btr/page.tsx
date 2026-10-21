import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardSkeleton } from "@/components/record/record-card";
import { BackToReports } from "@/components/reports/directory";
import { BtrSend } from "@/components/reports/btr-send";
import { requireAdmin } from "@/lib/auth-utils";
import { buildBtrReport } from "@/lib/notifications/reports/btr";

export const metadata = { title: "BT Report" };

/**
 * Reports → BT Report.
 *
 * The email, drawn as it will arrive, with a way to send it to yourself. The
 * schedule and who receives it live in Settings → Notifications (tick BTR on a
 * recipient, then switch the report on). Admin only, like the Forecast it draws
 * from.
 */
export default function BtrPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="BT Report"
        blurb="The monthly snapshot as it is emailed: this month's revenue (active orders) and projected (quotes), value out and in (monthly rate of units on rent and in stock) and utilization % by category, with the forecast workbook and inventory PDF attached."
        actions={<BackToReports />}
      />
      <Suspense fallback={<CardSkeleton title="Preview" rows={10} />}>
        <Preview />
      </Suspense>
    </>
  );
}

async function Preview() {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return (
      <Card title="BT Report">
        <p className="px-4 pb-3 text-body text-ink-muted">Only an admin can build the BT Report.</p>
      </Card>
    );
  }
  const built = await buildBtrReport();
  // The inline logo is a cid: in the mail; a preview has the file instead.
  const html = built.message.html.replaceAll("cid:vfxnow-logo", "/brand/email-logo-white.png");
  return (
    <>
      <Card title="Send it" meta="to one address, whether or not it is ticked for BTR">
        <div className="flex flex-col gap-2 px-4 pb-3">
          <BtrSend />
          <p className="text-detail text-ink-muted">
            Subject: {built.message.subject}. Attached: {built.attachments.map((a) => a.filename).join(", ") || "nothing"}.{" "}
            Who receives it on a schedule, and when, is set in{" "}
            <Link href="/dashboard/settings/notifications" className="text-accent-text hover:underline">
              Settings → Notifications
            </Link>
            .{" "}
            <a href="/api/reports/forecast?period=month" className="text-accent-text hover:underline">
              Download the forecast workbook
            </a>
            .
          </p>
        </div>
      </Card>
      <Card title="Preview">
        <iframe title="BT Report preview" srcDoc={html} className="h-[1100px] w-full rounded-card border-0 bg-white" />
      </Card>
    </>
  );
}
