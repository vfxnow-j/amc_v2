"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { createTemplate } from "@/lib/actions/package-templates";

/** Name a new package, then build it on its own page. */
export function NewPackage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function create() {
    setError("");
    startTransition(async () => {
      const result = await createTemplate({ name, description });
      if (result.status === "error") setError(result.message);
      else if (result.href) router.push(result.href);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-pill bg-accent-solid px-[14px] py-2 text-pill text-accent-on-solid"
      >
        <Plus className="size-[13px]" aria-hidden /> New package
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="New package"
        blurb="Name it here, then add its lines. It appears in Add line on quotes once it has some."
        footer={
          <>
            {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
            <ModalCancel />
            <ModalConfirm onClick={create} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create and add lines"}
            </ModalConfirm>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Name</span>
            <input
              id="package-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Threadripper edit suite"
              className="h-9 rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">Description</span>
            <input
              id="package-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional — what it is for"
              className="h-9 rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
