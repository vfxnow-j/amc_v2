/**
 * Ramsey Theory Group: RES-2026-00001 held both departments' fleets as one
 * order (imported quantities, $49,325). Current bills two orders, so v2 gets
 * two (owner, 2026-10-19), departments per RTG_Rental_Fleet.xlsx:
 *   0007723 Monthly Rentals (Social)       $24,245 in Current
 *   0007537 Monthly Rentals - Admin + A/V  $9,420  in Current
 * COMPUTER LINES ONLY, at Current's quantities and rates; the monitors,
 * speakers and adapters are broken out by hand. RES-2026-00001 is left alone.
 * DRAFT, v2 only. Writes backups/ an undo list.
 *   npx tsx scripts/current-rms/build-ramsey-orders.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createReservationCore } from "@/lib/orders/create-core";

const day = (s: string) => new Date(`${s}T12:00:00Z`);
// Lines with a v2 asset are linked; the rest are described (no clear v2 model).
type L = { asset?: string; desc: string; qty: number; rate: number };

const ORDERS: { ref: string; project: string; lines: L[] }[] = [
  { ref: "0007723", project: "Monthly Rentals (Social) (Oct 2026)", lines: [
    { asset: "Mac Studio M4 MAX 512GB", desc: "Mac Studio M4 MAX 14C CPU/32C GPU/36GB RAM/512GB SSD", qty: 31, rate: 400 },
    { asset: 'MacBook Air M4 15"', desc: 'MacBook Air M4 15" 10C CPU/10C GPU/24GB RAM/512GB', qty: 20, rate: 250 },
    { asset: "Mac Mini M4", desc: "Mac Mini M4 10C CPU/10C GPU/16GB/256GB", qty: 28, rate: 125 },
  ] },
  { ref: "0007537", project: "Monthly Rentals - Admin + A/V (Oct 2026)", lines: [
    { asset: "Mac Studio M4 MAX 512GB", desc: "Mac Studio M4 MAX 14C CPU/32C GPU/36GB RAM/512GB SSD", qty: 7, rate: 400 },
    { desc: "Mac Studio M1 ULTRA 20-core CPU, 64-core GPU/128GB", qty: 3, rate: 550 },
    { desc: "Mac Studio M1 ULTRA 20-core CPU, 64-core GPU/128GB", qty: 1, rate: 500 },
    { asset: "Mac Mini M4", desc: "Mac Mini M4 10C CPU/10C GPU/16GB/256GB", qty: 9, rate: 150 },
    { desc: 'MacBook Pro 16" M1', qty: 2, rate: 500 },
    { asset: 'MacBook Air M4 15"', desc: 'MacBook Air M4 15"', qty: 3, rate: 250 },
    { desc: 'MacBook Pro M4 13"', qty: 2, rate: 300 },
  ] },
];

async function main() {
  const client = await prisma.client.findFirstOrThrow({ where: { OR: [{ name: { contains: "Ramsey", mode: "insensitive" } }, { companyName: { contains: "Ramsey", mode: "insensitive" } }] } });
  const created: string[] = [];
  for (const o of ORDERS) {
    if (await prisma.reservation.findFirst({ where: { clientId: client.id, notes: { contains: `Current RMS ${o.ref}` } } })) { console.log("exists", o.ref); continue; }
    const items = [];
    for (const l of o.lines) {
      const asset = l.asset ? await prisma.asset.findFirstOrThrow({ where: { name: l.asset } }) : null;
      items.push({ assetId: asset?.id ?? null, description: asset ? null : l.desc, category: asset ? null : "Rental", quantity: l.qty, rate: l.rate, pricingType: "MONTHLY" as const });
    }
    const r = await createReservationCore(
      { clientId: client.id, reservationType: "RENTAL", startDate: day("2026-10-01"), endDate: day("2026-11-01"), projectName: o.project, billingCycleType: "MONTHLY", isRecurring: true, notes: `Split from RES-2026-00001 to match Current RMS ${o.ref}. Computers only; peripherals to be broken out.`, items } as any,
      { userId: null },
    );
    created.push(r.id);
    console.log("created", r.reservationNumber, String(r.total), o.project);
  }
  writeFileSync(`backups/ramsey-orders-undo-${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}.json`, JSON.stringify({ reservations: created }, null, 1));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit());
