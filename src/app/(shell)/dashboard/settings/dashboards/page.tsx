import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardViewForm } from "@/components/dashboard/dashboard-view-form";
import { Card, CardSkeleton } from "@/components/record/record-card";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { listDashboardViews } from "@/lib/dashboard/store";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { ROLE_OPTIONS } from "@/lib/settings/roles";

export const metadata = { title: "Dashboards" };

/**
 * Settings → Dashboards.
 *
 * The company's dashboard views: what each one is called, who can open it, and
 * which tiles are on it in what order. Administrators only, because these are
 * everybody's starting points — but note what this screen deliberately does
 * *not* do, which is decide what anybody's dashboard looks like. A view is a
 * list of tiles; the arrangement is each person's own, saved against the view
 * as a `DashboardLayout` row the moment they drag anything.
 *
 * That split is why this is a checklist rather than a second drag canvas, and
 * it is worth stating on the screen rather than only in the code: an
 * administrator changing a view changes it for everyone who has never reshaped
 * it, and for nobody who has. The list says how many that is per view, because
 * "will this land?" is the only question an administrator has here that the
 * form cannot answer.
 *
 * Which view is being edited lives in the URL, like Categories, so a
 * half-finished edit is a link somebody can send, selecting a row is a
 * navigation, and the form is the same component either way.
 */
export default async function DashboardsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="dashboards" role={user.title} />;

  const { edit } = await searchParams;

  return (
    <>
      <SettingsHeader
        id="dashboards"
        actions={
          edit ? (
            <Link
              href="/dashboard/settings/dashboards"
              className="rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Add a view
            </Link>
          ) : undefined
        }
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Suspense fallback={<CardSkeleton title="Views" rows={3} />}>
          <ViewList editing={edit} />
        </Suspense>

        <Suspense
          key={edit ?? "new"}
          fallback={<CardSkeleton title="Loading the view" rows={8} />}
        >
          <FormCard editing={edit} />
        </Suspense>
      </div>
    </>
  );
}

async function ViewList({ editing }: { editing?: string }) {
  const views = await listDashboardViews();

  return (
    <Card
      title="Views"
      meta={`${views.length} ${views.length === 1 ? "view" : "views"}`}
    >
      <ul className="flex flex-col gap-px px-2 pb-3">
        {views.map((view) => (
          <li key={view.id}>
            <Link
              href={`/dashboard/settings/dashboards?edit=${view.id}`}
              className={`block rounded-row px-2 py-[7px] transition-colors hover:bg-row-hover ${
                view.id === editing ? "bg-accent-tint" : ""
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-body font-bold">
                  {view.label}
                </span>
                <span className="ml-auto text-detail text-ink-muted">
                  {view.tiles.length}{" "}
                  {view.tiles.length === 1 ? "tile" : "tiles"}
                </span>
              </span>
              <span className="block truncate text-detail text-ink-muted">
                {view.access.length === 0
                  ? "Everyone"
                  : view.access
                      .map(
                        (role) =>
                          ROLE_OPTIONS.find((option) => option.value === role)
                            ?.label ?? role,
                      )
                      .join(", ")}
                {" · "}
                {view.reshapedBy === 0
                  ? "nobody has reshaped it"
                  : `${view.reshapedBy} reshaped ${
                      view.reshapedBy === 1 ? "copy" : "copies"
                    }`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
        Changing a view changes it for everyone who has never reshaped it, and
        for nobody who has.
      </p>
    </Card>
  );
}

async function FormCard({ editing }: { editing?: string }) {
  const views = await listDashboardViews();
  const selected = editing ? views.find((view) => view.id === editing) : undefined;

  return (
    <Card
      title={selected ? `Edit ${selected.label}` : "Add a view"}
      meta={
        selected
          ? `key: ${selected.key}`
          : "or pick one on the left to change it"
      }
    >
      {/* Keyed on the selection so picking another row remounts the form with
          that row's values, rather than an effect copying props into state. */}
      <DashboardViewForm
        key={selected?.id ?? "new"}
        view={
          selected
            ? {
                id: selected.id,
                key: selected.key,
                label: selected.label,
                access: selected.access,
                sortOrder: selected.sortOrder,
                tiles: selected.tiles,
                reshapedBy: selected.reshapedBy,
              }
            : null
        }
      />
    </Card>
  );
}
