/**
 * Nightly pass of the automatic order flags (overdue return, unpaid invoice,
 * units missing a serial): raise what has become true, clear what no longer is.
 *
 *   npx tsx scripts/sync-auto-flags.ts            # runs against the v2 database in .env
 *
 * Covers open rental and Flow orders, plus any order that still holds an open
 * automatic flag (so it can clear). The scheduled run is the
 * /api/cron/order-flags endpoint (which also sends the digest email); this script is the manual
 * way to run the pass only.
 */
import 'dotenv/config'
import { syncOpenOrders } from '../src/lib/flags/sync'
import { prisma } from '../src/lib/prisma'

async function main() {
  const r = await syncOpenOrders()
  console.log(`${r.checked} orders checked. ${r.raised} raised, ${r.cleared} cleared.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
