import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { previewable } from "@/lib/email/layout";
import { TEMPLATE_SAMPLES, sampleFor, type TemplateGroup } from "@/lib/email/samples";
import { getSessionUser } from "@/lib/roles";
import { SendSampleForm } from "./send-sample-form";

export const metadata = { title: "Email templates" };

const GROUPS: TemplateGroup[] = ["Layout", "Orders & quotes", "Procurement", "Digests & reports", "Clients", "People", "Security"];

/**
 * Settings → Notifications → Email templates. Admins only.
 *
 * Every message the app can send, rendered with obviously-sample data in the
 * real layout — one at a time, chosen by `?t=`, so the page carries one email's
 * HTML rather than thirty-five. The preview is a sandboxed iframe (no scripts,
 * no same-origin), and the inline logo's `cid:` is swapped for the `/brand`
 * file so the browser can draw it. Nothing here is sent unless "Send me a
 * sample" is pressed, and that goes to the signed-in admin through the redirect.
 */
export default async function EmailTemplatesPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") redirect("/dashboard/settings/notifications");

  const { t } = await searchParams;
  const sample = sampleFor(t ?? "") ?? TEMPLATE_SAMPLES[0];
  const message = sample.render();

  return (
    <>
      <PageHeader
        eyebrow="Settings · Notifications"
        title="Email templates"
        blurb={`${TEMPLATE_SAMPLES.length} messages the app sends, with sample data in the real layout.`}
        actions={
          <Link
            href="/dashboard/settings/notifications"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
          >
            Back to notifications
          </Link>
        }
      />
      <div className="grid shrink-0 items-start gap-3 lg:grid-cols-[280px_1fr]">
        <Card title="Templates" className="shrink-0">
          <nav aria-label="Email templates" className="flex flex-col gap-3 px-2 pb-3">
            {GROUPS.map((group) => (
              <div key={group}>
                <p className="px-2 pb-1 text-micro uppercase text-ink-muted">{group}</p>
                <ul className="flex flex-col gap-px">
                  {TEMPLATE_SAMPLES.filter((item) => item.group === group).map((item) => (
                    <li key={item.key}>
                      <Link
                        href={`/dashboard/settings/notifications/templates?t=${item.key}`}
                        aria-current={item.key === sample.key ? "page" : undefined}
                        className={`block rounded-row px-2 py-[5px] text-body ${item.key === sample.key ? "bg-accent-tint font-bold text-accent-on-tint" : "hover:bg-row-hover"}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>

        <Card title={sample.label} meta={sample.group} className="shrink-0">
          <dl className="mx-4 mb-3 grid gap-x-4 gap-y-1 text-detail sm:grid-cols-[90px_1fr]">
            <dt className="text-ink-muted">Subject</dt>
            <dd className="font-bold">{message.subject}</dd>
            <dt className="text-ink-muted">Goes to</dt>
            <dd>{sample.who}</dd>
            <dt className="text-ink-muted">Sent when</dt>
            <dd>{sample.when}</dd>
          </dl>
          <div className="mx-4 mb-3">
            <SendSampleForm template={sample.key} />
          </div>
          <iframe
            title={`Preview of ${sample.label}`}
            srcDoc={previewable(message.html)}
            sandbox=""
            className="mx-4 mb-4 h-[900px] w-[calc(100%-2rem)] rounded-well border border-hairline bg-white"
          />
          <details className="mx-4 mb-4 text-detail">
            <summary className="cursor-pointer text-ink-muted">Plain-text version</summary>
            <pre className="mt-2 max-h-[400px] overflow-auto whitespace-pre-wrap rounded-well bg-sunken p-3 font-mono text-detail">{message.text}</pre>
          </details>
        </Card>
      </div>
    </>
  );
}
