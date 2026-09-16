import { Card, Field, Unset } from "@/components/record/record-card";
import { BandPill, reasonText } from "@/components/tracker/band";
import { RelationshipDesk } from "@/components/tracker/relationship-desk";
import { dayYear, money } from "@/lib/format";
import { getLeadOwners } from "@/lib/queries/lead-record";
import { getTrackerRow } from "@/lib/queries/tracker";
import type { Role } from "@/lib/roles";
import { BAND_LABEL, NEXT_STEP_LABEL, formatMonths } from "@/lib/tracker/labels";

/**
 * Where this account stands with us: its band and *why*, its tier, who owns it,
 * what is next and what is overdue.
 *
 * The band is read from the same tracker pass the Tracker page renders
 * (`getTrackerRow`), not recomputed here — a tier is a percentile across every
 * account, so there is no honest way to work one out for a single record, and a
 * record that disagreed with the list about the same account would be worse
 * than no badge at all.
 */
export async function RelationshipCard({
  clientId,
  viewer,
}: {
  clientId: string;
  viewer: { id: string; role: Role } | null;
}) {
  const [row, owners] = await Promise.all([getTrackerRow("client", clientId), getLeadOwners()]);
  if (!row) return null;

  const t = row.temperature;
  const role = viewer?.role;
  const canEdit = role === "SUPER_ADMIN" || role === "ADMIN" || role === "STAFF";
  const canSeason = role === "SUPER_ADMIN" || role === "ADMIN";

  return (
    <Card title="Relationship" meta={row.play.play}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <BandPill band={row.band} pinned={!!t.pinned} />
        <span className="rounded-pill bg-sunken px-2 py-[1px] text-pill text-ink" title="Value tier">
          Tier {row.tier}
        </span>
        <span className="text-detail text-ink-muted">
          {row.booked > 0 ? `${money(row.booked)} booked in the last 12 months` : "Nothing booked in 12 months"}
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

      {row.reasons.length ? (
        <ul className="mx-4 mb-3 flex flex-col gap-1 rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint">
          {row.reasons.map((reason, index) => (
            <li key={index}>{reasonText(reason)}</li>
          ))}
        </ul>
      ) : null}

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
