import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardSkeleton } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { getSettingsState } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import {
  SETTINGS_GROUPS,
  settingsPagesFor,
  type SettingsGroup,
  type SettingsPage,
} from "@/lib/settings/pages";

export const metadata = { title: "Settings" };

/**
 * Settings — the index.
 *
 * Settings is pinned at the bottom of the rail with no children in it, so this
 * screen is the only map of the area. That makes it navigation, and navigation
 * that only lists names is a menu you have to open every item of to use. Each
 * row carries one provable line of state instead — how many accounts exist, how
 * many keys are live, whether QuickBooks is actually connected — so the common
 * question ("is that set up?") is answered here rather than one click in.
 *
 * The state lives behind its own Suspense boundary. It is fourteen counts
 * across as many tables, and the map itself is static: the links must be
 * clickable immediately, not when the slowest count lands.
 *
 * Rows are filtered by role, so nothing here leads to a refusal screen. The
 * refusal still exists (`SettingsDenied`) because a bookmark can reach a screen
 * this index would not have shown.
 */
export default async function SettingsIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const pages = settingsPagesFor(user.role);
  const groups = SETTINGS_GROUPS.map((group) => ({
    group,
    pages: pages.filter((page) => page.group === group),
  })).filter((entry) => entry.pages.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        blurb={
          <>
            {/* The count is per-role: an administrator sees eleven, a viewer
                five. Saying which is whose avoids "where did Users go". */}
            {pages.length} screens your access can open · signed in as{" "}
            {user.name} ({user.title.toLowerCase()})
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {groups.map(({ group, pages: groupPages }) => (
          <Suspense
            key={group}
            fallback={<CardSkeleton title={group} rows={groupPages.length} />}
          >
            <GroupCard group={group} pages={groupPages} />
          </Suspense>
        ))}
      </div>
    </>
  );
}

/**
 * One group of settings screens.
 *
 * Every card awaits the same `getSettingsState()` call. React dedupes it across
 * the four boundaries in a single render, so this is one round of queries, not
 * four — and each card can still resolve on its own if one ever diverges.
 */
async function GroupCard({
  group,
  pages,
}: {
  group: SettingsGroup;
  pages: SettingsPage[];
}) {
  const state = await getSettingsState();

  return (
    <Card title={group}>
      <ul className="flex flex-col gap-px px-2 pb-3">
        {pages.map((page) => (
          <li key={page.id}>
            <Link
              href={page.href}
              className="grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-row px-2 py-[7px] transition-colors duration-[160ms] hover:bg-row-hover"
            >
              <span className="min-w-0">
                <span className="text-body font-bold">{page.label}</span>
                <span className="block truncate text-detail text-ink-muted">
                  {page.blurb}
                </span>
              </span>
              {/* Blank where nothing is provable — My profile and Notifications
                  are about the reader, and a count would be filler. */}
              <span className="text-detail text-ink-muted">
                {state[page.id] ?? ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
