import { prisma } from "@/lib/prisma";

/**
 * Reads behind the check-in session (lib/actions/checkin-session.ts). Kept out
 * of the actions file on purpose: an export from a "use server" module is a
 * callable endpoint, and this one takes any order id with no session check.
 */

export type OutUnit = {
  assetUnitId: string;
  barcode: string;
  serialNumber: string | null;
  assetId: string;
  assetName: string;
};

/** Every unit out on the order right now: attached, checked out, not back. */
export async function unitsOutOn(reservationId: string): Promise<OutUnit[]> {
  const rows = await prisma.reservationItemUnit.findMany({
    where: {
      checkedOutAt: { not: null },
      checkedInAt: null,
      reservationItem: { reservationId },
    },
    orderBy: [{ assetUnit: { asset: { name: "asc" } } }, { assetUnit: { barcode: "asc" } }],
    select: {
      assetUnit: {
        select: {
          id: true,
          barcode: true,
          serialNumber: true,
          asset: { select: { id: true, name: true } },
        },
      },
    },
  });
  return rows.map(({ assetUnit }) => ({
    assetUnitId: assetUnit.id,
    barcode: assetUnit.barcode,
    serialNumber: assetUnit.serialNumber,
    assetId: assetUnit.asset.id,
    assetName: assetUnit.asset.name,
  }));
}

