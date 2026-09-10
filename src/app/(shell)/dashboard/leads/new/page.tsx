import { PageHeader } from "@/components/shell/page-header";
import { LeadForm } from "@/components/leads/lead-form";
import { getLeadAssignees } from "@/lib/actions/leads";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "New lead" };

/**
 * Clients → Leads → record one.
 *
 * The leads in this database all came from v1 or from a webhook, because
 * `createLead` was ported at migration and reachable from nothing — so the
 * enquiry that arrives by phone or at a trade show had nowhere to be written
 * down, and the pipeline figures on the list screen were only ever counting
 * inbound web traffic.
 *
 * Only the name is required. Everything else, attribution included, can be
 * added on the record.
 */
export default async function NewLeadPage() {
  const [assignees, user] = await Promise.all([
    getLeadAssignees(),
    getSessionUser(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="New lead"
        blurb="Only the name is required. If this person is already on file you will be shown their record before a second one is made."
      />
      <LeadForm assignees={assignees} currentUserId={user?.id ?? null} />
    </>
  );
}
