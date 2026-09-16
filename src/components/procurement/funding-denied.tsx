import { PageHeader } from "@/components/shell/page-header";

/**
 * What a non-administrator sees on a funding request write screen.
 *
 * The rail hides Procurement from them, but an old link can still land them
 * here, and a long form that fails only on submit wastes the typing. The
 * actions refuse regardless; this says so before anything is typed.
 */
export function FundingDenied({ title, role }: { title: string; role: string }) {
  return (
    <>
      <PageHeader eyebrow="Procurement" title={title} />
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-md text-center text-body text-balance text-ink-muted">
          Raising and editing funding requests is for administrators. You are
          signed in with {role} access, which can&rsquo;t. An administrator can
          change your role under Settings → Users.
        </p>
      </section>
    </>
  );
}
