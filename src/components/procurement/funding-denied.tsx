import { PageHeader } from "@/components/shell/page-header";

/**
 * What someone sees on a funding request write screen they may not use.
 *
 * An old link can land them here, and a long form that fails only on submit
 * wastes the typing. The actions refuse regardless; this says so before
 * anything is typed. Since Phase 6 STAFF raise requests and edit their own
 * drafts, so the edit screen passes the reason that applies to them.
 */
export function FundingDenied({
  title,
  role,
  reason,
}: {
  title: string;
  role: string;
  reason?: string;
}) {
  return (
    <>
      <PageHeader eyebrow="Procurement" title={title} />
      <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
        <p className="max-w-md text-center text-body text-balance text-ink-muted">
          {reason ?? (
            <>
              Raising funding requests is for staff and administrators. You are
              signed in with {role} access, which can&rsquo;t. An administrator
              can change your role under Settings → Users.
            </>
          )}
        </p>
      </section>
    </>
  );
}
