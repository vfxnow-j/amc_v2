import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { unitFunding, leaseBalance, FLOW_LEASE_ASSUMPTION } from "@/lib/pricing/lease-funding";
import { loadLeaseTerms, loadLeasedHeldUnits } from "@/lib/flow/load-funding";

/**
 * READ-ONLY. Check the lease split on real data: for the three largest leases,
 * the lease balance, how many held units it covers, the sum of the per-unit split
 * (must equal the balance to the cent) and one sample unit's share. Flags any
 * lease whose held units cost $0 in total (the split then falls back to equal
 * shares, and an assumed lease finances nothing).
 *
 *   npx tsx scripts/flow-funding-preview.ts
 */
const WANTED = ["FCB REFI 2024", "6786821", "6783781"];
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

async function main() {
  const asOf = new Date();
  const [leases, held, raw] = await Promise.all([
    loadLeaseTerms(prisma),
    loadLeasedHeldUnits(prisma),
    prisma.lease.findMany({ select: { id: true, leaseName: true, leaseNumber: true, status: true } }),
  ]);
  const funding = unitFunding(leases, held, asOf, FLOW_LEASE_ASSUMPTION);
  console.log(`As of ${asOf.toISOString().slice(0, 10)}: ${leases.length} open leases, ${held.length} held leased units, ${funding.size} units funded\n`);

  for (const want of WANTED) {
    const row = raw.find((l) => l.leaseNumber === want || l.leaseName === want || l.leaseName.includes(want) || l.leaseNumber.includes(want));
    if (!row) { console.log(`${want}: NOT FOUND`); continue; }
    const terms = leases.find((l) => l.id === row.id);
    if (!terms) { console.log(`${want} (${row.leaseNumber}): status ${row.status} — not open, skipped`); continue; }
    const units = held.filter((u) => u.leaseId === row.id);
    const parts = units.map((u) => funding.get(u.unitId)!).filter(Boolean);
    const whole = terms.monthlyPayment > 0 ? leaseBalance(terms, asOf, FLOW_LEASE_ASSUMPTION, 0) : null;
    const splitSum = Math.round(parts.reduce((s, p) => s + p.balance * 100, 0)) / 100;
    const leaseBal = whole ? whole.balance : splitSum; // an assumed lease has no whole balance: it is the sum of per-unit notes
    const totalCost = units.reduce((s, u) => s + u.cost, 0);
    const sample = parts[0];
    console.log(`${row.leaseName} / ${row.leaseNumber}  [${row.status}]`);
    console.log(`  terms: payment ${money(terms.monthlyPayment)}, APR ${terms.aprPct.toFixed(2)}%, ${terms.termMonths} mo from ${terms.startDate.toISOString().slice(0, 10)}${whole ? "" : "  (NO TERMS — assumed per unit)"}`);
    console.log(`  lease balance: ${money(leaseBal)}${whole ? `, ${whole.monthsLeft} payments left` : ""}`);
    console.log(`  held units: ${units.length} (landed cost ${money(totalCost)}, ${units.filter((u) => u.cost <= 0).length} uncosted)`);
    console.log(`  split sum: ${money(splitSum)}  ${whole ? (splitSum === whole.balance ? "= balance to the cent" : `MISMATCH by ${money(splitSum - whole.balance)}`) : "(sum of assumed notes)"}`);
    if (sample) console.log(`  sample unit ${sample.unitId}: share ${(sample.share * 100).toFixed(4)}%, balance ${money(sample.balance)}, payment ${money(sample.payment)}/mo, ${sample.monthsLeft} mo left${sample.assumed ? " (assumed)" : ""}`);
    if (units.length && totalCost <= 0) console.log(`  FLAG: held units total $0 cost — split is by head count${whole ? "" : "; assumed notes are all $0"}`);
    if (!units.length) console.log(`  FLAG: no held units — this balance sits on no gear`);
    console.log("");
  }

  const zero = leases.filter((l) => { const u = held.filter((h) => h.leaseId === l.id); return u.length > 0 && u.reduce((s, h) => s + h.cost, 0) <= 0; });
  console.log(`Open leases whose held units total $0 cost: ${zero.length ? zero.map((l) => l.label).join(", ") : "none"}`);
}

main().finally(() => prisma.$disconnect());
