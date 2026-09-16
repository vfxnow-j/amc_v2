import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { PageHeader } from "@/components/shell/page-header";
import { PODenied } from "@/components/procurement/po-denied";
import { POForm, type POFormValues } from "@/components/procurement/po-form";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";
import { getFundingPrefill, getPOFormOptions } from "@/lib/procurement/po-queries";

export const metadata = { title: "New purchase order" };

/**
 * Procurement → Purchase orders → a new one.
 *
 * v2 could receive against a PO and never raise one; `createPurchaseOrder` sat
 * ported and unreachable. Two ways in besides the list, both prefilling what
 * the caller already knows:
 *
 * - `?vendor=<id>` — from the vendor record's "Raise a PO".
 * - `?funding=<id>` — from a funding request. The new PO is attached to the
 *   request in the same write that creates it, and the request's itemised
 *   equipment becomes the starting lines. A declined or canceled request is
 *   named and not attached; the form still works, because the hardware may
 *   still need ordering on some other footing.
 */
export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; funding?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) {
    return <PODenied title="New purchase order" role={user.title} />;
  }

  const { vendor, funding } = await searchParams;
  const [options, request] = await Promise.all([
    getPOFormOptions(),
    funding ? getFundingPrefill(funding) : Promise.resolve(null),
  ]);

  const vendorId = options.vendors.some((v) => v.id === vendor) ? vendor! : "";
  const attach = request?.usable ? request : null;

  const initial: POFormValues = {
    vendorId,
    shipToLocationId: "",
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDate: "",
    orderType: "",
    purchaseMethod: "",
    creditTerms: "",
    discountType: "",
    discountValue: "",
    freightAmount: "",
    taxAmount: "",
    taxExempt: false,
    notes: "",
    lines: (attach?.lines ?? []).map((line) => ({
      ...line,
      assetId: null,
      kind: "units",
    })),
    fees: [],
  };

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Purchase orders"
        title="New purchase order"
        blurb="The vendor and the date are all it needs to be saved. Lines, prices and tax can follow when the quote does."
      />

      {funding && !request ? (
        <Notice tone="error">
          The funding request this link names does not exist, so the PO will
          not be attached to one.{" "}
          <Link href="/dashboard/funding" className="underline">
            Funding requests
          </Link>
        </Notice>
      ) : null}
      {request && !request.usable ? (
        <Notice tone="error">
          {request.requestNumber} is {request.status.toLowerCase()}, so this PO
          will not be attached to it.
        </Notice>
      ) : null}

      <POForm
        mode="create"
        initial={initial}
        vendors={options.vendors}
        locations={options.locations}
        assets={options.assets}
        funding={attach ? { id: attach.id, requestNumber: attach.requestNumber } : null}
        cancelHref={
          attach
            ? `/dashboard/funding/${attach.id}`
            : vendorId
              ? `/dashboard/vendors/${vendorId}`
              : "/dashboard/purchase-orders"
        }
      />
    </>
  );
}
