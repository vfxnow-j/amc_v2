import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { PageHeader } from "@/components/shell/page-header";
import { FundingDenied } from "@/components/procurement/funding-denied";
import { FundingRequestForm } from "@/components/procurement/funding-request-form";
import { getFundingRequestPrefillFromPO } from "@/lib/actions/funding-requests";
import { moneyExact } from "@/lib/format";
import {
  blankFundingInput,
  prefilledFundingInput,
} from "@/lib/procurement/funding-input";
import { getFundingFormOptions } from "@/lib/queries/funding";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "New funding request" };

/**
 * Procurement → Funding requests → a new one.
 *
 * `?po=<purchaseOrderId>` starts the request from a purchase order that already
 * exists — the quote came in first and the paperwork follows. The PO's lines
 * become the equipment list, its total the ask, its loan the loan, and the PO
 * is attached when the request is created. This is the contract the purchase
 * order record links to.
 *
 * The ask is the PO total rather than the line subtotal because freight, fees
 * and tax need funding too; the banner says so, so the gap between the ask and
 * the equipment total doesn't read as an arithmetic error.
 */
export default async function NewFundingRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) {
    return <FundingDenied title="New funding request" role={user.title} />;
  }

  const { po } = await searchParams;
  const [options, prefill] = await Promise.all([
    getFundingFormOptions(),
    po ? getFundingRequestPrefillFromPO(po) : Promise.resolve(null),
  ]);

  const base = blankFundingInput(user.name, new Date());
  const initial = prefill ? prefilledFundingInput(base, prefill) : base;
  const source = prefill?.source;
  const overhead = prefill ? prefill.amountRequested - prefill.equipmentCost : 0;

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="New funding request"
        blurb="The case for spending the money — complete before committing to financing or drawing on a line of credit."
      />

      {source ? (
        <Notice tone="ok">
          Started from{" "}
          <Link href={`/dashboard/purchase-orders/${source.poId}`} className="font-bold underline">
            {source.poNumber}
          </Link>{" "}
          · {source.vendorName}. {source.itemCount} {source.itemCount === 1 ? "line" : "lines"} carried
          over, and the PO will be attached. The amount requested is the PO total
          {overhead > 0.005
            ? ` — ${moneyExact(prefill!.equipmentCost)} of equipment plus ${moneyExact(overhead)} freight, fees and tax`
            : ""}
          .{source.leaseNumber ? ` The PO's loan, ${source.leaseNumber}, is preselected.` : ""}
        </Notice>
      ) : null}

      {po && !prefill ? (
        <Notice tone="error">
          That purchase order could not be found, so this is a blank request.
        </Notice>
      ) : null}

      <FundingRequestForm
        initial={initial}
        clients={options.clients}
        leases={options.leases}
        cancelHref={source ? `/dashboard/purchase-orders/${source.poId}` : "/dashboard/funding"}
      />
    </>
  );
}
