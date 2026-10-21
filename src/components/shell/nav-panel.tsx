"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, X } from "lucide-react";
import { BrandLockup } from "@/components/shell/brand-lockup";
import { ClusterBubble } from "@/components/shell/cluster-bubble";
import { CommandPalette } from "@/components/shell/command-palette";
import { NavSearch } from "@/components/shell/nav-search";
import { UserPod } from "@/components/shell/user-pod";
import {
  DASHBOARD_PAGE,
  clustersForRole,
  findNavPage,
  type ClusterId,
} from "@/lib/nav/clusters";
import type { NavCounts } from "@/lib/nav/counts";
import type { SessionUser } from "@/lib/roles";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * The rail: brand, search, the pinned Dashboard, the cluster bubbles, user
 * pod.
 *
 * Dashboard sits above the clusters rather than inside one. It was Insight →
 * Overview, which meant the whole-business read was two clicks deep in a
 * cluster you were usually not in — the wrong shape for the one screen you want
 * from anywhere. It is a plain link, not a bubble: it has no children to
 * expand, and dressing it as a collapsed cluster would promise some.
 *
 * One cluster is open at a time, so the rail never outgrows its own height and
 * rows don't slide out from under the cursor. Keyboard is the fast path for
 * warehouse staff: 1–6 jump to a cluster, ↑/↓ walk its pages, Enter navigates
 * (the rows are links, so that comes for free), ⌘K bypasses the rail entirely.
 * The digits stay on the clusters — Dashboard is one click from everywhere and
 * doesn't need one.
 */
export function NavPanel({
  user,
  counts,
  bell,
  approver = false,
  entities = [],
}: {
  /** Entities this user may enter, for the sprocket's "Switch entity" group. */
  entities?: { slug: string; name: string }[];
  user: SessionUser;
  counts: NavCounts;
  /**
   * Whether this user approves anything — shows Procurement → Approvals. Read
   * on the server by the shell; approving is a per-user tag, not a role.
   */
  approver?: boolean;
  /**
   * The notification bell, server-rendered upstream so its count streams in
   * behind its own boundary. Passed through untouched — this component is a
   * client component and must not learn anything about notifications.
   */
  bell?: React.ReactNode;
}) {
  const pathname = usePathname();
  const clusters = useMemo(() => clustersForRole(user.role, approver), [user.role, approver]);
  const active = useMemo(() => findNavPage(pathname), [pathname]);
  // Null on the pinned rows: Dashboard and Settings belong to no cluster, so
  // landing on either leaves every bubble closed, which is correct.
  const activeClusterId = active?.cluster?.id ?? null;

  // "On navigation, force it to the cluster owning the active route": rather
  // than resetting state from an effect, a manual toggle is recorded against
  // the route it was made on, so navigating away retires it by itself.
  const [override, setOverride] = useState<{
    pathname: string;
    cluster: ClusterId | null;
  } | null>(null);
  const openCluster =
    override?.pathname === pathname ? override.cluster : activeClusterId;
  // Exact, so the row doesn't light up on all 65 screens beneath /dashboard.
  const dashboardActive = pathname === DASHBOARD_PAGE.href;

  const [paletteOpen, setPaletteOpen] = useState(false);

  // Phone drawer. Open state is recorded against the route it was opened on, so
  // navigating retires it without an effect (same trick as `override` above).
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setDrawerPath(null);
    menuButtonRef.current?.focus();
  }, []);
  const railRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);

  const pageLinks = useCallback((cluster: ClusterId) => {
    const selector = `[data-cluster="${cluster}"] [data-nav-page]`;
    return Array.from(
      railRef.current?.querySelectorAll<HTMLAnchorElement>(selector) ?? [],
    );
  }, []);

  const toggleCluster = useCallback(
    (cluster: ClusterId) => {
      setOverride((current) => {
        const open =
          current?.pathname === pathname ? current.cluster : activeClusterId;
        return {
          pathname,
          cluster: open === cluster ? null : cluster,
        };
      });
    },
    [activeClusterId, pathname],
  );

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;

      if (modified && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (paletteOpen || modified || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= clusters.length) {
        event.preventDefault();
        const target = clusters[digit - 1];
        setOverride({ pathname, cluster: target.id });
        // The panel has to be expanded before its rows can take focus.
        requestAnimationFrame(() => pageLinks(target.id)[0]?.focus());
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      // Only while the rail has focus — otherwise this would eat the arrow
      // keys that scroll the content column.
      if (!railRef.current?.contains(document.activeElement)) return;
      if (!openCluster) return;

      const rows = pageLinks(openCluster);
      if (rows.length === 0) return;
      event.preventDefault();

      const current = rows.findIndex((row) => row === document.activeElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % rows.length
          : current <= 0
            ? rows.length - 1
            : current - 1;
      rows[next]?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clusters, openCluster, pageLinks, paletteOpen, pathname]);

  // Escape closes the drawer; Tab is kept inside it while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const rail = railRef.current;
    const focusable = () =>
      Array.from(
        rail?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !paletteOpen) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (!rail?.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, paletteOpen, closeDrawer]);

  return (
    <>
      {/* Phone top bar: below md the rail becomes a slide-over drawer. */}
      <header className="flex h-12 flex-none items-center gap-1 rounded-card bg-nav px-1 shadow-sm md:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerPath(pathname)}
          className="flex size-11 flex-none items-center justify-center rounded-tile text-ink hover:bg-row-hover"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link href={DASHBOARD_PAGE.href} className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-ink">
          VFXnow | AMC
        </Link>
        <span className="flex size-11 flex-none items-center justify-center [&_a]:flex [&_a]:size-11 [&_a]:items-center [&_a]:justify-center [&_svg]:size-5">
          {bell}
        </span>
      </header>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}
    {/* bg-nav, not bg-panel: --nav-surface is --panel until the `data-nav` axis
        moves it. See "Appearance axes" in globals.css. Below md this is a fixed
        drawer; md and up it is the in-flow rail exactly as before. */}
    <div
      ref={railRef}
      role={drawerOpen ? "dialog" : undefined}
      aria-modal={drawerOpen ? true : undefined}
      aria-label={drawerOpen ? "Menu" : undefined}
      className={`flex w-64 flex-none flex-col rounded-card bg-nav px-[10px] py-[14px] shadow-sm max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[85vw] max-md:max-w-72 max-md:rounded-l-none max-md:pb-[max(14px,env(safe-area-inset-bottom))] max-md:pt-[max(14px,env(safe-area-inset-top))] max-md:transition-transform max-md:duration-200 ${
        drawerOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full"
      }`}
    >
      <button
        type="button"
        aria-label="Close menu"
        onClick={closeDrawer}
        className="mb-1 flex size-11 flex-none items-center justify-center self-end rounded-tile text-ink-muted hover:bg-row-hover md:hidden"
      >
        <X className="size-5" aria-hidden />
      </button>
      <BrandLockup />
      <NavSearch ref={searchRef} onOpen={() => setPaletteOpen(true)} />

      <Link
        href={DASHBOARD_PAGE.href}
        aria-current={dashboardActive ? "page" : undefined}
        className={`mt-[10px] flex items-center gap-[9px] rounded-bubble px-[10px] py-2 max-md:min-h-11 transition-colors duration-200 ${
          dashboardActive
            ? "bg-nav-bubble-open text-accent-on-tint"
            : "bg-nav-bubble-quiet text-ink hover:bg-row-hover"
        }`}
      >
        <span
          aria-hidden
          className={`flex size-[26px] flex-none items-center justify-center rounded-tile ${
            dashboardActive
              ? "bg-accent-solid text-accent-on-solid"
              : "bg-nav-mark-closed text-ink-muted"
          }`}
        >
          <LayoutDashboard className="size-[14px]" />
        </span>
        <span className="truncate text-nav-cluster">{DASHBOARD_PAGE.label}</span>
      </Link>

      <nav
        aria-label="Clusters"
        className="mt-[10px] flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
      >
        {clusters.map((cluster) => (
          <ClusterBubble
            key={cluster.id}
            cluster={cluster}
            open={openCluster === cluster.id}
            holdsActivePage={activeClusterId === cluster.id}
            activeHref={active?.page.href ?? null}
            counts={counts}
            onToggle={() => toggleCluster(cluster.id)}
          />
        ))}
      </nav>

      <UserPod user={user} bell={bell} entities={entities} />

      {paletteOpen ? (
        <CommandPalette role={user.role} approver={approver} onClose={closePalette} />
      ) : null}
    </div>
    </>
  );
}
