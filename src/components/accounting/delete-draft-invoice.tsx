"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { deleteDraftInvoices } from "@/lib/actions/invoice-delete";

/** Deleting this one draft, from its own record. Offered on drafts only. */
export function DeleteDraftInvoice({ id, invoiceNumber }: { id: string; invoiceNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-4 py-2 text-pill text-destructive hover:bg-row-hover"
      >
        Delete draft
      </button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${invoiceNumber}`}
        blurb="It is a draft and nothing was sent, so it comes off the books with its lines. This can't be undone."
        footer={
          <>
            <ModalCancel>Keep it</ModalCancel>
            <ModalConfirm
              tone="danger"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteDraftInvoices([id]);
                  if (result.status === "error") {
                    setError(result.message);
                    return;
                  }
                  router.push("/dashboard/invoices?view=draft");
                  router.refresh();
                })
              }
            >
              {busy ? "Deleting…" : "Delete draft"}
            </ModalConfirm>
          </>
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Modal>
    </>
  );
}
