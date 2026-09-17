import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { PODenied } from "@/components/procurement/po-denied";
import { POReceive } from "@/components/procurement/po-receive";
import { getSessionUser } from "@/lib/roles";
import { mayReceive } from "@/lib/procurement/access";
import { receivingRefusal } from "@/lib/procurement/receive-gate";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { getPOHeader, getPOLines, getReceivingLocations } from "@/lib/queries/po-record";
import { getPOFormOptions, getReceiveCategories } from "@/lib/procurement/po-queries";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getPOHeader(id);
  return { title: header ? `Receive ${header.poNumber}` : "Receive" };
}

/**
 * Procurement → Purchase orders → the record → receive.
 *
 * A screen of its own rather than a panel on the record, because it has become
 * the place models and units are born: a line with no model gets one here, and
 * every unit gets a barcode, serial, location and condition. Forty units in a
 * side panel is not something anyone can check before pressing the button.
 *
 * Only lines with something still to come are offered, and only while the PO
 * is in a state the ported action will accept a receipt in.
 */
export default async function ReceivePurchaseOrderPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const po = await getPOHeader(id);
  if (!po) notFound();
  if (!mayReceive(user.role)) {
    return <PODenied title={`Receive ${po.poNumber}`} role={user.title} />;
  }

  const [lines, locations, categories, options, refusal] = await Promise.all([
    getPOLines(id),
    getReceivingLocations(),
    getReceiveCategories(),
    getPOFormOptions(),
    // Phase 6: the role, state and approval answer in one — a PO whose approval
    // is outstanding is not offered for receiving, rather than refused on Save.
    receivingRefusal(id, user),
  ]);
  const outstanding = lines.filter((line) => line.remaining > 0);

  const blocked =
    po.status !== "SUBMITTED" && po.status !== "PARTIAL"
      ? po.status === "DRAFT"
        ? `${po.poNumber} is still a draft. Submit it from the record, then receive against it.`
        : `${po.poNumber} is ${PO_STATUS_LABEL[po.status].toLowerCase()} — nothing more can be received against it.`
      : outstanding.length === 0
        ? "Every line on this PO has been received in full."
        : locations.length === 0
          ? "There is nowhere to receive into. Add a location first, so no unit is ever in stock with no idea where it is."
          : refusal;

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Purchase order"
        title={`Receive ${po.poNumber}`}
        blurb={
          <>
            <Link
              href={`/dashboard/purchase-orders/${po.id}`}
              className="text-accent-text hover:underline"
            >
              {po.vendor.name}
            </Link>
            {` · ${po.outstanding} of ${po.ordered} still to come across ${outstanding.length} ${outstanding.length === 1 ? "line" : "lines"}`}
          </>
        }
      />

      {blocked ? (
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            {blocked}{" "}
            <Link
              href={`/dashboard/purchase-orders/${po.id}`}
              className="text-accent-text hover:underline"
            >
              Back to the PO
            </Link>
          </p>
        </section>
      ) : (
        <POReceive
          purchaseOrderId={po.id}
          poNumber={po.poNumber}
          locations={locations}
          categories={categories}
          assets={options.assets}
          defaultLocationId={po.shipToLocation?.id ?? locations[0].id}
          lines={outstanding.map((line) => ({
            id: line.id,
            description: line.description,
            remaining: line.remaining,
            mode: line.mode,
            assetName: line.assetName,
          }))}
        />
      )}
    </>
  );
}
