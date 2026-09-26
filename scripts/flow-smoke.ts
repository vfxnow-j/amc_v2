/**
 * Flow smoke test against v2's real gear. ALWAYS ROLLS BACK: everything runs in
 * one transaction that ends by throwing, so nothing is ever kept.
 *
 *   npx tsx scripts/flow-smoke.ts            # 24-month term
 *   npx tsx scripts/flow-smoke.ts --term 36
 *
 * Port of v1's scripts/flow-smoke.ts, widened to the whole server path. Inside
 * the transaction it:
 *   1. builds a DRAFT Flow order on two leased held units and one owned unit,
 *      each assigned to its line, with no true cost or rate on any line;
 *   2. reprices it with repriceFlowTx (lib/flow/reprice.ts) and asserts:
 *      - the line subtotals sum to the contract, to the cent;
 *      - flowMonthlyPayment is the schedule's month-1 rate;
 *      - totalCost is Σ trueCost × qty, and each trueCost is the landed basis;
 *      - the lease funding loans are non-empty;
 *      - no next billing date, and the end date is start + term;
 *   3. raises one line's basis and reprices: the contract rises, the cost doesn't;
 *   4. duplicates it with duplicateOrderTx (the body of duplicateReservation) and
 *      asserts the copy is repriced: same contract, same month-1 payment.
 * Then it throws, and checks afterwards that no smoke order exists.
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { repriceFlowTx } from '@/lib/flow/reprice'
import { duplicateOrderTx } from '@/lib/orders/duplicate'
import { flowInputsForOrder } from '@/lib/flow/order-inputs'
import { loadFlowBases } from '@/lib/flow/load-bases'
import { HELD_UNIT_WHERE, loadLeasedHeldUnits } from '@/lib/flow/load-funding'
import { priceFlowLines } from '@/lib/pricing/flow-lines'
import { businessToday } from '@/lib/billing/calendar'
import { addTermMonths } from '@/lib/flow/stored-money'

class Rollback extends Error {}

const arg = (n: string) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const TERM = Math.max(1, Math.round(Number(arg('term')) || 24))
const TAG = `SMOKE-FLW-${Date.now()}`
const $ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cents = (n: unknown) => Math.round(Number(n) * 100)

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

async function pickGear(tx: Prisma.TransactionClient) {
  const leased = await loadLeasedHeldUnits(tx)
  const owned = await tx.assetUnit.findMany({
    where: { ...HELD_UNIT_WHERE, leaseId: null },
    select: { id: true, assetId: true },
  })
  const bases = await loadFlowBases(tx, [...leased.map((u) => u.assetId), ...owned.map((u) => u.assetId)])
  const priceable = (assetId: string) => {
    const b = bases[assetId]
    return !!b && b.basis > 0 && !b.incomplete
  }

  // Two leased units on different assets, preferring different leases.
  const picks: { unitId: string; assetId: string; leaseId: string | null }[] = []
  const usedAssets = new Set<string>()
  const usedLeases = new Set<string>()
  for (const pass of [true, false]) {
    for (const u of leased) {
      if (picks.length >= 2) break
      if (usedAssets.has(u.assetId) || !priceable(u.assetId)) continue
      if (!u.leaseId || (pass && usedLeases.has(u.leaseId))) continue
      picks.push({ unitId: u.unitId, assetId: u.assetId, leaseId: u.leaseId })
      usedAssets.add(u.assetId)
      usedLeases.add(u.leaseId)
    }
  }
  const own = owned.find((u) => !usedAssets.has(u.assetId) && priceable(u.assetId))
  if (picks.length < 2 || !own) throw new Error('Not enough fully costed held gear (2 leased + 1 owned) to smoke-test')
  picks.push({ unitId: own.id, assetId: own.assetId, leaseId: null })
  return { picks, bases }
}

async function main() {
  const client = await prisma.client.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (!client || !user) throw new Error('Need a client and a user')

  try {
    await prisma.$transaction(async (tx) => {
      const { picks, bases } = await pickGear(tx)
      const assets = await tx.asset.findMany({ where: { id: { in: picks.map((p) => p.assetId) } }, select: { id: true, name: true } })
      const nameOf = (id: string) => assets.find((a) => a.id === id)?.name || id

      const start = businessToday()
      console.log(`\nClient: ${client.name}   term ${TERM} months   start ${start.toISOString().slice(0, 10)}`)
      for (const p of picks) {
        console.log(`  ${nameOf(p.assetId).slice(0, 48).padEnd(50)} landed ${$(bases[p.assetId].basis).padStart(12)}  ${p.leaseId ? 'leased' : 'owned'}`)
      }

      // 1. The order, shaped the way createReservation writes a Flow order.
      const order = await tx.reservation.create({
        data: {
          reservationNumber: TAG,
          clientId: client.id,
          reservationType: 'FLOW',
          startDate: start,
          endDate: start,
          status: 'DRAFT',
          billingCycleType: 'MONTHLY',
          billingCycleDay: 1,
          isRecurring: true,
          nextBillingDate: start, // must be cleared by the repricer
          subtotal: 0,
          total: 0,
          createdById: user.id,
          flowTermMonths: TERM,
          flowStartDate: start,
          flowPeriodsBilled: 0,
          flowTaxExempt: true,
        },
      })
      const pkg = await tx.package.create({ data: { reservationId: order.id, name: 'Default', isActive: true, sortOrder: 0 } })
      for (let i = 0; i < picks.length; i++) {
        const item = await tx.reservationItem.create({
          data: {
            reservationId: order.id,
            packageId: pkg.id,
            assetId: picks[i].assetId,
            pricingType: 'MONTHLY',
            rate: 0,
            quantity: 1,
            subtotal: 0,
            sortOrder: i,
          },
        })
        await tx.reservationItemUnit.create({ data: { reservationItemId: item.id, assetUnitId: picks[i].unitId, assignedAt: new Date() } })
      }

      // 2. Reprice.
      await repriceFlowTx(tx, order.id)
      const after = await tx.reservation.findUniqueOrThrow({ where: { id: order.id } })
      const items = await tx.reservationItem.findMany({ where: { reservationId: order.id }, orderBy: { sortOrder: 'asc' } })
      const inputs = await flowInputsForOrder(tx, order.id)
      if (!inputs?.config) throw new Error('flowInputsForOrder returned nothing for the smoke order')
      const priced = priceFlowLines(inputs.lines, inputs.config)
      const sched = priced.result

      console.log(`\n  contract ${$(Number(after.flowContractValue))}   month 1 ${$(sched.rateForMonth(1))}/mo   month ${Math.min(13, TERM)} ${$(sched.rateForMonth(Math.min(13, TERM)))}/mo`)
      console.log(`  subtotal ${$(Number(after.subtotal))}   total ${$(Number(after.total))}   cost ${$(Number(after.totalCost))}   margin ${$(Number(after.totalMargin))}`)
      for (const it of items) {
        console.log(`    ${nameOf(it.assetId!).slice(0, 44).padEnd(46)} rate ${$(Number(it.rate)).padStart(12)}  true cost ${$(Number(it.trueCost)).padStart(12)}`)
      }
      console.log(`  funding: ${inputs.funding.loans.length} loan(s)`)
      for (const l of inputs.funding.loans) console.log(`    ${l.label ?? '?'}  ${$(l.balance)} at ${l.aprPct.toFixed(2)}%, ${l.monthsLeft} mo left`)
      console.log('')

      const lineSum = items.reduce((s, it) => s + cents(it.subtotal), 0)
      check('line subtotals sum to the contract, to the cent', lineSum === cents(after.flowContractValue), `${lineSum / 100} vs ${Number(after.flowContractValue)}`)
      check('order subtotal equals the contract', cents(after.subtotal) === cents(after.flowContractValue))
      check('flowMonthlyPayment is the schedule month-1 rate', cents(after.flowMonthlyPayment) === cents(sched.rateForMonth(1)), `${Number(after.flowMonthlyPayment)} vs ${sched.rateForMonth(1)}`)
      const trueSum = items.reduce((s, it) => s + Number(it.trueCost) * it.quantity, 0)
      check('totalCost equals Σ trueCost', cents(after.totalCost) === cents(trueSum), `${Number(after.totalCost)} vs ${trueSum}`)
      check('each trueCost is its asset\'s landed basis', items.every((it, i) => cents(it.trueCost) === cents(bases[picks[i].assetId].basis)))
      check('each costBasis is floored at trueCost', items.every((it) => Number(it.costBasis) >= Number(it.trueCost)))
      check('funding loans are non-empty', inputs.funding.loans.length > 0 && Array.isArray(inputs.config.funding) && inputs.config.funding.length > 0)
      check('no next billing date on a Flow order', after.nextBillingDate === null)
      check('end date is start + term', after.endDate.getTime() === addTermMonths(start, TERM).getTime(), after.endDate.toISOString().slice(0, 10))
      const unfunded = priceFlowLines(inputs.lines, { ...inputs.config, funding: null, monthsInService: 0 })
      check('funding does not move the price', unfunded.contractValue === priced.contractValue && unfunded.monthlyNow === priced.monthlyNow)

      // 3. Raise one line's basis: the price follows it, the cost does not.
      const raised = items[0]
      await tx.reservationItem.update({ where: { id: raised.id }, data: { costBasis: Number(raised.costBasis) * 1.1 } })
      await repriceFlowTx(tx, order.id)
      const afterRaise = await tx.reservation.findUniqueOrThrow({ where: { id: order.id } })
      check('a raised basis raises the contract', Number(afterRaise.flowContractValue) > Number(after.flowContractValue), `${Number(after.flowContractValue)} → ${Number(afterRaise.flowContractValue)}`)
      check('a raised basis leaves totalCost alone', cents(afterRaise.totalCost) === cents(after.totalCost))
      await tx.reservationItem.update({ where: { id: raised.id }, data: { costBasis: raised.costBasis } })
      await repriceFlowTx(tx, order.id)

      // 4. Duplicate → repriced copy.
      const dup = await duplicateOrderTx(tx, order.id, { userId: user.id, reservationNumber: async () => `${TAG}-DUP` })
      const dupItems = await tx.reservationItem.findMany({ where: { reservationId: dup.id }, orderBy: { sortOrder: 'asc' } })
      console.log(`\n  duplicate ${dup.reservationNumber}: contract ${$(Number(dup.flowContractValue))}, month 1 ${$(Number(dup.flowMonthlyPayment))}/mo`)
      check('duplicate is FLOW with nothing billed', dup.reservationType === 'FLOW' && dup.flowPeriodsBilled === 0)
      check('duplicate has a monthly payment (repriced)', dup.flowMonthlyPayment != null && cents(dup.flowMonthlyPayment) === cents(after.flowMonthlyPayment))
      check('duplicate contract equals the source', cents(dup.flowContractValue) === cents(after.flowContractValue))
      check('duplicate lines sum to its contract', dupItems.reduce((s, it) => s + cents(it.subtotal), 0) === cents(dup.flowContractValue))
      check('duplicate keeps each line\'s true cost', dupItems.every((it, i) => cents(it.trueCost) === cents(items[i].trueCost)))
      check('duplicate has no next billing date', dup.nextBillingDate === null)

      throw new Rollback()
    }, { timeout: 60_000 })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
    console.log('\n  rolled back')
  }

  const left = await prisma.reservation.count({ where: { reservationNumber: { startsWith: TAG } } })
  check('nothing persisted', left === 0, `${left} smoke orders in the database`)
  console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed\n')
  await prisma.$disconnect()
  process.exit(failures ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
