import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { findNavPage, SETTINGS_PAGE, type NavPage } from "@/lib/nav/clusters";

/**
 * Placeholder for every destination in the rail that hasn't been built yet.
 *
 * This is scaffolding, not architecture: a static route always wins over a
 * catch-all, so adding `app/(shell)/dashboard/reservations/page.tsx` takes that
 * path over and this keeps serving the rest. It exists so the rail is fully
 * navigable — accordion, active states, ⌘K — before the screens land, and so
 * each one says where its v1 equivalent is. Unknown paths still 404.
 */

type Params = { params: Promise<{ path: string[] }> };

type Resolved = { eyebrow?: string; page: NavPage };

function resolve(path: string[]): Resolved | null {
  const href = `/${path.join("/")}`;
  if (href === SETTINGS_PAGE.href) return { page: SETTINGS_PAGE };

  const match = findNavPage(href);
  return match ? { eyebrow: match.cluster.label, page: match.page } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { path } = await params;
  const resolved = resolve(path);
  // The root layout's template appends " · AMC v2".
  return resolved ? { title: resolved.page.label } : {};
}

function Origin({ page }: { page: NavPage }) {
  const from = page.from ?? [];

  if (from.length === 0) {
    return (
      <>
        {page.label} is new in v2 — there’s no v1 screen behind it yet, so it
        needs schema and queries before it can render.
      </>
    );
  }

  return (
    <>
      {from.length > 1
        ? `${page.label} merges ${from.length} v1 screens, live on port 3000:`
        : `${page.label} hasn’t been rebuilt in v2 yet. It’s live on v1, port 3000:`}{" "}
      {from.map((route, index) => (
        <span key={route}>
          {index > 0 ? " · " : null}
          <code className="text-detail text-ink">{route}</code>
        </span>
      ))}
    </>
  );
}

export default async function PlaceholderScreen({ params }: Params) {
  const { path } = await params;
  const resolved = resolve(path);
  if (!resolved) notFound();

  return (
    <>
      <PageHeader eyebrow={resolved.eyebrow} title={resolved.page.label} />
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-md text-center text-body text-balance text-ink-muted">
          <Origin page={resolved.page} /> Press{" "}
          <kbd className="rounded-row bg-sunken px-[6px] py-px text-[11px] font-bold">
            ⌘K
          </kbd>{" "}
          to jump somewhere else.
        </p>
      </section>
    </>
  );
}
