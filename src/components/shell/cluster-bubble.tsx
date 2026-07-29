"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCount, type NavCounts } from "@/lib/nav/counts";
import type { NavCluster } from "@/lib/nav/clusters";

/** Row height the panel's max-height is computed from (rows × 34 + 8). */
const ROW_HEIGHT = 34;

export function ClusterBubble({
  cluster,
  open,
  holdsActivePage,
  activeHref,
  counts,
  onToggle,
}: {
  cluster: NavCluster;
  open: boolean;
  /** Closed but owns the current route — stays tinted, per "collapsed ≠ forgotten". */
  holdsActivePage: boolean;
  activeHref: string | null;
  counts: NavCounts;
  onToggle: () => void;
}) {
  const clusterCount = counts.clusters[cluster.id];
  const panelId = `cluster-panel-${cluster.id}`;

  return (
    <div
      data-cluster={cluster.id}
      className={`rounded-bubble transition-colors duration-200 ${
        open
          ? "bg-nav-bubble-open"
          : holdsActivePage
            ? "bg-nav-bubble-quiet"
            : "bg-transparent"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center gap-[9px] rounded-bubble px-[10px] py-2 text-left select-none"
      >
        <span
          aria-hidden
          className={`flex size-[26px] flex-none items-center justify-center rounded-tile text-[10px] font-extrabold transition-colors duration-200 ${
            open
              ? "bg-accent text-brand-text"
              : "bg-nav-mark-closed text-ink-muted"
          }`}
        >
          {cluster.code}
        </span>
        <span className="text-nav-cluster whitespace-nowrap">
          {cluster.label}
        </span>
        {cluster.isNew ? (
          <span className="rounded-pill bg-accent-tint-strong px-[6px] py-px text-[9px] font-bold tracking-[0.1em] text-accent-on-tint">
            NEW
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-[7px] text-ink-muted">
          {clusterCount === undefined ? null : (
            <span className="text-[11px] font-bold">
              {formatCount(clusterCount)}
            </span>
          )}
          <ChevronRight
            aria-hidden
            className={`size-[10px] ease-[var(--ease-nav)] transition-transform duration-[240ms] ${
              open ? "rotate-90" : "rotate-0"
            }`}
          />
        </span>
      </button>

      {/*
        max-height is computed from the row count rather than animated to `auto`,
        which doesn't transition. The two durations differ (280ms travel, 180ms
        fade), so the transition is declared inline; prefers-reduced-motion
        flattens both to an instant show/hide from globals.css.
      */}
      <div
        id={panelId}
        inert={!open}
        className="overflow-hidden"
        style={{
          maxHeight: open ? cluster.pages.length * ROW_HEIGHT + 8 : 0,
          opacity: open ? 1 : 0,
          transition:
            "max-height 280ms var(--ease-nav), opacity 180ms ease",
        }}
      >
        <div className="px-[6px] pb-[6px]">
          {cluster.pages.map((page) => {
            const active = page.href === activeHref;
            const pageCount = counts.pages[page.id];
            return (
              <Link
                key={page.id}
                href={page.href}
                data-nav-page
                aria-current={active ? "page" : undefined}
                className={`mt-[2px] flex items-center gap-[9px] rounded-row px-[10px] py-[6px] transition-colors duration-[160ms] ${
                  active
                    ? "bg-accent font-bold text-brand-text"
                    : "text-ink-muted hover:bg-row-hover hover:text-ink"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1 flex-none rounded-full ${
                    active ? "bg-brand-text" : "bg-current opacity-60"
                  }`}
                />
                <span className="truncate text-nav-page">{page.label}</span>
                {pageCount === undefined ? null : (
                  <span className="ml-auto text-[11px] opacity-75">
                    {formatCount(pageCount)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
