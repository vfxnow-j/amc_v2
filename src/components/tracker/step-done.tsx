"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeNextStep } from "@/lib/actions/tracker";

/** Close a next step that happened somewhere the log didn't see. */
export function StepDone({ interactionId }: { interactionId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        startTransition(async () => {
          const result = await completeNextStep(interactionId).catch(() => null);
          setFailed(!result?.ok);
          if (result?.ok) router.refresh();
        })
      }
      className={`rounded-pill px-2 text-micro uppercase hover:bg-row-hover disabled:opacity-50 ${
        failed ? "bg-accent-tint text-accent-on-tint" : "bg-sunken text-ink"
      }`}
      title={failed ? "That didn't save — try again" : "Mark this step done"}
    >
      {failed ? "Retry" : "Done"}
    </button>
  );
}
