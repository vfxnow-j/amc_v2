"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { dayYear, money } from "@/lib/format";
import {
  deleteDraftInvoices,
  type DraftInvoiceRow,
} from "@/lib/actions/invoice-delete";

/**
 * Clearing out draft invoices, several at a time.
 *
 * Drafts are counted in some totals and nobody has sent them, so they pile up:
 * a billing run that raised one nobody checked, a test invoice, an order that
 * was rebuilt. This lists every draft with its order and amount, lets you tick
 * the ones that are wrong, and deletes only those. Nothing is ticked to start
 * with — deleting is never the default.
 */
export function DraftCleanup({ drafts }: { drafts: DraftInvoiceRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const pickedTotal = useMemo(
    () => drafts.filter((d) => picked.has(d.id)).reduce((sum, d) => sum + d.total, 0),
    [drafts, picked],
  );
  const allPicked = drafts.length > 0 && picked.size === drafts.length;

  if (drafts.length === 0) return null;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-pill bg-sunken px-3 py-2 text-pill text-ink hover:bg-row-hover"
      >
        <Trash2 className="size-[14px]" aria-hidden />
        Clean up drafts ({drafts.length})
      </button>

      <Modal
        wide
        open={open}
        onOpenChange={setOpen}
        title="Clean up draft invoices"
        blurb="Tick the drafts to delete. Nothing has been sent on any of these. Deleting one removes it and its lines for good."
        footer={
          <>
            <span className="mr-auto text-detail text-ink-muted tabular-nums">
              {picked.size === 0
                ? "Nothing ticked"
                : `${picked.size} ticked · ${money(pickedTotal)}`}
            </span>
            <ModalCancel>Close</ModalCancel>
            <ModalConfirm
              tone="danger"
              disabled={busy || picked.size === 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteDraftInvoices([...picked]);
                  if (result.status === "error") {
                    setError(result.message);
                    return;
                  }
                  setPicked(new Set());
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {busy ? "Deleting…" : `Delete ${picked.size || ""} ${picked.size === 1 ? "draft" : "drafts"}`.replace("  ", " ")}
            </ModalConfirm>
          </>
        }
      >
        {error ? (
          <Notice tone="error" className="mb-2">
            {error}
          </Notice>
        ) : null}
        <table className="w-full text-detail">
          <thead>
            <tr className="text-left text-micro uppercase text-ink-muted">
              <th className="w-8 py-1">
                <input
                  type="checkbox"
                  aria-label="Tick every draft"
                  checked={allPicked}
                  onChange={() =>
                    setPicked(allPicked ? new Set() : new Set(drafts.map((d) => d.id)))
                  }
                />
              </th>
              <th className="py-1">Invoice</th>
              <th className="py-1">Client</th>
              <th className="py-1">Order</th>
              <th className="py-1">Created</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr
                key={d.id}
                className="cursor-pointer hover:bg-row-hover"
                onClick={() => toggle(d.id)}
              >
                <td className="py-1">
                  <input
                    type="checkbox"
                    aria-label={`Tick ${d.invoiceNumber}`}
                    checked={picked.has(d.id)}
                    onChange={() => toggle(d.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
                <td className="py-1 font-bold tabular-nums">{d.invoiceNumber}</td>
                <td className="py-1">{d.client}</td>
                <td className="py-1 tabular-nums text-ink-muted">{d.orderNumber ?? "—"}</td>
                <td className="py-1 tabular-nums text-ink-muted">{dayYear(new Date(d.createdAt))}</td>
                <td className="py-1 text-right tabular-nums">{money(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </>
  );
}
