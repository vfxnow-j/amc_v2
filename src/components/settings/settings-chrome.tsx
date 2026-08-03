import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { settingsPage } from "@/lib/settings/pages";

/**
 * The chrome every Settings child wears.
 *
 * Settings is pinned at the bottom of the rail and its children are not in the
 * rail at all, so unlike a cluster screen there is no highlighted nav row
 * telling you where you are or how to get back. That job falls to the header:
 * the eyebrow names the area, and the "All settings" chip is the way out. Every
 * child gets the same one so the area reads as a place rather than eleven
 * unrelated screens.
 *
 * `id` is the key into `lib/settings/pages`, which owns the label and blurb —
 * a screen cannot drift from the index that links to it.
 */
export function SettingsHeader({
  id,
  title,
  blurb,
  actions,
}: {
  id: string;
  /** Overrides the index label — for a record screen naming its subject. */
  title?: string;
  /** Overrides the index blurb, usually with something the data proves. */
  blurb?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const page = settingsPage(id);

  return (
    <PageHeader
      eyebrow="Settings"
      title={title ?? page?.label ?? "Settings"}
      blurb={blurb ?? page?.blurb}
      actions={
        <>
          {actions}
          <Link
            href="/dashboard/settings"
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
          >
            ← All settings
          </Link>
        </>
      }
    />
  );
}

/**
 * What an admin-only screen shows to someone who isn't one.
 *
 * A redirect back to the index — what v1 did — leaves a bookmarked link looking
 * broken: the screen flickers and you land somewhere else with no explanation.
 * This says who you are signed in as and what would change the answer, which is
 * the same rule the empty states follow.
 */
export function SettingsDenied({
  id,
  role,
}: {
  id: string;
  /** The signed-in user's role title, e.g. "Warehouse staff". */
  role: string;
}) {
  const page = settingsPage(id);

  return (
    <>
      <SettingsHeader id={id} />
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-md text-center text-body text-balance text-ink-muted">
          {page?.label ?? "This screen"} is for administrators. You are signed in
          with {role} access, which can&rsquo;t open it. An administrator can
          change your role under Settings → Users.
        </p>
      </section>
    </>
  );
}
