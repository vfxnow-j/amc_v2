"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { saveUserEntityAccess } from "@/lib/actions/entities-registry";
import { accessCardMode } from "@/lib/entities/access-input";

type Initial = { entityAccess: boolean; scope: "ALL" | "SELECTED"; entityIds: string[] };

/** Which entities one user may open. Shown to super admins only; the action re-checks that. */
export function EntityAccessCard({
  userId,
  role,
  initial,
  entities,
}: {
  userId: string;
  role: string;
  initial: Initial;
  entities: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [access, setAccess] = useState(initial.entityAccess);
  const [scope, setScope] = useState<"ALL" | "SELECTED">(initial.scope);
  const [ids, setIds] = useState<string[]>(initial.entityIds);
  const [outcome, setOutcome] = useState<{ status: "ok" | "error"; message: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const mode = accessCardMode(role);
  if (mode.kind !== "controls") {
    return <p className="px-4 pb-4 text-body text-balance text-ink-muted">{mode.text}</p>;
  }

  const dirty =
    access !== initial.entityAccess ||
    (access &&
      (scope !== initial.scope ||
        (scope === "SELECTED" &&
          (ids.length !== initial.entityIds.length || ids.some((x) => !initial.entityIds.includes(x))))));

  function toggle(id: string) {
    setOutcome(null);
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const box = "size-4 flex-none accent-[var(--color-accent-solid)] disabled:opacity-60";

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <label className="flex items-center gap-2 text-detail text-ink">
        <input
          type="checkbox"
          className={box}
          checked={access}
          disabled={busy}
          onChange={(e) => {
            setOutcome(null);
            setAccess(e.target.checked);
          }}
        />
        Allow entity access
      </label>
      {access ? (
        <>
          <div className="flex gap-4 text-detail text-ink">
            {(["ALL", "SELECTED"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`entity-scope-${userId}`}
                  className={box}
                  checked={scope === value}
                  disabled={busy}
                  onChange={() => {
                    setOutcome(null);
                    setScope(value);
                  }}
                />
                {value === "ALL" ? "All entities" : "Selected"}
              </label>
            ))}
          </div>
          {scope === "SELECTED" ? (
            entities.length === 0 ? (
              <p className="text-detail text-ink-muted">No active entities yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {entities.map((entity) => (
                  <li key={entity.id}>
                    <label className="flex items-center gap-2 text-detail text-ink">
                      <input
                        type="checkbox"
                        className={box}
                        checked={ids.includes(entity.id)}
                        disabled={busy}
                        onChange={() => toggle(entity.id)}
                      />
                      {entity.name}
                    </label>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      ) : null}
      {outcome ? <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice> : null}
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() =>
          startTransition(async () => {
            const result = await saveUserEntityAccess(userId, { entityAccess: access, scope, entityIds: ids });
            setOutcome(result);
            if (result.status === "ok") router.refresh();
          })
        }
        className="h-8 self-start rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save access"}
      </button>
    </div>
  );
}
