"use client";

import dynamic from "next/dynamic";
import type { DashboardCanvasProps } from "./canvas";

/**
 * The seam between a dashboard you read and a dashboard you rearrange.
 *
 * This module is three lines of substance and that is the entire point. The
 * reading view is a Server Component that ships no JavaScript; if the page
 * imported the canvas directly, `react-grid-layout`, `react-draggable`,
 * `react-resizable` and two stylesheets would land in the route's client bundle
 * and be downloaded by everybody who ever looks at the dashboard — which is
 * everybody, every day, to read it.
 *
 * `next/dynamic` puts all of that in its own chunk, requested when somebody
 * actually opens `?edit=1`. The wrapper has to be a Client Component because
 * `ssr: false` is not allowed in a Server Component, and `ssr: false` is what
 * we want: the canvas measures its container before it can place anything, so
 * a server pass would render a grid at a guessed width and then correct it on
 * hydration. Better to render the skeleton and place once.
 *
 * Props pass straight through, rendered tile nodes included. A Server
 * Component node is a perfectly ordinary prop to hand a Client Component; what
 * it must never be is a *child of the grid*, which is `canvas.tsx`'s problem
 * and is documented there.
 */
const DashboardCanvas = dynamic(() => import("./canvas"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export function DashboardEditor(props: DashboardCanvasProps) {
  return <DashboardCanvas {...props} />;
}

function EditorSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="h-[62px] animate-pulse rounded-card bg-tile shadow-sm" />
      <div className="h-64 animate-pulse rounded-card bg-tile shadow-sm" />
    </div>
  );
}
