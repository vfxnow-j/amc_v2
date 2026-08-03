import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { CardSkeleton } from "@/components/record/record-card";
import {
  ActivityCard,
  DeskCard,
  DetailsCard,
  OutcomeCard,
  PipelineCard,
  isResolved,
} from "@/components/leads/record-cards";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/lib/clients/labels";
import { dayYear, money } from "@/lib/format";
import { getLeadHeader } from "@/lib/queries/lead-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const lead = await getLeadHeader(id);
  return { title: lead?.name ?? "Lead" };
}

/**
 * Clients → Leads → the record.
 *
 * The list's rows have pointed nowhere since it shipped; this is where they
 * point. Its job is the two things the list can only report on: what has
 * actually been done about an enquiry, and how it stops being one.
 *
 * **v1's kanban is not carried across.** It is a second rendering of the same
 * query with no drag — every card is a link to this screen — so it adds a
 * layout, not a capability. The two things it showed that the list didn't are
 * kept: the pipeline value per stage is in the list's header, and staleness is
 * the "days in this stage" on the card below, measured properly from the last
 * status change rather than from `updatedAt`.
 *
 * A card per Suspense boundary. Conversion loads every live order for its
 * picker and is the slowest thing here — it must never hold up the activity
 * log, which is the reason most people open this screen.
 */
export default async function LeadRecordPage({ params }: Params) {
  const { id } = await params;
  const lead = await getLeadHeader(id);
  if (!lead) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Clients · Lead"
        title={lead.name}
        blurb={
          <>
            {lead.companyName ? `${lead.companyName} · ` : ""}
            {LEAD_SOURCE_LABEL[lead.source]}
            {lead.channel ? ` · ${lead.channel}` : ""} · in since{" "}
            {dayYear(lead.createdAt)}
            {lead.value === null ? "" : ` · ${money(lead.value)} estimated`}
          </>
        }
        actions={
          <>
            {lead.owner === null && !isResolved(lead.status) ? (
              // The single failure this cluster exists to catch, said on the
              // record as loudly as it is said on the list.
              <span className="rounded-pill bg-accent-tint px-3 py-1 text-pill text-accent-on-tint">
                Unassigned
              </span>
            ) : null}
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {LEAD_STATUS_LABEL[lead.status]}
            </span>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Pipeline" rows={2} />}>
            <PipelineCard lead={lead} />
          </Suspense>
          <DetailsCard lead={lead} />
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Activity" rows={8} />}>
            <ActivityCard id={lead.id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Working it" rows={5} />}>
            <DeskCard lead={lead} />
          </Suspense>
          <Suspense
            fallback={
              <CardSkeleton
                title={isResolved(lead.status) ? "Outcome" : "Convert"}
                rows={5}
              />
            }
          >
            <OutcomeCard lead={lead} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
