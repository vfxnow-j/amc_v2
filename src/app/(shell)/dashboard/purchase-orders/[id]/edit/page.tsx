import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { PODenied } from "@/components/procurement/po-denied";
import { POForm } from "@/components/procurement/po-form";
import { getSessionUser } from "@/lib/roles";
import { mayWorkOnPO } from "@/lib/procurement/access";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { getPOForEdit, getPOFormOptions } from "@/lib/procurement/po-queries";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const po = await getPOForEdit(id);
  return { title: po ? `Edit ${po.poNumber}` : "Purchase order" };
}

/**
 * Procurement → Purchase orders → the record → edit.
 *
 * Offered at every status but canceled, as v1 offers it. A received PO is still
 * worth correcting — a price the invoice disagreed with, a note — and the
 * ported update refuses the two edits that would rewrite history: removing a
 * received line, or dropping a quantity below what arrived.
 */
export default async function EditPurchaseOrderPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const [po, options] = await Promise.all([getPOForEdit(id), getPOFormOptions()]);
  if (!po) notFound();

  if (po.status !== "CANCELLED" && !mayWorkOnPO(user, po)) {
    return (
      <PODenied
        title={`Edit ${po.poNumber}`}
        role={user.title}
        reason={
          user.role === "STAFF"
            ? po.raisedById === user.id
              ? `${po.poNumber} has been submitted, so it is no longer yours to change. Ask an administrator, or have it revised back to draft.`
              : `${po.poNumber} was raised by someone else. Staff edit their own draft POs; an administrator can change this one.`
            : undefined
        }
      />
    );
  }

  if (po.status === "CANCELLED") {
    return (
      <>
        <PageHeader eyebrow="Procurement · Purchase order" title={`Edit ${po.poNumber}`} />
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-md text-center text-body text-balance text-ink-muted">
            {po.poNumber} is canceled, so it is closed to edits.{" "}
            <Link
              href="/dashboard/purchase-orders/new"
              className="text-accent-text hover:underline"
            >
              Raise a new PO
            </Link>{" "}
            if the hardware is still needed.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement · Purchase order"
        title={`Edit ${po.poNumber}`}
        blurb={
          po.status === "DRAFT"
            ? "A draft — nothing here has gone to the vendor yet."
            : `${PO_STATUS_LABEL[po.status]}. The vendor may already be working from the version they were sent; a received line cannot be removed.`
        }
      />
      <POForm
        mode="edit"
        poId={po.id}
        initial={po.initial}
        onLease={po.onLease}
        vendors={options.vendors}
        locations={options.locations}
        assets={options.assets}
        cancelHref={`/dashboard/purchase-orders/${po.id}`}
      />
    </>
  );
}
