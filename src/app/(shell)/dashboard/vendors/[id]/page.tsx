import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  SupplyCard,
  VendorAssetsCard,
  VendorPurchaseOrdersCard,
  VendorUnitsCard,
} from "@/components/inventory/vendor-record-cards";
import { dayYear } from "@/lib/format";
import { getVendorHeader } from "@/lib/queries/vendor-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getVendorHeader(id);
  return { title: header?.name ?? "Vendor" };
}

/**
 * Inventory → Vendors → the record.
 *
 * A vendor is where hardware came from and where a warranty claim goes back to,
 * so the screen is organised around that: what was bought, what of it still
 * earns, and who to call. It is not a purchasing screen — raising an order
 * happens on the PO, which owns the lines and the receipt.
 *
 * One record, not two: v1's `/dashboard/settings/vendors` is a byte-for-byte
 * copy of the main one apart from its back-link, and the duplicate is not
 * rebuilt.
 */
export default async function VendorRecordPage({ params }: Params) {
  const { id } = await params;
  const vendor = await getVendorHeader(id);
  if (!vendor) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Vendor"
        title={vendor.name}
        blurb={
          <>
            {vendor.assets === 1 ? "1 asset" : `${vendor.assets} assets`} ·{" "}
            {vendor.units === 1 ? "1 unit" : `${vendor.units} units`} ·{" "}
            {vendor.purchaseOrders === 1
              ? "1 purchase order"
              : `${vendor.purchaseOrders} purchase orders`}{" "}
            · on the books since {dayYear(vendor.createdAt)}
          </>
        }
        actions={
          vendor.contactEmail ? (
            <a
              href={`mailto:${vendor.contactEmail}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Email {vendor.contactName ?? "them"}
            </a>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Bought here" rows={3} />}>
            <SupplyCard id={id} />
          </Suspense>
          <Contact vendor={vendor} />
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense
            fallback={<CardSkeleton title="Assets supplied" rows={8} />}
          >
            <VendorAssetsCard id={id} />
          </Suspense>
          <Suspense
            fallback={<CardSkeleton title="Purchase orders" rows={5} />}
          >
            <VendorPurchaseOrdersCard id={id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Recent units" rows={10} />}>
            <VendorUnitsCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

type Vendor = NonNullable<Awaited<ReturnType<typeof getVendorHeader>>>;

/** Who to call. The whole reason a vendor is a record and not a string. */
function Contact({ vendor }: { vendor: Vendor }) {
  const reachable =
    vendor.contactEmail !== null || vendor.contactPhone !== null;

  return (
    <Card title="Contact">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Name">
          {vendor.contactName ?? <Unset>None on file</Unset>}
        </Field>
        <Field label="Phone">
          {vendor.contactPhone ?? <Unset>None on file</Unset>}
        </Field>
        <Field label="Email">
          {vendor.contactEmail ? (
            <a
              href={`mailto:${vendor.contactEmail}`}
              className="text-accent-text hover:underline"
            >
              {vendor.contactEmail}
            </a>
          ) : (
            <Unset>None on file</Unset>
          )}
        </Field>
        <Field label="Address">
          {vendor.address ?? <Unset>None on file</Unset>}
        </Field>
      </div>
      {!reachable ? (
        <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
          {/* An unreachable vendor is the failure this card exists to catch:
              the hardware is on the shelf and the warranty is unusable. */}
          No email and no phone. A warranty claim against this vendor has nowhere
          to go — add a contact before the next thing they supplied fails.
        </p>
      ) : null}
      {vendor.notes ? (
        <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
          {vendor.notes}
        </p>
      ) : null}
    </Card>
  );
}
