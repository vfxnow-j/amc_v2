"use client";

import { useState } from "react";
import { PILL } from "./fields";
import { MovementForm, type LocationChoice, type MovementTarget, type MovementType } from "./movement-form";

export type StockLine = { id: string; locationId: string; locationName: string; deployed: boolean; quantity: number };

/** Counted stock by place, stored or deployed, with the same actions at stock level. */
export function StockTable({ slug, itemId, itemName, stock, locations, canWrite }: {
  slug: string; itemId: string; itemName: string; stock: StockLine[]; locations: LocationChoice[]; canWrite: boolean
}) {
  const [target, setTarget] = useState<MovementTarget | null>(null);
  const open = (s: StockLine, type: MovementType) =>
    setTarget({ kind: "stock", type, itemId, itemName, fromLocationId: s.locationId, fromName: s.locationName, available: s.quantity });

  if (stock.length === 0) return <p className="px-4 pb-4 text-body text-ink-muted">No stock on hand. {canWrite ? "Receive some from the Receive screen." : ""}</p>;

  return (
    <>
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full text-left text-body">
          <thead>
            <tr className="text-colhead uppercase text-ink-muted">
              <th className="py-1 pr-3 font-normal">Location</th>
              <th className="py-1 pr-3 font-normal">State</th>
              <th className="py-1 pr-3 text-right font-normal">Quantity</th>
              {canWrite ? <th className="py-1 font-normal"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => (
              <tr key={s.id} className="border-t border-hairline">
                <td className="py-2 pr-3">{s.locationName}</td>
                <td className="py-2 pr-3">{s.deployed ? "Deployed" : "In storage"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.quantity}</td>
                {canWrite ? (
                  <td className="flex gap-2 py-2">
                    {s.deployed ? (
                      <button type="button" className={PILL} aria-label={`Return ${itemName} at ${s.locationName}`} onClick={() => open(s, "RETURN")}>Return</button>
                    ) : (
                      <>
                        <button type="button" className={PILL} aria-label={`Move ${itemName} at ${s.locationName}`} onClick={() => open(s, "MOVE")}>Move</button>
                        <button type="button" className={PILL} aria-label={`Release ${itemName} at ${s.locationName}`} onClick={() => open(s, "RELEASE")}>Release</button>
                      </>
                    )}
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
