"use client";

import Link from "next/link";
import { useState } from "react";
import { PILL } from "./fields";
import { MovementForm, type LocationChoice, type MovementTarget } from "./movement-form";

export type BoardRow = {
  key: string; itemId: string; itemName: string; detail: string; where: string
  /** Last release, when known: "Mar 3, 2026 by Sam · to Acme". */
  since: string | null
  target: MovementTarget
}

/** A flat list of gear across items, each with one action. The dialog is owned here so it survives the refresh a save causes. */
export function ReleaseBoard({ slug, rows, locations, canWrite, whereLabel, empty }: {
  slug: string; rows: BoardRow[]; locations: LocationChoice[]; canWrite: boolean; whereLabel: string; empty: string
}) {
  const [target, setTarget] = useState<MovementTarget | null>(null);
  if (rows.length === 0) return <p className="px-4 pb-4 text-body text-ink-muted">{empty}</p>;
  return (
    <>
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full text-left text-body">
          <thead>
            <tr className="text-colhead uppercase text-ink-muted">
              <th className="py-1 pr-3 font-normal">Item</th>
              <th className="py-1 pr-3 font-normal">Serial / tag / quantity</th>
              <th className="py-1 pr-3 font-normal">{whereLabel}</th>
              {rows.some((r) => r.since) ? <th className="py-1 pr-3 font-normal">Last released</th> : null}
              {canWrite ? <th className="py-1 font-normal"><span className="sr-only">Action</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-hairline">
                <td className="py-2 pr-3"><Link href={`/entity/${slug}/inventory/${r.itemId}`} className="font-bold hover:underline">{r.itemName}</Link></td>
                <td className="py-2 pr-3 tabular-nums">{r.detail}</td>
                <td className="py-2 pr-3">{r.where}</td>
                {rows.some((x) => x.since) ? <td className="py-2 pr-3 text-ink-muted">{r.since ?? "—"}</td> : null}
                {canWrite ? (
                  <td className="py-2">
                    <button type="button" className={PILL} aria-label={`${r.target.type === "RETURN" ? "Return" : "Release"} ${r.itemName} ${r.detail} ${r.where}`} onClick={() => setTarget(r.target)}>{r.target.type === "RETURN" ? "Return" : "Release"}</button>
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
