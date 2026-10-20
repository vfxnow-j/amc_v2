/**
 * Read-only: what Current RMS invoiced in a month against the recurring orders
 * v2 holds, per client. Current's side comes from pull-invoices-since.ts (JSON);
 * member names come from the staging copy. Nothing is written anywhere.
 *   npx tsx scripts/current-rms/check-monthly-invoices.ts <invoices.json> 2026-10
 */
import "dotenv/config";
import fs from "node:fs";
import { Pool } from "pg";
import { prisma } from "@/lib/prisma";

const norm = (s: string) => s.toLowerCase().replace(/\b(llc|inc|corp|co|ltd|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

async function main() {
  const [file, month] = process.argv.slice(2);
  if (!file || !/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("usage: check-monthly-invoices.ts <invoices.json> <YYYY-MM>");
  const invoices = (JSON.parse(fs.readFileSync(file, "utf8")) as any[]).filter((i) => String(i.invoiced_at).startsWith(month) && i.status_name !== "Voided");
  const st = new Pool({ connectionString: process.env.CURRENT_RMS_STAGING_URL });
  const { rows } = await st.query(`select distinct on (current_id) current_id, data->>'name' as name from raw_record where entity='members' order by current_id, run_id desc`);
  const names = new Map(rows.map((r) => [Number(r.current_id), r.name as string]));

  const cur = new Map<string, { name: string; total: number; invoices: string[] }>();
  for (const i of invoices) {
    const name = names.get(Number(i.member_id)) ?? `member ${i.member_id}`;
    const e = cur.get(norm(name)) ?? { name, total: 0, invoices: [] };
    e.total += Number(i.charge_total);
    e.invoices.push(`${i.number} ${money(Number(i.charge_total))} ${String(i.subject ?? "").slice(0, 38)}`);
    cur.set(norm(name), e);
  }

  const orders = await prisma.reservation.findMany({
    where: { isRecurring: true, notBilled: false, status: { in: ["ACTIVE", "APPROVED", "PREPARING", "SHIPPED", "DRAFT"] }, reservationType: { in: ["RENTAL", "CLOUD", "RENT_TO_OWN", "FLOW"] } },
    select: { reservationNumber: true, reservationType: true, status: true, total: true, projectName: true, client: { select: { name: true, companyName: true } } },
  });
  const v2 = new Map<string, { name: string; active: number; draft: number; list: string[] }>();
  for (const o of orders) {
    const name = o.client.companyName || o.client.name;
    const e = v2.get(norm(name)) ?? { name, active: 0, draft: 0, list: [] };
    if (o.status === "DRAFT") e.draft += Number(o.total); else e.active += Number(o.total);
    e.list.push(`${o.reservationNumber} ${o.status} ${money(Number(o.total))}`);
    v2.set(norm(name), e);
  }

  const keys = [...new Set([...cur.keys(), ...v2.keys()])].sort();
  let ok = 0;
  const lines: string[] = [];
  for (const k of keys) {
    const c = cur.get(k), v = v2.get(k);
    if (c && v && Math.abs(c.total - (v.active + v.draft)) < 0.01) { ok++; continue; }
    const tag = !v ? "NOT IN v2" : !c ? "NO CURRENT INVOICE" : `DIFF ${money(c.total - (v.active + v.draft))}`;
    lines.push(`${tag.padEnd(20)} ${(c?.name ?? v!.name).slice(0, 34).padEnd(35)} Current ${money(c?.total ?? 0).padStart(11)}  v2 ${money((v?.active ?? 0) + (v?.draft ?? 0)).padStart(11)}\n${(c?.invoices ?? []).map((x) => "      cur  " + x).join("\n")}${c ? "\n" : ""}${(v?.list ?? []).map((x) => "      v2   " + x).join("\n")}`);
  }
  console.log(`${month}: ${cur.size} clients invoiced in Current, ${ok} match v2 to the cent\n`);
  console.log(lines.join("\n"));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit());
