"use client";

import Link from "next/link";
import { LogOut, Settings, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/actions/session";
import { SETTINGS_PAGE } from "@/lib/nav/clusters";
import type { SessionUser } from "@/lib/roles";

/**
 * Pinned to the bottom of the rail. Settings lives here rather than in a
 * cluster — it isn't part of the six-cluster IA.
 *
 * The design shows a single settings gear. It opens a menu rather than linking
 * straight through, because two other things have to be reachable from the
 * shell and have nowhere else to live: appearance (both skins are in scope, so
 * a user must be able to pick one) and signing out.
 *
 * Appearance is a link, not inline pickers: the theme and mode choosers live
 * on the profile page (Settings → My profile → Appearance), and repeating them
 * here was redundant.
 *
 * The bell sits beside the gear, and arrives as a prop rather than being
 * imported: it is server-rendered behind its own Suspense boundary in the shell
 * layout, and this is a client component. Passing the finished node through is
 * what keeps the count's query off the rail's critical path.
 */
export function UserPod({
  user,
  bell,
}: {
  user: SessionUser;
  bell?: React.ReactNode;
}) {
  return (
    <div className="mt-[10px] flex items-center gap-[9px] rounded-well bg-sunken px-[10px] py-2">
      <span
        aria-hidden
        className="flex size-[26px] flex-none items-center justify-center rounded-tile bg-ink text-[10px] font-bold text-panel"
      >
        {user.initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-bold">
          {user.name}
        </span>
        {/* 10px plain, not the tracked micro-label — this isn't a label. */}
        <span className="block truncate text-[10px] text-ink-faint">
          {user.title}
        </span>
      </span>

      <span className="ml-auto flex flex-none items-center gap-1">
        {bell}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex-none rounded-tile p-1 text-ink-faint transition-colors duration-200 hover:bg-row-hover hover:text-ink"
          >
            <Settings className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            <DropdownMenuLabel className="truncate text-detail font-normal text-ink-muted">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href={SETTINGS_PAGE.href}>
                <Settings className="size-4" aria-hidden />
                Settings
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings/profile">
                <SlidersHorizontal className="size-4" aria-hidden />
                Appearance
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                void signOutAction();
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
