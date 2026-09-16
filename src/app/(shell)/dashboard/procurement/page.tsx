import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ListTableSkeleton } from "@/components/list/list-table";
import { OverviewAwaiting } from "@/components/procurement/overview-awaiting";
import { OverviewCommitted } from "@/components/procurement/overview-committed";
import { OverviewFunding } from "@/components/procurement/overview-funding";
import { OverviewVendors } from "@/components/procurement/overview-vendors";
import { CardSkeleton } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { moneyCompact } from "@/lib/format";
import { getPOHeaderStats } from "@/lib/queries/accounting";
import { getAwaitingReceipt } from "@/lib/queries/procurement";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Procurement" };

async function HeaderBlurb() {
  const [{ openCount, openValue }, { lateCount }] = await Promise.all([
    getPOHeaderStats(),
    getAwaitingReceipt(),
  ]);
  if (openCount === 0) return <>Nothing on order</>;
  return (
    <>
      {openCount} on order · {moneyCompact(openValue)} committed · {lateCount} past
      expected date
    </>
  );
}

/**
 * Procurement → Overview.
 *
 * Where the money going out to vendors stands: what is committed and not yet
 * on the shelf, what is late, the funding requests behind the spend, and who
 * the money went to. Read-only, and every figure is a sum or count of stored
 * rows — nothing here is projected, and every card says what it leaves out.
 *
 * Admin-only like the rest of the cluster. The rail already hides Procurement
 * from other roles, but a hidden link is not a gate, so the page checks too.
 */
export default async function ProcurementOverviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!isAdminRole(user.role)) {
    return (
      <>
        <PageHeader eyebrow="Procurement" title="Overview" />
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            Procurement is for administrators. You are signed in with{" "}
            {user.title} access, which can&rsquo;t open it. An administrator
            can change your role under Settings → Users.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Overview"
        blurb={
          <Suspense fallback="Reading purchase orders…">
            <HeaderBlurb />
          </Suspense>
        }
      />

      <Suspense fallback={<CardSkeleton title="On order" rows={3} />}>
        <OverviewCommitted />
      </Suspense>

      <Suspense fallback={<ListTableSkeleton rows={8} />}>
        <OverviewAwaiting />
      </Suspense>

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton title="Funding pipeline" rows={7} />}>
          <OverviewFunding />
        </Suspense>
        <Suspense fallback={<CardSkeleton title="Spend by vendor" rows={8} />}>
          <OverviewVendors />
        </Suspense>
      </div>
    </>
  );
}
