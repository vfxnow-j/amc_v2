import Link from "next/link";
import { Card, Field, Unset } from "@/components/record/record-card";
import { BandPill, reasonText } from "@/components/tracker/band";
import { RelationshipDesk } from "@/components/tracker/relationship-desk";
import { dayYear, money } from "@/lib/format";
import { getLeadOwners } from "@/lib/queries/lead-record";
import {
  getLeadRelationship,
  getLeadsBehind,
  getTrackerRow,
  type LeadBehind,
  type TrackerRow,
} from "@/lib/queries/tracker";
import type { Role } from "@/lib/roles";
import { BAND_LABEL, NEXT_STEP_LABEL, formatMonths } from "@/lib/tracker/labels";

/**
 * Where a relationship stands — on an account, and on the enquiry that became
 * one.
 *
 * The band is read from the same tracker pass the Tracker page renders
 * (`getTrackerRow`), never recomputed here: a tier is a percentile across every
 * account, so there is no honest way to work one out for a single record, and a
 * record that disagreed with the list about the same account would be worse
 * than no badge at all.
 */

const LINK = "text-accent-text hover:underline";

/** The band, the tier and what it is worth — identical wherever it is shown. */
function Standing({ row }: { row: TrackerRow }) {
  const t = row.temperature;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <BandPill band={row.band} pinned={!!t.pinned} />
        {row.kind === "client" ? (
          <span className="rounded-pill bg-sunken px-2 py-[1px] text-pill text-ink" title="Value tier">
            Tier {row.tier}
          </span>
        ) : null}
        <span className="text-detail text-ink-muted">
          {row.kind === "lead"
            ? "No account yet — nothing booked"
            : row.booked > 0
              ? `${money(row.booked)} booked in the last 12 months`
              : "Nothing booked in 12 months"}
        </span>
      </div>

      <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
        {t.pinned ? (
          <>
            Pinned until {dayYear(t.pinned.until)} — {t.pinned.reason}. Unpinned it would be{" "}
            {BAND_LABEL[t.pinned.underlying]}: {t.reason.toLowerCase()}.
          </>
        ) : (
          <>{t.reason}.</>
        )}
      </p>
    </>
  );
}

/** The queue items this record is carrying, in words. */
function Due({ row }: { row: TrackerRow }) {
  if (!row.reasons.length) return null;
  return (
    <ul className="mx-4 mb-3 flex flex-col gap-1 rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint">
      {row.reasons.map((reason, index) => (
        <li key={index}>{reasonText(reason)}</li>
      ))}
    </ul>
  );
}

/** A line per enquiry that became this account, and which route it took. */
function CameFrom({ leads }: { leads: LeadBehind[] }) {
  if (leads.length === 0) return null;
  return (
    <div className="mx-4 mb-3 rounded-well bg-sunken p-2 text-detail">
      <span className="mb-[2px] block text-micro uppercase text-ink-muted">
        Came from
      </span>
      <ul className="flex flex-col gap-[2px]">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link href={`/dashboard/leads/${lead.id}`} className={LINK}>
              {lead.name}
            </Link>
            <span className="text-ink-muted">
              {lead.bound ? " · bound to this account" : " · converted"} · {dayYear(lead.at)}
              {lead.assignedTo ? ` · ${lead.assignedTo.name}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {/* Says out loud why calls nobody logged here are in the timeline. */}
      <p className="pt-1 text-micro text-ink-faint">
        Conversations and asks logged on {leads.length === 1 ? "it" : "them"} show on this
        record.
      </p>
    </div>
  );
}

export async function RelationshipCard({
  clientId,
  viewer,
}: {
  clientId: string;
  viewer: { id: string; role: Role } | null;
}) {
  const [row, owners, leads] = await Promise.all([
    getTrackerRow("client", clientId),
    getLeadOwners(),
    getLeadsBehind(clientId),
  ]);
  if (!row) return null;

  const t = row.temperature;
  const role = viewer?.role;
  const canEdit = role === "SUPER_ADMIN" || role === "ADMIN" || role === "STAFF";
  const canSeason = role === "SUPER_ADMIN" || role === "ADMIN";

  return (
    <Card
      title="Relationship"
      meta={row.play.play}
      action={
        <Link href="/dashboard/clients/tracker" className={`text-detail ${LINK}`}>
          Tracker
        </Link>
      }
    >
      <Standing row={row} />

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Owner">{row.owner?.name ?? <Unset>In the pool</Unset>}</Field>
        <Field label="Next step">
          {row.nextStep ? (
            `${NEXT_STEP_LABEL[row.nextStep.step]} · ${dayYear(row.nextStep.at)}`
          ) : (
            <Unset>None booked</Unset>
          )}
        </Field>
        <Field label="Last move">{dayYear(t.lastMove)}</Field>
        <Field label="Season">
          {row.seasonalMonths.length ? formatMonths(row.seasonalMonths) : <Unset>Not seasonal</Unset>}
        </Field>
      </div>

      <Due row={row} />
      <CameFrom leads={leads} />

      {canEdit && viewer ? (
        <RelationshipDesk
          clientId={clientId}
          meId={viewer.id}
          ownerId={row.owner?.id ?? null}
          owners={owners}
          pinned={
            t.pinned
              ? { band: row.band, reason: t.pinned.reason, until: dayYear(t.pinned.until) }
              : null
          }
          seasonalMonths={row.seasonalMonths}
          canSeason={canSeason}
          pinLimitDays={canSeason ? 365 : 90}
        />
      ) : null}
    </Card>
  );
}

/**
 * The same standing, on the lead record.
 *
 * An open enquiry has a Tracker row of its own and shows as Prospect. A
 * converted or bound one does not — the account carries it from then on — so
 * what is shown instead is **the account's** row, said plainly as the
 * account's. Nothing here is editable: a lead's owner is its assignment, which
 * the Working-it card already sets, and pins and seasonal months belong to
 * accounts.
 */
export async function LeadRelationshipCard({ leadId }: { leadId: string }) {
  const standing = await getLeadRelationship(leadId);
  if (!standing) return null;
  const { row, own, account } = standing;

  if (!row) {
    // A resolved lead with no account behind it: lost, unqualified, or bound to
    // an order whose client has since gone. Say so rather than rendering a card
    // with an empty badge in it.
    return (
      <Card title="Relationship">
        <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
          This enquiry has left the tracker — it is closed, and no account
          carries it. Its conversations stay on the record below.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Relationship"
      meta={row.play.play}
      action={
        <Link href="/dashboard/clients/tracker" className={`text-detail ${LINK}`}>
          Tracker
        </Link>
      }
    >
      {!own && account ? (
        <p className="px-4 pb-2 text-detail text-balance text-ink-muted">
          This enquiry is now{" "}
          <Link href={`/dashboard/clients/${account.id}`} className={LINK}>
            {account.name}
          </Link>
          , and the account carries it. What follows is the account&rsquo;s standing, not
          the lead&rsquo;s.
        </p>
      ) : null}

      <Standing row={row} />

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Owner">{row.owner?.name ?? <Unset>In the pool</Unset>}</Field>
        <Field label="Next step">
          {row.nextStep ? (
            `${NEXT_STEP_LABEL[row.nextStep.step]} · ${dayYear(row.nextStep.at)}`
          ) : (
            <Unset>None booked</Unset>
          )}
        </Field>
      </div>

      <Due row={row} />
    </Card>
  );
}
