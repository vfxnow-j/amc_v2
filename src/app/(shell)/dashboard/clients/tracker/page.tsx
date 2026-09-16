import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BandPill, REASON_LABEL } from "@/components/tracker/band";
import { dayYear, money } from "@/lib/format";
import { oneOf } from "@/lib/guards";
import { getTrackerRows, type TrackerRow } from "@/lib/queries/tracker";
import { getSessionUser } from "@/lib/roles";
import { BANDS, BAND_LABEL, NEXT_STEP_LABEL, type Band } from "@/lib/tracker/labels";

export const metadata = { title: "Tracker" };

const VIEWS = ["mine", "pool", "all"] as const;
type View = (typeof VIEWS)[number];
const isView = oneOf(VIEWS);
const VIEW_LABEL: Record<View, string> = { mine: "Mine", pool: "Pool", all: "Everyone" };

const BAND_FILTERS = ["any", ...BANDS] as const;
type BandFilter = (typeof BAND_FILTERS)[number];
const isBandFilter = oneOf(BAND_FILTERS);

/** Account · Band · Tier · Why now · Waiting · Play · Owner */
const QUEUE_COLUMNS: Column[] = [
  { key: "name", label: "Account", width: "minmax(0,1.3fr)" },
  { key: "band", label: "Band", width: "112px" },
  { key: "tier", label: "Tier", width: "40px" },
  { key: "why", label: "Why now", width: "minmax(0,1.9fr)" },
  { key: "waiting", label: "Waiting", width: "72px", align: "right" },
  { key: "play", label: "Play", width: "minmax(0,1fr)" },
  { key: "owner", label: "Owner", width: "minmax(0,0.6fr)" },
];

/** Account · Band · Tier · Booked · Last move · Next step · Play · Owner */
const ACCOUNT_COLUMNS: Column[] = [
  { key: "name", label: "Account", width: "minmax(0,1.3fr)" },
  { key: "band", label: "Band", width: "112px" },
  { key: "tier", label: "Tier", width: "40px" },
  { key: "booked", label: "Booked 12m", width: "96px", align: "right" },
  { key: "moved", label: "Last move", width: "88px" },
  { key: "next", label: "Next step", width: "minmax(0,1fr)" },
  { key: "play", label: "Play", width: "minmax(0,1.1fr)" },
  { key: "owner", label: "Owner", width: "minmax(0,0.8fr)" },
];

function inView(row: TrackerRow, view: View, me: string | undefined) {
  if (view === "mine") return !!me && row.owner?.id === me;
  if (view === "pool") return row.owner === null;
  return true;
}

function nameCell(row: TrackerRow) {
  return (
    <span className="font-bold">
      {row.name}
      {row.company && row.company !== row.name ? (
        <span className="font-normal text-ink-muted"> · {row.company}</span>
      ) : null}
      {row.kind === "lead" ? <span className="font-normal text-ink-faint"> · lead</span> : null}
    </span>
  );
}

function ownerCell(row: TrackerRow) {
  return row.owner ? (
    <span className="text-ink-muted">{row.owner.name}</span>
  ) : (
    <span className="text-ink-faint">Pool</span>
  );
}

async function Tabs({
  view,
  band,
  me,
  ownsAny,
}: {
  view: View;
  band: BandFilter;
  me: string | undefined;
  ownsAny: boolean;
}) {
  const rows = await getTrackerRows();
  const inThisView = rows.filter((row) => inView(row, view, me));
  return (
    <>
      <FilterTabs
        param="view"
        value={view}
        fallback={ownsAny ? "mine" : "all"}
        label="Whose accounts"
        options={VIEWS.map((option) => ({
          value: option,
          label: VIEW_LABEL[option],
          count: rows.filter((row) => inView(row, option, me)).length,
        }))}
      />
      <FilterTabs
        param="band"
        value={band}
        fallback="any"
        label="Band"
        options={BAND_FILTERS.map((option) => ({
          value: option,
          label: option === "any" ? "Any band" : BAND_LABEL[option],
          count:
            option === "any"
              ? inThisView.length
              : inThisView.filter((row) => row.band === option).length,
        }))}
      />
    </>
  );
}

async function HeaderBlurb({ me }: { me: string | undefined }) {
  const rows = await getTrackerRows();
  const due = rows.filter((row) => row.reasons.length > 0);
  const mine = due.filter((row) => row.owner?.id === me).length;
  const accounts = rows.filter((row) => row.kind === "client").length;
  const leads = rows.length - accounts;
  return (
    <>
      {accounts} accounts and {leads} open {leads === 1 ? "lead" : "leads"} · {due.length} due now
      {me ? <>, {mine} of them yours</> : null}
    </>
  );
}

async function Lists({ view, band, me }: { view: View; band: BandFilter; me: string | undefined }) {
  const rows = (await getTrackerRows()).filter(
    (row) => inView(row, view, me) && (band === "any" || row.band === (band as Band)),
  );
  const queue = rows.filter((row) => row.reasons.length > 0);
  const neverLogged = rows.every((row) => row.nextStep === null);

  const emptyView =
    view === "mine" ? (
      <>
        Nothing is yours yet. Accounts land here when you claim one from the Pool, or when someone hands you one
        from its Relationship card.
      </>
    ) : view === "pool" ? (
      <>Every account has an owner.</>
    ) : (
      <>No accounts or open leads.</>
    );

  return (
    <>
      <ListTable
        title="Due now"
        grow={false}
        columns={QUEUE_COLUMNS}
        total={queue.length}
        empty={rows.length === 0 ? emptyView : <>Nothing is due here today.</>}
        footerNote={
          neverLogged && queue.length > 0
            ? "no conversations are logged yet, so every account is measured from its last order"
            : undefined
        }
        rows={queue.map((row) => ({
          id: row.key,
          href: row.href,
          flagged: row.play.rank === 1,
          cells: {
            name: nameCell(row),
            band: <BandPill band={row.band} pinned={!!row.temperature.pinned} />,
            tier: <span className="font-bold text-ink-muted">{row.tier}</span>,
            why: (
              <span className="text-ink-muted" title={row.temperature.reason}>
                {[...new Set(row.reasons.map((reason) => REASON_LABEL[reason.kind]))].join(" · ")}
              </span>
            ),
            waiting: (
              <span className="text-ink-muted">
                {row.overdueDays === 0 ? "today" : `${row.overdueDays}d`}
              </span>
            ),
            play: <span className="text-ink-muted">{row.play.play}</span>,
            owner: ownerCell(row),
          },
        }))}
      />

      <ListTable
        title="Accounts"
        columns={ACCOUNT_COLUMNS}
        total={rows.length}
        empty={emptyView}
        rows={rows.map((row) => ({
          id: row.key,
          href: row.href,
          cells: {
            name: nameCell(row),
            band: <BandPill band={row.band} pinned={!!row.temperature.pinned} />,
            tier: <span className="font-bold text-ink-muted">{row.kind === "lead" ? "—" : row.tier}</span>,
            booked:
              row.booked > 0 ? money(row.booked) : <span className="text-ink-faint">—</span>,
            moved: (
              <span className="tabular-nums text-ink-muted" title={row.temperature.reason}>
                {dayYear(row.temperature.lastMove)}
              </span>
            ),
            next: row.nextStep ? (
              <span className="text-ink-muted">
                {NEXT_STEP_LABEL[row.nextStep.step]} · {dayYear(row.nextStep.at)}
              </span>
            ) : (
              <span className="text-ink-faint">—</span>
            ),
            play: <span className="text-ink-muted">{row.play.play}</span>,
            owner: ownerCell(row),
          },
        }))}
      />
    </>
  );
}

/**
 * Clients → Tracker.
 *
 * The page that answers, every morning, who to talk to today and why
 * (docs/client-tracker.md). Two lists over one computation: what is due now,
 * and every account in the view ranked by the matrix — Warm A-accounts first,
 * because that is the cheapest revenue there is to recover.
 *
 * Nothing on this page is stored. Band, tier, play and every due item are
 * derived from orders, logged conversations and today's date on each read, so
 * the queue needs no job and cannot drift.
 */
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; band?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getSessionUser();
  const me = viewer?.id;
  // Mine is the default for anyone who owns an account. For someone who owns
  // none — everyone, on the day this shipped — Mine is an empty page, so the
  // landing view is Everyone until they claim something.
  const ownsAny = me ? (await getTrackerRows()).some((row) => row.owner?.id === me) : false;
  const view: View = isView(params.view) ? params.view : ownsAny ? "mine" : "all";
  const band: BandFilter = isBandFilter(params.band) ? params.band : "any";

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Tracker"
        blurb={
          <Suspense fallback="Reading every account…">
            <HeaderBlurb me={me} />
          </Suspense>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={560} />}>
          <Tabs view={view} band={band} me={me} ownsAny={ownsAny} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${band}`} fallback={<ListTableSkeleton />}>
        <Lists view={view} band={band} me={me} />
      </Suspense>
    </>
  );
}
