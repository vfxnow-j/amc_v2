/**
 * GET-only: Current RMS invoices (with lines) since a date, saved as JSON.
 *   npx tsx scripts/current-rms/pull-invoices-since.ts 2026-08-01 out.json
 * Never touches AMC or staging.
 */
import fs from 'node:fs'
import { currentClient } from './lib/client'

async function main() {
  const [since, out] = process.argv.slice(2)
  if (!since || !out) throw new Error('usage: pull-invoices-since.ts <YYYY-MM-DD> <out.json>')
  const invoices = await currentClient().getAll('invoices', 'invoices', `&q[invoiced_at_gteq]=${since}&include[]=invoice_items`)
  fs.writeFileSync(out, JSON.stringify(invoices))
  console.log(`invoices ${invoices.length}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
