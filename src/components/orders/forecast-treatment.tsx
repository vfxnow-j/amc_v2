import Link from "next/link";
import { ChoiceSelect } from "@/components/forecast/choice-select";
import { DealControls } from "@/components/orders/deal-controls";
import { STATUS_LABEL } from "@/lib/reservations/status";
import { prisma } from "@/lib/prisma";
import type { ChoiceMode } from "@/lib/forecast/groups";

/**
 * How the forecast and the BT Report treat this open order, on the order itself.
 *
 * The same call the Forecast page offers: Auto lets the forecast count one
 * version of a deal (the furthest along, freshest), Count this forces it in,
 * Leave out drops it, Separate deal stops it being folded into another. Shown
 * only to admins, and only while the order is still a draft or a sent quote.
 */
export async function ForecastTreatment({ id }: { id: string }) {
  const [choice, member] = await Promise.all([
    prisma.forecastChoice.findUnique({ where: { reservationId: id }, select: { mode: true } }),
    prisma.dealGroupMember.findUnique({
      where: { reservationId: id },
      select: {
        group: {
          select: {
            temperature: true,
            members: {
              select: {
                reservation: {
                  select: {
                    id: true,
                    reservationNumber: true,
                    status: true,
                    total: true,
                    client: { select: { name: true, companyName: true } },
                    forecastChoice: { select: { mode: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  const mode = (choice?.mode as ChoiceMode | undefined) ?? null;
  const others = member?.group.members.map((m) => m.reservation).filter((r) => r.id !== id) ?? [];
  const inDeal = !!member;
  return (
    <section className="flex flex-col gap-2 rounded-card bg-panel px-4 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-micro uppercase text-ink-muted">Forecast &amp; BT Report</span>
        <ChoiceSelect orderId={id} value={mode} />
        <p className="text-detail text-ink-muted">
          {inDeal
            ? mode === "SKIP"
              ? "Left out of this deal's count."
              : mode === "COUNT"
                ? "Counts in this deal."
                : "Auto: the furthest-along order in this deal counts unless you pick which ones do."
            : mode === "SKIP"
              ? "Left out: this order is not counted anywhere."
              : mode === "COUNT"
                ? "Counted regardless of other versions of the same deal."
                : mode === "SEPARATE"
                  ? "Counted as its own deal, never folded into another."
                  : "Auto: counted unless another version of the same deal is further along."}
        </p>
      </div>
      {inDeal ? (
        <ul className="flex flex-col gap-1 text-detail">
          <li className="text-micro uppercase text-ink-muted">Same deal as</li>
          {others.map((other) => (
            <li key={other.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/dashboard/orders/${other.id}`} className="font-bold text-accent-text hover:underline">
                {other.reservationNumber}
              </Link>
              <span className="text-ink-muted">
                {other.client.companyName || other.client.name} · {STATUS_LABEL[other.status as keyof typeof STATUS_LABEL] ?? other.status} ·{" "}
                {Number(other.total).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </span>
              <ChoiceSelect orderId={other.id} value={(other.forecastChoice?.mode as ChoiceMode | undefined) ?? null} />
            </li>
          ))}
        </ul>
      ) : null}
      <DealControls
        orderId={id}
        inDeal={inDeal}
        temperature={(member?.group.temperature as "HOT" | "WARM" | "COLD" | null | undefined) ?? null}
      />
    </section>
  );
}
