"use client";

import { useState } from "react";
import { PILL } from "./fields";
import { MovementForm, type LocationChoice, type MovementTarget, type MovementType } from "./movement-form";

export type UnitRow = {
  id: string; serial: string | null; ownerTag: string | null; scanTag: string | null
  status: "IN_STORAGE" | "DEPLOYED" | "RETURNED_TO_OWNER"; locationName: string | null
}

const unitName = (u: UnitRow) => u.serial || u.ownerTag || u.scanTag || "unit";
const STATUS = { IN_STORAGE: "In storage", DEPLOYED: "Deployed", RETURNED_TO_OWNER: "Returned to owner" } as const;

/** Serialized units with Move / Release / Return per row. The dialog is owned here so it outlives the refresh a save causes. */
export function UnitTable({ slug, itemName, units, locations, canWrite }: {
  slug: string; itemName: string; units: UnitRow[]; locations: LocationChoice[]; canWrite: boolean
}) {
  const [target, setTarget] = useState<MovementTarget | null>(null);
  const open = (u: UnitRow, type: MovementType) =>
    setTarget({ kind: "unit", type, unitId: u.id, itemName, label: u.serial || u.ownerTag || u.scanTag || "Unit", fromName: u.locationName });

  if (units.length === 0) return <p className="px-4 pb-4 text-body text-ink-muted">No units yet. {canWrite ? "Receive some from the Receive screen." : ""}</p>;

  return (
    <>
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full text-left text-body">
          <thead>
            <tr className="text-colhead uppercase text-ink-muted">
              <th className="py-1 pr-3 font-normal">Serial</th>
              <th className="py-1 pr-3 font-normal">Owner tag</th>
              <th className="py-1 pr-3 font-normal">Scan tag</th>
              <th className="py-1 pr-3 font-normal">Status</th>
              <th className="py-1 pr-3 font-normal">Location</th>
              {canWrite ? <th className="py-1 font-normal"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-t border-hairline">
                <td className="py-2 pr-3 tabular-nums">{u.serial ?? "—"}</td>
                <td className="py-2 pr-3 tabular-nums">{u.ownerTag ?? "—"}</td>
                <td className="py-2 pr-3 tabular-nums">{u.scanTag ?? "—"}</td>
                <td className="py-2 pr-3">{STATUS[u.status]}</td>
                <td className="py-2 pr-3">{u.locationName ?? "—"}</td>
                {canWrite ? (
                  <td className="flex gap-2 py-2">
                    {u.status === "IN_STORAGE" ? (
                      <>
                        <button type="button" className={PILL} aria-label={`Move ${itemName} ${unitName(u)}`} onClick={() => open(u, "MOVE")}>Move</button>
                        <button type="button" className={PILL} aria-label={`Release ${itemName} ${unitName(u)}`} onClick={() => open(u, "RELEASE")}>Release</button>
                      </>
                    ) : null}
                    {u.status === "DEPLOYED" ? <button type="button" className={PILL} aria-label={`Return ${itemName} ${unitName(u)}`} onClick={() => open(u, "RETURN")}>Return</button> : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target ? <MovementForm slug={slug} target={target} locations={locations} onClose={() => setTarget(null)} /> : null}
    </>
  );
}
