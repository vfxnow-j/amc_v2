import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { FundingDenied } from "@/components/procurement/funding-denied";
import { FundingRequestForm } from "@/components/procurement/funding-request-form";
import {
  FUNDING_LOCKED,
  FUNDING_STATUS_LABEL,
} from "@/lib/procurement/funding-labels";
import { fundingInputFrom } from "@/lib/procurement/funding-input";
import { getFundingFormOptions, getFundingRecord } from "@/lib/queries/funding";
import { getSessionUser } from "@/lib/roles";
import { mayEditFunding } from "@/lib/procurement/access";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const record = await getFundingRecord(id);
  return { title: record ? `Edit ${record.requestNumber}` : "Funding request" };
}

/**
 * Procurement → Funding requests → the record → edit.
 *
 * Open in every state but fulfilled and canceled, which is v1's rule: approval
 * does not freeze the form, because accounting fills the financing half in
 * after approving. The approvals, stamps and attachments are not on it — those
 * are set by the lifecycle controls and the evidence lists on the record, so an
 * edit cannot rewrite who signed off or drop an attached PO.
 */
export default async function EditFundingRequestPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const [record, options] = await Promise.all([getFundingRecord(id), getFundingFormOptions()]);
  if (!record) notFound();

  if (!FUNDING_LOCKED.includes(record.status) && !mayEditFunding(user, record)) {
    return (
      <FundingDenied
        title={`Edit ${record.requestNumber}`}
        role={user.title}
        reason={
          user.role === "STAFF"
            ? record.requestedById === user.id
              ? `${record.requestNumber} has been submitted, so it is no longer a draft to change. Pull it back to draft from the request first.`
              : `${record.requestNumber} was raised by someone else. Staff edit their own draft requests; an administrator can change this one.`
            : undefined
        }
      />
    );
  }

  if (FUNDING_LOCKED.includes(record.status)) {
    return (
      <>
        <PageHeader eyebrow="Procurement · Funding request" title={`Edit ${record.requestNumber}`} />
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            This request is {FUNDING_STATUS_LABEL[record.status].toLowerCase()}, so it is the
            record of what happened and is no longer edited.{" "}
            <Link href={`/dashboard/funding/${id}`} className="text-accent-text hover:underline">
              Back to the request
            </Link>
            .
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Funding request"
        title={`Edit ${record.requestNumber}`}
        blurb={
          record.status === "DRAFT"
            ? "A draft — nothing has gone to accounting yet."
            : `${FUNDING_STATUS_LABEL[record.status]}. Changes are saved to the record; the copy filed at submission is not rewritten.`
        }
      />
      <FundingRequestForm
        requestId={id}
        initial={fundingInputFrom(record)}
        clients={options.clients}
        leases={options.leases}
        cancelHref={`/dashboard/funding/${id}`}
      />
    </>
  );
}
