"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { UserPod } from "@/components/shell/user-pod";
import { entityNavItems, isNavActive, otherEntities } from "@/lib/entities/nav";
import type { SessionUser } from "@/lib/roles";

/**
 * The entity rail: the same family as the main rail (bg-nav card, bubble rows,
 * the user pod) but unmistakable. The banner carries the entity's name on the
 * amber tile accent, and the rail sets `data-accent` so every accent token
 * inside it resolves to amber rather than the theme's. Nothing here reads the
 * entity database; the layout hands in plain values.
 *
 * The user pod is reused as-is, so sign-out, Settings and the entity switcher
 * work here exactly as in the main shell.
 */
export function EntityNav({
  user,
  slug,
  name,
  entities,
  canWrite,
}: {
  user: SessionUser;
  slug: string;
  name: string;
  entities: { slug: string; name: string }[];
  canWrite: boolean;
}) {
  const pathname = usePathname();
  const items = entityNavItems(slug, canWrite);
  const others = otherEntities(entities, slug);

  return (
    <div
      data-print-hide
      data-accent="amber"
      className="flex w-64 flex-none flex-col rounded-card bg-nav px-[10px] py-[14px] shadow-sm"
    >
      <div className="rounded-bubble bg-tile-accent-tint px-[12px] py-[10px] text-tile-accent-text">
        <p className="text-micro uppercase">Gear we store for</p>
        <p className="mt-[2px] flex items-center gap-[7px] text-nav-cluster">
          <Building2 className="size-[14px] flex-none" aria-hidden />
          <span className="truncate">{name}</span>
        </p>
      </div>

      <nav aria-label={`${name} sections`} className="mt-[10px] flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {items.map((item) => {
          const active = isNavActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`truncate rounded-bubble px-[12px] py-2 text-nav-cluster transition-colors duration-200 ${
                active
                  ? "bg-tile-accent-tint text-tile-accent-text"
                  : "bg-nav-bubble-quiet text-ink hover:bg-row-hover"
              }`}
            >
              {item.label}
            </Link>
          );
        })}

        {others.length > 0 ? (
          <div className="mt-2">
            <p className="px-[12px] pb-1 text-micro uppercase text-ink-muted">Other entities</p>
            <div className="flex flex-col gap-1">
              {others.map((e) => (
                <Link
                  key={e.slug}
                  href={`/entity/${e.slug}`}
                  className="flex items-center gap-[7px] truncate rounded-bubble px-[12px] py-2 text-detail text-ink-muted transition-colors duration-200 hover:bg-row-hover hover:text-ink"
                >
                  <Building2 className="size-[14px] flex-none" aria-hidden />
                  <span className="truncate">{e.name}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <Link
        href="/dashboard"
        className="mt-[10px] flex items-center gap-[7px] rounded-bubble px-[12px] py-2 text-detail text-ink-muted transition-colors duration-200 hover:bg-row-hover hover:text-ink"
      >
        <ArrowLeft className="size-[14px] flex-none" aria-hidden />
        Back to VFXnow
      </Link>

      <UserPod user={user} entities={entities} />
    </div>
  );
}
