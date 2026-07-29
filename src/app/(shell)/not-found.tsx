import { PageHeader } from "@/components/shell/page-header";

export default function ShellNotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-sm text-center text-body text-ink-muted">
          That address isn’t part of the v2 rail. It may be a v1 route that
          hasn’t been mapped into a cluster yet — press{" "}
          <kbd className="rounded-row bg-sunken px-[6px] py-px text-[11px] font-bold">
            ⌘K
          </kbd>{" "}
          to search the six clusters, or start from Overview.
        </p>
      </section>
    </>
  );
}
