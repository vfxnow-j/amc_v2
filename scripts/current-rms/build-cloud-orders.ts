/**
 * Three October-2026 orders re-built in v2 from Current RMS (owner, 2026-10-19):
 *   0007867 Create Advertising  -> CLOUD (4 hosts, billed $845/host + 4 RAM upgrades)
 *   0007771 Mfactor Creative    -> CLOUD (1 host, billed $900)
 *   0007771 Mfactor Creative    -> RENTAL (Synology FS1018, billed $1,150)
 *   0007879 Create Advertising  -> CLOUD (extra compute, one line, billed $3,000)
 * v2 only; DRAFT; the billed rate is what the client is charged, the catalogue
 * supplies each host's parts and cost basis. Writes backups/ an undo list.
 *   npx tsx scripts/current-rms/build-cloud-orders.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createReservationCore } from "@/lib/orders/create-core";
import { buildCloudOrderItems, type CloudHostInput } from "@/lib/cloud/host";

const day = (s: string) => new Date(`${s}T12:00:00Z`);
const undo: Record<string, unknown> = { reservations: [], cloudProducts: [], clients: [] };

async function ensureRam48() {
  const have = await prisma.cloudProduct.findUnique({ where: { category_name: { category: "HOST_RAM", name: "48GB" } } });
  if (have) return have;
  // RAM is linear ($0.625/GB/month): 48GB sits between 32GB and 64GB.
  await prisma.cloudProduct.updateMany({ where: { category: "HOST_RAM", sortOrder: { gte: 4 } }, data: { sortOrder: { increment: 1 } } });
  const made = await prisma.cloudProduct.create({
    data: { category: "HOST_RAM", name: "48GB", costHourly: 0.0403, costDaily: 0.9677, costWeekly: 7.5, costMonthly: 30, marginPercent: 25, sortOrder: 4 },
  });
  (undo.cloudProducts as unknown[]).push(made.id);
  return made;
}

async function fillClient(name: string, data: { email: string; phone: string; address: string }) {
  const c = await prisma.client.findFirstOrThrow({ where: { name } });
  undo.clients = [...(undo.clients as unknown[]), { id: c.id, email: c.email, phone: c.phone, address: c.address, billingAddress: c.billingAddress }];
  return prisma.client.update({ where: { id: c.id }, data: { email: c.email ?? data.email, phone: c.phone ?? data.phone, address: c.address ?? data.address, billingAddress: c.billingAddress ?? data.address } });
}

async function cloudOrder(opts: { clientId: string; project: string; ref: string; hosts: CloudHostInput[]; billed: number[]; extras?: { description: string; rate: number; quantity: number }[] }) {
  const exists = await prisma.reservation.findFirst({ where: { clientId: opts.clientId, notes: { contains: opts.ref } } });
  if (exists) { console.log("exists", exists.reservationNumber); return exists; }
  const products = await prisma.cloudProduct.findMany();
  const items: any[] = buildCloudOrderItems(products as any, opts.hosts, []);
  let h = 0;
  for (const it of items) {
    if (!it.parentUid && it.uid.startsWith("cloud-host-")) {
      const rate = opts.billed[h++];
      it.marginPercent = it.costBasis != null && rate > 0 ? Math.round(((rate - it.costBasis) / rate) * 10000) / 100 : null;
      it.rate = rate;
    }
  }
  for (const x of opts.extras ?? []) items.push({ uid: `x-${x.description}`, parentUid: null, description: x.description, category: "Cloud · Add-on", pricingType: "MONTHLY", rate: x.rate, quantity: x.quantity, isOneTime: false });
  const r = await createReservationCore(
    { clientId: opts.clientId, reservationType: "CLOUD", startDate: day("2026-10-01"), endDate: day("2026-11-01"), projectName: opts.project, isRecurring: true, notes: `Rebuilt from Current RMS ${opts.ref}.`, items } as any,
    { userId: null },
  );
  (undo.reservations as unknown[]).push(r.id);
  console.log("created", r.reservationNumber, String(r.total));
  return r;
}

async function main() {
  await ensureRam48();
  const create = await fillClient("Create Advertising", { email: "payables@createadvertising.com", phone: "+1 (310) 280-2999", address: "4201 Wilshire Blvd 6th Fl, Los Angeles, CA 90010" });
  const mf = await fillClient("Mfactor Creative", { email: "mark@mfactorcreative.com", phone: "(818) 736-5209", address: "Burbank, CA 91505" });
  const P = async (cat: string, name: string) => (await prisma.cloudProduct.findUniqueOrThrow({ where: { category_name: { category: cat as any, name } } })).id;

  await cloudOrder({
    clientId: create.id, project: "Cloud Render (Oct Reserved)", ref: "0007867",
    hosts: [{ period: "MONTHLY", quantity: 4, rows: [
      { cloudProductId: await P("HOST_CPU", "16C"), qtyPerHost: 1 }, { cloudProductId: await P("HOST_RAM", "48GB"), qtyPerHost: 1 },
      { cloudProductId: await P("HOST_STORAGE", "512GB"), qtyPerHost: 1 }, { cloudProductId: await P("HOST_STORAGE", "1TB"), qtyPerHost: 1 },
      { cloudProductId: await P("HOST_GRAPHICS", "RTX 4090"), qtyPerHost: 2 } ] }],
    billed: [845], extras: [{ description: "48GB RAM Upgrade", rate: 20, quantity: 4 }],
  });
  // 0007879: extra compute at a high discount, one priced line with no host spec.
  await cloudOrder({
    clientId: create.id, project: "Cloud Burst (12x VMs Discounted)", ref: "0007879",
    hosts: [], billed: [], extras: [{ description: "Extended VM Burst (12x VMs discounted) · 12x VM at discounted rate", rate: 3000, quantity: 1 }],
  });
  await cloudOrder({
    clientId: mf.id, project: "Hardware / Hosting (Oct 2026)", ref: "0007771 cloud",
    hosts: [{ period: "MONTHLY", quantity: 1, hostName: "HP-VM", rows: [
      { cloudProductId: await P("HOST_CPU", "32C"), qtyPerHost: 1 }, { cloudProductId: await P("HOST_RAM", "96GB"), qtyPerHost: 1 },
      { cloudProductId: await P("HOST_STORAGE", "512GB"), qtyPerHost: 1 }, { cloudProductId: await P("HOST_GRAPHICS", "RTX 4090"), qtyPerHost: 2 } ] }],
    billed: [900],
  });
  const dupe = await prisma.reservation.findFirst({ where: { clientId: mf.id, notes: { contains: "0007771 rental" } } });
  if (!dupe) {
    const asset = await prisma.asset.findFirstOrThrow({ where: { name: "FS1018 12-Bay" } });
    const r = await createReservationCore(
      { clientId: mf.id, reservationType: "RENTAL", startDate: day("2026-10-01"), endDate: day("2026-11-01"), projectName: "Hardware / Hosting (Oct 2026)", billingCycleType: "MONTHLY", isRecurring: true, notes: "Rebuilt from Current RMS 0007771 rental.", items: [{ assetId: asset.id, quantity: 1, rate: 1150, pricingType: "MONTHLY" }] } as any,
      { userId: null },
    );
    (undo.reservations as unknown[]).push(r.id);
    console.log("created", r.reservationNumber, String(r.total));
  }
  writeFileSync(`backups/cloud-orders-undo-${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}.json`, JSON.stringify(undo, null, 1));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit());
