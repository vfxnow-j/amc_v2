"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { CloudHostDialog } from "@/components/reservations/cloud-host-dialog";
import { CloudEnvPicker } from "@/components/reservations/cloud-env-picker";
import {
  addCloudEnvLine,
  getCloudHostConfig,
  saveCloudHost,
  type CloudHostConfig,
} from "@/lib/actions/cloud-host";
import type { StageOutcome } from "@/lib/actions/order-stage";

/**
 * Cloud orders on the order record: add a host, edit one that is already there,
 * add an environment line. The spec-based counterpart of Add a line — it needs
 * no unit, and every figure is priced on the server from the cloud catalogue
 * (lib/cloud/host), with the order's discount and tax applied as for any line.
 */

/** Add a configured host, or an environment item, to a cloud order. */
export function AddCloudHost({ reservationId, packageId }: { reservationId: string; packageId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="px-4 pb-3">
      {outcome ? (
        <Notice tone={outcome.status === "ok" ? "ok" : "error"} className="mb-2">
          {outcome.message}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setOpen(true);
          }}
          className="flex h-8 items-center gap-1 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
        >
          <Plus className="size-[13px]" aria-hidden />
          Add a cloud host
        </button>
        <CloudEnvPicker
          busy={busy}
          onAdd={(product, quantity) =>
            startTransition(async () => {
              const result = await addCloudEnvLine(reservationId, { cloudProductId: product.id, quantity }, packageId);
              setOutcome(result);
              if (result.status === "ok") router.refresh();
            })
          }
        />
      </div>
      <CloudHostDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (input) => {
          const result = await saveCloudHost(reservationId, input, undefined, packageId);
          if (result.status === "error") return result.message;
          setOutcome(result);
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}

/** Re-open a stored host in the configurator: its parts, count, period and name come back as saved. */
export function EditCloudHost({ reservationId, itemId }: { reservationId: string; itemId: string }) {
  const router = useRouter();
  const [config, setConfig] = useState<CloudHostConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={loading}
        title="Change this host's CPU, RAM, storage, GPUs, count or billing period"
        onClick={() => {
          setError("");
          startLoading(async () => {
            const found = await getCloudHostConfig(reservationId, itemId);
            if (found) setConfig(found);
            else setError("That host could not be loaded.");
          });
        }}
        className="flex items-center gap-1 rounded-pill bg-sunken px-2 py-[2px] text-micro text-ink hover:bg-row-hover disabled:opacity-50"
      >
        <Pencil className="size-3" aria-hidden />
        {loading ? "Loading…" : "Edit spec"}
      </button>
      {error ? <span className="text-micro text-destructive">{error}</span> : null}
      <CloudHostDialog
        open={config !== null}
        onOpenChange={(next) => !next && setConfig(null)}
        title="Edit cloud host"
        submitLabel="Save host"
        initial={config}
        onConfirm={async (input) => {
          const result = await saveCloudHost(reservationId, input, itemId);
          if (result.status === "error") return result.message;
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
