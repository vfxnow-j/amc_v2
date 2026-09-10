import Link from "next/link";
import type { LeadStatus } from "@/generated/prisma/client";
import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { LeadDesk } from "@/components/leads/lead-desk";
import { LeadResolve } from "@/components/leads/lead-resolve";
import { RecordOnboarding } from "@/components/leads/record-onboarding";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/lib/clients/labels";
import { dayYear, money } from "@/lib/format";
import {
  getBindCandidates,
  getLeadActivity,
  getLeadOwners,
  getLeadStageSince,
  type LeadHeader,
} from "@/lib/queries/lead-record";

/**
 * The cards the Leads record is built from, composing `components/record`.
 *
 * The record answers three questions in this order: where is this enquiry, who
 * is on it, and how does it stop being an enquiry. Everything else — source,
 * campaign, integration ids — is reference and sits below.
 */

const ACTIVITY_LABEL: Record<string, string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  STATUS_CHANGE: "Status",
  ASSIGNMENT: "Owner",
  SYSTEM: "System",
};

/** Resolved one way or another — the pipeline moves stop making sense. */
export function isResolved(status: LeadStatus) {
  return (
    status === "WON" ||
    status === "BOUND" ||
    status === "LOST" ||
    status === "UNQUALIFIED"
  );
}

/**
 * Where the enquiry has got to.
 *
 * Three lanes, not one: the ordinary run ends at Won, `BOUND` leaves it at
 * Qualified and lands somewhere else entirely, and Lost/Unqualified branch off
 * wherever they were. Drawing all three on one line — which v1 did — implies
 * a bound lead travelled further than it did.
 */
const RUN: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "PROSPECT", "WON"];

export async function PipelineCard({ lead }: { lead: LeadHeader }) {
  const { since: inStageSince, days } = await getLeadStageSince(
    lead.id,
    lead.createdAt,
  );
  const branched =
    lead.status === "LOST" ||
    lead.status === "UNQUALIFIED" ||
    lead.status === "BOUND";
  const reached = branched ? -1 : RUN.indexOf(lead.status);
  // Idle only means something while somebody is still meant to be working it.
  const idle = !isResolved(lead.status) && days >= 5;

  return (
    <Card
      title="Pipeline"
      meta={
        days === 0
          ? "moved today"
          : `${days} ${days === 1 ? "day" : "days"} in this stage`
      }
    >
      <ol className="flex items-center gap-1 px-4 pb-2">
        {RUN.map((stage, index) => {
          const done = reached >= 0 && index < reached;
          const here = reached === index;
          return (
            <li
              key={stage}
              className={`flex-1 rounded-row px-[6px] py-1 text-center text-detail ${
                here
                  ? "bg-accent-tint font-bold text-accent-on-tint"
                  : done
                    ? "bg-sunken text-ink"
                    : "text-ink-faint"
              }`}
            >
              {LEAD_STATUS_LABEL[stage]}
            </li>
          );
        })}
      </ol>

      {branched ? (
        <p className="px-4 pb-2 text-detail">
          <span
            className={
              lead.status === "BOUND"
                ? "font-bold text-accent-text"
                : "font-bold text-destructive"
            }
          >
            {LEAD_STATUS_LABEL[lead.status]}
          </span>
          {lead.status === "BOUND" ? (
            <span className="text-ink-muted">
              {" "}
              — it turned out to be a second contact on business we already
              have, so it left the run rather than finishing it.
            </span>
          ) : lead.lostReason ? (
            <span className="text-ink-muted"> — {lead.lostReason}</span>
          ) : (
            <span className="text-ink-muted">
              {" "}
              — no reason was recorded when it was closed.
            </span>
          )}
        </p>
      ) : null}

      <p className="px-4 pb-4 text-detail text-ink-muted">
        {idle ? (
          <span className="font-bold text-accent-text">
            Nothing has moved since {dayYear(inStageSince)}.{" "}
          </span>
        ) : null}
        Measured from the last recorded status change, not from when the record
        was last edited — fixing a phone number doesn&rsquo;t make a cold lead
        warm.
      </p>
    </Card>
  );
}

export function DetailsCard({ lead }: { lead: LeadHeader }) {
  return (
    <Card title="Details">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Source">{LEAD_SOURCE_LABEL[lead.source]}</Field>
        <Field label="Came in through">
          {lead.channel ?? <Unset>Not recorded</Unset>}
        </Field>
        <Field label="Estimated value">
          {lead.value === null ? (
            <Unset>Nobody has sized it</Unset>
          ) : (
            money(lead.value)
          )}
        </Field>
        <Field label="Sales rep">
          {lead.salesRep ?? <Unset>None named</Unset>}
        </Field>
        <Field label="Email">
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="text-accent-text hover:underline">
              {lead.email}
            </a>
          ) : (
            <Unset>None on file</Unset>
          )}
        </Field>
        <Field label="Phone">
          {lead.phone ? (
            <a href={`tel:${lead.phone}`} className="text-accent-text hover:underline">
              {lead.phone}
            </a>
          ) : (
            <Unset>None on file</Unset>
          )}
        </Field>
        {lead.adPlatform || lead.adCampaign || lead.adCost !== null ? (
          <>
            <Field label="Campaign">
              {lead.adCampaign ?? <Unset>Unnamed</Unset>}
              {lead.adPlatform ? (
                <span className="text-ink-muted"> · {lead.adPlatform}</span>
              ) : null}
            </Field>
            <Field label="Cost to acquire">
              {lead.adCost === null ? <Unset /> : money(lead.adCost)}
            </Field>
          </>
        ) : null}
      </div>

      {lead.notes ? (
        <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
          {lead.notes}
        </p>
      ) : null}

      {/* Both ids are write-once from the inbound webhooks. They are shown
          because a lead that arrived from HubSpot and one keyed in by hand
          behave differently when somebody edits it upstream. */}
      {lead.hubspotContactId || lead.justcallContactId ? (
        <p className="px-4 pb-4 text-detail text-ink-faint">
          {[
            lead.hubspotContactId ? `HubSpot ${lead.hubspotContactId}` : null,
            lead.justcallContactId ? `JustCall ${lead.justcallContactId}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Everything that has happened to this lead.
 *
 * Status changes, reassignments and the record's own creation are in here
 * beside the calls and notes, because `lib/actions/leads` writes a
 * `LeadActivity` row for every one of them — so this is the audit trail, and
 * splitting "what a person did" from "what the system did" would hide that a
 * lead was quietly reassigned three times.
 */
export async function ActivityCard({ id }: { id: string }) {
  const rows = await getLeadActivity(id);

  return (
    <Card
      title="Activity"
      meta={rows.length === 0 ? undefined : `all ${rows.length} shown`}
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Nothing logged against this lead — not even its arrival, which means
          it predates the activity log. Log the next call and the trail starts
          here.
        </CardEmpty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-row px-2 py-[6px] text-detail">
              <span className="flex items-baseline gap-2">
                <span className="flex-none text-micro uppercase text-ink-faint">
                  {ACTIVITY_LABEL[row.type] ?? row.type}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">
                  {row.title}
                </span>
                <span className="flex-none tabular-nums text-ink-muted">
                  {dayYear(row.at)}
                </span>
              </span>
              {row.description ? (
                <span className="block text-ink-muted">{row.description}</span>
              ) : null}
              {row.by ? (
                <span className="block text-ink-faint">{row.by}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Owner, status and the log-it form — the panel somebody works from.
 *
 * "Record onboarding" sits here rather than under Convert because it is not a
 * conversion: it is the fact that arrives from outside and unblocks everything
 * else. With mail off and the Zapier secret unset it is also the only way that
 * fact ever reaches the app, so it is a button on the panel people actually
 * work from and not a menu item.
 */
export async function DeskCard({ lead }: { lead: LeadHeader }) {
  const owners = await getLeadOwners();
  const prospect = !!lead.convertedToClient?.prospectAt;
  // A lead somebody closed does not need an onboarding button — unless a quote
  // is stuck behind a provisional account, which no status makes untrue.
  const offer = prospect || !(lead.status === "LOST" || lead.status === "UNQUALIFIED");

  return (
    <Card
      title="Working it"
      meta={lead.owner?.name ?? "nobody yet"}
    >
      <LeadDesk
        leadId={lead.id}
        status={lead.status}
        ownerId={lead.assignedToId}
        owners={owners}
        resolved={isResolved(lead.status)}
      />

      {offer ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <RecordOnboarding
            leadId={lead.id}
            leadName={lead.name}
            prospect={prospect}
            defaults={{
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              companyName: lead.companyName,
            }}
          />
          <span className="min-w-0 flex-1 text-micro text-ink-faint">
            {prospect
              ? "A quote is held against a provisional account. It cannot be approved or sent until their form is recorded."
              : "For a form that came back by phone, by reply, or as an attachment."}
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * How the enquiry ends: the controls while it is live, the outcome once it
 * isn't. The two never show together — a converted lead with a live "convert"
 * button invites a second account for the same people.
 */
export async function OutcomeCard({ lead }: { lead: LeadHeader }) {
  if (isResolved(lead.status)) {
    return (
      <Card title="Outcome" meta={LEAD_STATUS_LABEL[lead.status]}>
        <div className="flex flex-col gap-px px-2 pb-3">
          {lead.convertedToClient ? (
            <OutcomeRow
              label={lead.status === "BOUND" ? "Contact on" : "Became client"}
              href={`/dashboard/clients/${lead.convertedToClient.id}`}
              value={lead.convertedToClient.name}
              at={lead.boundAt ?? lead.convertedAt}
            />
          ) : null}
          {lead.order ? (
            <OutcomeRow
              label={lead.status === "BOUND" ? "Bound to order" : "Order"}
              href={`/dashboard/orders/${lead.order.id}`}
              value={lead.order.reservationNumber}
              at={lead.boundAt ?? lead.convertedAt}
            />
          ) : null}
          {lead.orderMissing ? (
            <OutcomeRow
              label="Order"
              value="Linked order no longer exists"
              at={lead.boundAt ?? lead.convertedAt}
            />
          ) : null}
          {lead.lostAt ? (
            <OutcomeRow
              label="Closed"
              value={lead.lostReason ?? "No reason recorded"}
              at={lead.lostAt}
            />
          ) : null}
        </div>
        {!lead.convertedToClient && !lead.order && !lead.lostAt ? (
          <CardEmpty>
            Marked {LEAD_STATUS_LABEL[lead.status].toLowerCase()} with nothing
            recorded against it — no client, no order, no reason. Worth reading
            the activity log beside this before trusting the status.
          </CardEmpty>
        ) : null}
      </Card>
    );
  }

  const candidates = await getBindCandidates();

  return (
    <Card title="Convert">
      <LeadResolve
        leadId={lead.id}
        company={lead.companyName}
        candidates={candidates.rows}
        candidateTotal={candidates.total}
      />
    </Card>
  );
}

function OutcomeRow({
  label,
  value,
  href,
  at,
}: {
  label: string;
  value: string;
  href?: string;
  at: Date | null;
}) {
  const body = (
    <span className="grid grid-cols-[92px_1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail">
      <span className="text-ink-muted">{label}</span>
      <span className="truncate font-bold">{value}</span>
      <span className="tabular-nums text-ink-faint">
        {at ? dayYear(at) : ""}
      </span>
    </span>
  );

  return href ? (
    <Link href={href} className="block rounded-row hover:bg-row-hover">
      {body}
    </Link>
  ) : (
    body
  );
}
