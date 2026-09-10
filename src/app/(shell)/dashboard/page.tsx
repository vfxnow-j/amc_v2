import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ActionBar } from "@/components/dashboard/action-bar";
import {
  DashboardGrid,
  DashboardGridEmpty,
} from "@/components/dashboard/dashboard-grid";
import { DashboardEditor } from "@/components/dashboard/dashboard-editor";
import {
  CustomiseButton,
  DashboardViewPicker,
} from "@/components/dashboard/dashboard-view-picker";
import { renderTile } from "@/components/dashboard/tiles/registry";
import { RangeControl } from "@/components/overview/range-control";
import { PageHeader } from "@/components/shell/page-header";
import { tilesFor } from "@/lib/dashboard/catalog";
import { getDashboardScreen } from "@/lib/dashboard/store";
import { moneyCompact } from "@/lib/format";
import { getHeaderStats } from "@/lib/queries/overview";
import { isRange, type Range } from "@/lib/queries/range";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "Dashboard" };

async function HeaderBlurb() {
  const { openOrders, booked } = await getHeaderStats();
  return (
    <>
      {openOrders} open {openOrders === 1 ? "order" : "orders"} ·{" "}
      {moneyCompact(booked)} booked
    </>
  );
}

/**
 * The Dashboard: the whole business on one screen, pinned at the top of the
 * rail so it is one click from anywhere.
 *
 * It was Insight → Overview, and it answered two of the questions an owner
 * actually has — how are we trading, and what needs hands today. The other
 * three were spread across the rail: which hardware earns, which hardware is
 * dead weight, and what is broken. Those are not reporting questions you go
 * looking for once a month; they are the ones you want answered while you are
 * looking at everything else.
 *
 * **The layout is no longer written here.** The reading order that used to be
 * spelled out in JSX is now a `DashboardTemplate` row an administrator
 * maintains, and each person's own arrangement of it is a `DashboardLayout`
 * row. This file resolves which of those applies, maps each tile id through the
 * registry, and hands the finished nodes to whichever view is asked for:
 *
 * - **read** — `DashboardGrid`, a Server Component that emits plain CSS Grid.
 *   No `react-grid-layout`, no measurement, no hydration; the grid arrives
 *   drawn. Below 1024px the same DOM stacks in reading order.
 * - **edit** (`?edit=1`) — `DashboardEditor`, which lazy-loads the drag canvas
 *   into its own chunk.
 *
 * Every tile still has its own Suspense boundary, owned by the registry: the
 * revenue strip runs an accrual calculation across every recurring order and
 * the fleet tiles group the whole order book, and none of them may hold up the
 * headline figures or each other. That is why the nodes below are built before
 * the branch and handed to both views — they are already streaming.
 *
 * Three parameters, all in the URL and all shareable: `range` (the header's
 * segmented control), `view` (which dashboard), `edit` (handles on or off).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; view?: string; edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const range: Range = isRange(params.range) ? params.range : "month";
  const context = { range };

  const screen = await getDashboardScreen(user.id, user.role, params.view);
  const editing = params.edit === "1";

  // Rendered once and shared by both views. `renderTile` returns the tile
  // already wrapped in its Suspense boundary, so this is a list of streaming
  // nodes rather than a list of awaited results — the branch below costs
  // nothing and the editor is never waiting on a query.
  const items = screen.tiles.map((tile) => ({
    tile,
    node: renderTile(tile.id, context),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="The business today"
        blurb={
          <Suspense fallback="Counting open orders…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          editing ? (
            <RangeControl range={range} />
          ) : (
            <>
              <DashboardViewPicker
                views={screen.views.map(({ key, label }) => ({ key, label }))}
                current={screen.view.key}
              />
              <RangeControl range={range} />
              <CustomiseButton />
            </>
          )
        }
      />

      {/* The action bar is what you came to *start*; in edit mode you came to
          rearrange, and four buttons you cannot press would be noise. */}
      {editing ? null : <ActionBar />}

      {editing ? (
        <DashboardEditor
          viewKey={screen.view.key}
          viewLabel={screen.view.label}
          initial={screen.tiles}
          items={items.map(({ tile, node }) => ({ id: tile.id, node }))}
          available={tilesFor(user.role)}
          reshaped={screen.reshaped}
        />
      ) : items.length === 0 ? (
        <DashboardGridEmpty canEdit />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DashboardGrid items={items} />
        </div>
      )}
    </>
  );
}
