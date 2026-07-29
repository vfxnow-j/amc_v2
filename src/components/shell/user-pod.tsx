import Link from "next/link";
import { Settings } from "lucide-react";
import { SETTINGS_PAGE } from "@/lib/nav/clusters";
import type { SessionUser } from "@/lib/roles";

/**
 * Pinned to the bottom of the rail. Settings lives here rather than in a
 * cluster — it isn't part of the six-cluster IA.
 */
export function UserPod({ user }: { user: SessionUser }) {
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
      <Link
        href={SETTINGS_PAGE.href}
        aria-label="Settings"
        className="ml-auto flex-none rounded-tile p-1 text-ink-faint transition-colors duration-200 hover:bg-row-hover hover:text-ink"
      >
        <Settings className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
