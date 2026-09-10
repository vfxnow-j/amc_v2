import Link from "next/link";
import { Tile, TileHeader } from "@/components/dashboard/tile";
import { getDecisions } from "@/lib/queries/overview";

export async function DecisionsCard() {
  const decisions = await getDecisions();

  return (
    <Tile className="flex-none">
      <TileHeader title="Needs a decision" />

      {decisions.length === 0 ? (
        <p className="text-detail text-ink-muted">
          Nothing needs a call right now — no expiring quotes and no ageing
          invoices. Insights refresh as orders move.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {decisions.map((decision) => {
            const body = (
              <>
                <p className="text-body font-bold">{decision.title}</p>
                <p className="text-detail text-ink-muted">
                  {decision.description}
                </p>
              </>
            );

            return (
              <li key={decision.id}>
                {decision.link ? (
                  <Link
                    href={decision.link}
                    className="block rounded-well bg-row-alt p-[10px] transition-colors duration-[160ms] hover:bg-row-hover"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-well bg-row-alt p-[10px]">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}

export function SideCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Tile className="flex-none">
      <div className="mb-3 h-4 w-32 animate-pulse rounded-row bg-sunken" />
      <div className="flex flex-col gap-[6px]">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-[52px] animate-pulse rounded-well bg-row-alt"
          />
        ))}
      </div>
    </Tile>
  );
}
