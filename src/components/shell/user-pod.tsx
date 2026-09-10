"use client";

import { useTransition } from "react";
import Link from "next/link";
import { LogOut, Settings, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemePicker } from "@/components/theme/theme-picker";
import { useAppearance } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
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
 * Appearance is both halves here, not just the theme. Sending somebody to a
 * settings page to change a color when the theme switch is already under their
 * cursor is the kind of split that makes a preference feel like a chore — and
 * the menu is where people already look. The full card on the profile keeps the
 * explanations; this is the same control without the prose.
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
  const { values, set } = useAppearance();
  const [, startTransition] = useTransition();

  /**
   * Applies immediately and saves behind it. The save is the only part that can
   * fail, and it fails quietly: the choice is already on screen and mirrored to
   * localStorage, so all that is lost is it following you to another browser —
   * not worth an error state inside a dropdown.
   */
  function chooseMode(value: string) {
    set("mode", value);
    startTransition(async () => {
      try {
        await saveAppearance({ mode: value });
      } catch {
        // See above.
      }
    });
  }

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

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro uppercase text-ink-muted">
              Theme
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={values.mode}
              onValueChange={chooseMode}
            >
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                Match system
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuLabel className="text-micro uppercase text-ink-muted">
              Theme
            </DropdownMenuLabel>
            {/* Plain buttons, not menu items: a menu item closes the menu on
                select, and choosing a theme is something you do two or three
                times in a row while looking at the result. */}
            <div className="px-2 pb-1">
              <ThemePicker layout="grid" />
            </div>

            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings/profile">
                <SlidersHorizontal className="size-4" aria-hidden />
                Appearance, with names
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
