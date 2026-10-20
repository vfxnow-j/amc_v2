"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { updateItem } from "@/lib/actions/entity-inventory";
import { NETWORK_ERROR, PILL } from "./fields";
import { ItemFields, type ItemValues } from "./item-form";

/** Edit an item's details. How it is tracked is shown, not editable: it decides what the ledger holds. */
export function EditItem({ slug, itemId, initial, trackingLabel }: { slug: string; itemId: string; initial: ItemValues; trackingLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      let result;
      try {
        result = await updateItem(slug, itemId, value);
      } catch (e) {
        console.error(e);
        return setError(NETWORK_ERROR);
      }
      if (result.status === "error") return setError(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={PILL} onClick={() => { setValue(initial); setError(null); setOpen(true); }}>Edit</button>
      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Edit item"
          blurb={`Tracked ${trackingLabel}. That can't be changed.`}
          wide
          footer={<><ModalCancel /><ModalConfirm onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</ModalConfirm></>}
        >
          <div className="flex flex-col gap-3">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <fieldset disabled={busy} className="border-0 p-0"><ItemFields value={value} onChange={setValue} /></fieldset>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
