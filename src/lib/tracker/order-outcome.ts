import { prisma } from "@/lib/prisma";

/**
 * What an order's outcome does to the tracker (docs/client-tracker.md,
 * "Conversion").
 *
 * A plain module, deliberately not `"use server"`: it takes no role check of its
 * own because it is only ever called from inside actions that already made one
 * (`markLost`) or that are the client's own authenticated quote link
 * (`denyQuote`). Exported from a `"use server"` file it would become a callable
 * endpoint that closes any order's asks — the shape `agreement.ts` shipped with.
 */

/**
 * An order that answered an ask was lost, so the ask was not won after all.
 * Only asks still counting on the order move; one already Lost or marked Can't
 * supply keeps its own reason.
 */
export async function loseAsksLinkedTo(reservationId: string, reason: string | null) {
  await prisma.clientAsk.updateMany({
    where: { reservationId, status: { in: ["WON", "QUOTED", "OPEN"] } },
    data: {
      status: "LOST",
      lostReason: reason ?? "The order was lost",
      closedAt: new Date(),
    },
  });
}
