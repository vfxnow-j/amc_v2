/**
 * eBay sheets for the review workbook: every eBay-sold unit's life from
 * Current rentals to the eBay sale, with fees/net from the eBay Transaction
 * report. Report only — nothing here writes to AMC.
 */
import type ExcelJS from 'exceljs'
import type { Pool } from 'pg'
import type { PrismaClient } from '../../../src/generated/prisma/client'
import { depreciationMonthsElapsed, unitCost, type DepreciationMethod } from '../../../src/lib/utils/depreciation'
import { buildLifecycle } from '../../../src/lib/reports/sale-lifecycle'
import { DEFAULT_FILE, loadTransactions, planEbayApply } from '../../lib/ebay-transactions'
import { BASIS_LABEL, loadRentalLife, type Booking, type BookingBasis } from './rental-life'

const r2 = (n: number) => Math.round(n * 100) / 100
const DAY = 24 * 60 * 60 * 1000
const FILL = { green: 'FFC6EFCE', yellow: 'FFFFEB9C', orange: 'FFF8CBAD' } as const
const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as ExcelJS.Fill
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

function sheet(wb: ExcelJS.Workbook, name: string, cols: string[], xSplit = 2) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit }] })
  ws.columns = cols.map((h) => ({ header: h, key: h, width: Math.min(46, Math.max(11, h.length + 2)) }))
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}

export async function addEbaySheets(wb: ExcelJS.Workbook, db: PrismaClient, staging: Pool, txnFile = DEFAULT_FILE) {
  const units = await db.assetUnit.findMany({
    where: { saleChannel: 'EBAY' },
    select: {
      id: true, barcode: true, status: true, soldAt: true, soldPrice: true, saleFees: true,
      notes: true, soldNotes: true, retiredTo: true, purchasePrice: true, landedCostAdjustment: true,
      purchaseDate: true, receivedDate: true,
      asset: { select: { name: true, depreciationMethod: true, usefulLifeMonths: true, salvageValue: true } },
    },
    orderBy: { barcode: 'asc' },
  })
  const orders = loadTransactions(txnFile)
  const plan = planEbayApply(units as never, orders)
  const planBy = new Map(plan.updates.map((x: any) => [x.u.id as string, x]))
  const orderOf = new Map<string, string>()
  for (const [o, us] of plan.cited) for (const u of us as any[]) orderOf.set(u.id, o)
  const heldBy = new Map(plan.held.map((h: string) => [h.slice(0, 14), h]))
  const reportStart = [...orders.values()].filter((o) => o.qty).reduce((m, o) => (o.date < m ? o.date : m), new Date())

  // Current's proposed purchase date/cost, for units whose AMC date is only the import stamp.
  const { rows: cm } = await staging.query(
    'SELECT barcode, candidate_date, date_source, date_pct, current_cost FROM unit_match WHERE barcode = ANY($1)',
    [units.map((u) => u.barcode)])
  const currentBy = new Map(cm.map((r) => [r.barcode as string, r]))

  const bookings = await loadRentalLife(staging, units.map((u) => u.barcode))
  const byUnit = new Map<string, Booking[]>()
  for (const b of bookings) byUnit.set(b.barcode, [...(byUnit.get(b.barcode) ?? []), b])

  // --- eBay Life: one row per unit
  const lifeCols = ['Barcode', 'Asset', 'AMC Status', 'Sold (AMC)', 'eBay Order', 'Order Link', 'eBay Date', 'Sale Price', 'Fees', 'Net', 'Fee Status',
    'Cost', 'Depr. Start', 'Start Source', 'Useful Life (mo)', 'Depr. Ends', 'Age @ Sale (mo)', 'Months Depreciated', 'Past Useful Life @ Sale',
    'Accum. Depreciation', 'Final Book Value',
    'Gain/Loss vs Book', 'Current Bookings', 'Months on Rent', 'First Out', 'Last Back', 'Clients',
    'Own-line', 'Rode w/ Order', 'Bundle', 'Rent: As Recorded', 'Rent: Even Split', 'Rent: Rate Split',
    'Return: As Recorded', 'Return: Even Split', 'Return: Rate Split', 'Check: Rent − Depr + Gain']
  const life = sheet(wb, 'eBay Life', lifeCols)
  const tally = { units: units.length, planned: 0, applied: 0, held: 0, noLink: 0, preReport: 0, withRentals: 0 }
  const totals = { rec: 0, even: 0, rate: 0, net: 0, depr: 0, book: 0, gain: 0, deprUnits: 0, proposedStart: 0, unknownStart: 0 }
  for (const u of units) {
    const p = planBy.get(u.id)
    const orderNo = orderOf.get(u.id) ?? ''
    const price = p ? p.price : u.soldPrice != null ? Number(u.soldPrice) : null
    const fees = p ? p.fees : u.saleFees != null ? Number(u.saleFees) : null
    const net = price != null ? r2(price - (fees ?? 0)) : null
    const alreadyApplied = p && u.saleFees != null && Math.abs(Number(u.saleFees) - p.fees) < 0.01
    let feeStatus: string
    if (alreadyApplied) { feeStatus = 'Applied'; tally.applied++ }
    else if (p) { feeStatus = 'Ready to apply'; tally.planned++ }
    else if (orderNo && heldBy.has(orderNo)) { feeStatus = `Held — ${heldBy.get(orderNo)!.slice(16)}`; tally.held++ }
    else if (u.soldAt && u.soldAt < reportStart) { feeStatus = 'Sold before the eBay report starts'; tally.preReport++ }
    else { feeStatus = 'No order link'; tally.noLink++ }

    const bs = byUnit.get(u.barcode) ?? []
    if (bs.length) tally.withRentals++
    const days = bs.reduce((a, b) => a + (b.starts && b.ends ? Math.max(0, (Date.parse(b.ends) - Date.parse(b.starts)) / DAY) : 0), 0)
    const count = (k: BookingBasis[]) => bs.filter((b) => k.includes(b.basis)).length
    const rec = r2(bs.reduce((a, b) => a + b.asRecorded, 0))
    const even = r2(bs.reduce((a, b) => a + b.evenSplit, 0))
    const rate = bs.some((b) => b.rateSplit == null) ? null : r2(bs.reduce((a, b) => a + (b.rateSplit ?? 0), 0))
    let cost = u.purchasePrice ? unitCost(u.purchasePrice, u.landedCostAdjustment) : null
    // Depreciation to the sale date — the eBay order date when matched.
    const saleDate = p ? p.date : u.soldAt
    const lc = (purchaseDate: Date | null, receivedDate: Date | null, c: number | null) => saleDate ? buildLifecycle({
      cost: c, purchaseDate, receivedDate, soldAt: saleDate, soldPrice: price, saleFees: fees, rentalRevenue: 0,
      depreciationMethod: u.asset.depreciationMethod as DepreciationMethod, usefulLifeMonths: u.asset.usefulLifeMonths,
      salvageValue: u.asset.salvageValue ? Number(u.asset.salvageValue) : 0, checkouts: [],
    }) : null
    let dep = lc(u.purchaseDate, u.receivedDate, cost)
    let startSource = u.receivedDate ? 'AMC received' : 'AMC purchase'
    const cur = currentBy.get(u.barcode)
    if (dep && dep.monthsOwned == null && cur?.candidate_date) {
      // AMC date is a placeholder; use Current's (proposed, not applied).
      if (!cost && cur.current_cost) cost = Number(cur.current_cost)
      dep = lc(new Date(cur.candidate_date), null, cost)
      startSource = `Current proposed (${cur.date_source}${cur.date_pct != null ? `, ${cur.date_pct}%` : ''})`
      totals.proposedStart++
    } else if (!cost && cur?.current_cost) {
      cost = Number(cur.current_cost)
      dep = lc(u.purchaseDate, u.receivedDate, cost)
      startSource += ' · cost from Current (proposed)'
    }
    const lifeMo = u.asset.usefulLifeMonths
    const depStart = dep && dep.monthsOwned != null && dep.acquiredAt ? new Date(`${dep.acquiredAt}T00:00:00Z`) : null
    const age = depStart && saleDate ? depreciationMonthsElapsed(depStart, saleDate) : null
    const book = dep?.bookValueAtSale ?? null
    const accum = book != null && cost ? r2(cost - book) : null
    const gain = book != null && net != null ? r2(net - book) : null
    if (dep && dep.monthsOwned == null) { startSource = 'Unknown (import stamp, no Current date)'; totals.unknownStart++ }
    if (accum != null) { totals.depr += accum; totals.book += book!; totals.deprUnits++; if (gain != null) totals.gain += gain }
    const ret = (rent: number | null) => (rent != null && net != null && cost ? r2(rent + net - cost) : null)
    totals.rec += rec; totals.even += even; totals.rate += rate ?? 0; totals.net += net ?? 0
    const clients = [...bs.reduce((m, b) => m.set(b.client ?? '?', (m.get(b.client ?? '?') ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n})`).join(', ')

    const row = life.addRow({
      'Barcode': u.barcode, 'Asset': u.asset.name, 'AMC Status': u.status, 'Sold (AMC)': iso(u.soldAt),
      'eBay Order': orderNo, 'Order Link': p ? String(p.breakdown.link) : '', 'eBay Date': p ? iso(p.date) : '',
      'Sale Price': price, 'Fees': fees, 'Net': net, 'Fee Status': feeStatus, 'Cost': cost,
      'Depr. Start': depStart ? iso(depStart) : '', 'Start Source': startSource,
      'Useful Life (mo)': lifeMo, 'Depr. Ends': depStart ? iso(new Date(Date.UTC(depStart.getUTCFullYear(), depStart.getUTCMonth() + lifeMo - 1, 1))).slice(0, 7) : '',
      'Age @ Sale (mo)': age, 'Months Depreciated': age != null ? Math.min(age, lifeMo) : null,
      'Past Useful Life @ Sale': age == null ? 'Unknown' : age >= lifeMo ? 'Yes' : 'No',
      'Accum. Depreciation': accum, 'Final Book Value': book, 'Gain/Loss vs Book': gain,
      'Current Bookings': bs.length, 'Months on Rent': r2(days / 30.4375),
      'First Out': bs[0]?.starts ?? '', 'Last Back': bs.at(-1)?.ends ?? '', 'Clients': clients,
      'Own-line': count(['own line']), 'Rode w/ Order': count(['rode with order', 'no charge']), 'Bundle': count(['bundle part', 'bundle price']),
      'Rent: As Recorded': rec, 'Rent: Even Split': even, 'Rent: Rate Split': rate,
      'Return: As Recorded': ret(rec), 'Return: Even Split': ret(even), 'Return: Rate Split': ret(rate),
      'Check: Rent − Depr + Gain': accum != null && gain != null ? r2(rec - accum + gain) : null,
    })
    if (startSource.startsWith('Current') || startSource.includes('proposed')) row.getCell(lifeCols.indexOf('Start Source') + 1).fill = fill(FILL.yellow)
    if (startSource.startsWith('Unknown')) row.getCell(lifeCols.indexOf('Start Source') + 1).fill = fill(FILL.orange)
    row.getCell(lifeCols.indexOf('Fee Status') + 1).fill = fill(
      feeStatus === 'Applied' || feeStatus === 'Ready to apply' ? FILL.green : feeStatus.startsWith('Held') ? FILL.orange : FILL.yellow)
    if (rec !== even || (rate != null && rate !== rec)) {
      for (const k of ['Rent: As Recorded', 'Rent: Even Split', 'Rent: Rate Split']) row.getCell(lifeCols.indexOf(k) + 1).fill = fill(FILL.yellow)
    }
  }

  // --- eBay Bookings (Current): one row per booking
  const bkCols = ['Barcode', 'Order', 'Client', 'Starts', 'Ends', 'Line', 'Basis', 'Package', 'Package Charge', 'Assets in Package',
    'Standalone Rate', 'As Recorded', 'Even Split', 'Rate Split']
  const bk = sheet(wb, 'eBay Bookings (Current)', bkCols)
  const basisTally: Record<string, { n: number; units: Set<string> }> = {}
  for (const b of bookings) {
    const t = (basisTally[b.basis] ??= { n: 0, units: new Set() }); t.n++; t.units.add(b.barcode)
    const row = bk.addRow({
      'Barcode': b.barcode, 'Order': b.orderNumber, 'Client': b.client, 'Starts': b.starts, 'Ends': b.ends, 'Line': b.lineName,
      'Basis': BASIS_LABEL[b.basis], 'Package': b.packageName, 'Package Charge': b.packageCharge, 'Assets in Package': b.assetsInPackage,
      'Standalone Rate': b.standaloneRate, 'As Recorded': b.asRecorded, 'Even Split': b.evenSplit, 'Rate Split': b.rateSplit,
    })
    if (b.basis !== 'own line') row.getCell(bkCols.indexOf('Basis') + 1).fill = fill(b.basis === 'no charge' ? FILL.orange : FILL.yellow)
  }

  // --- eBay Orders (Txn report): one row per order
  const orCols = ['Order', 'Date', 'Title', 'Qty', 'Item Subtotal', 'S&H Charged', 'eBay Fees', 'Shipping Labels', 'Refunds', 'Payout Net', 'AMC Units', 'Status']
  const or = sheet(wb, 'eBay Orders (Txn report)', orCols, 1)
  const orderTally = { linked: 0, held: 0, refunded: 0, unlinked: 0 }
  for (const o of [...orders.values()].filter((o) => o.qty).sort((a, b) => +b.date - +a.date)) {
    const us = (plan.cited.get(o.orderNo) ?? []) as any[]
    const held = heldBy.get(o.orderNo)
    const status = held ? `Held — ${held.slice(16)}` : us.length ? 'Matched' : o.refunds ? 'Refund, no AMC unit' : 'No AMC unit cites it'
    if (held) orderTally.held++; else if (us.length) orderTally.linked++; else if (o.refunds) orderTally.refunded++; else orderTally.unlinked++
    const row = or.addRow({
      'Order': o.orderNo, 'Date': iso(o.date), 'Title': o.title, 'Qty': o.qty, 'Item Subtotal': o.subtotal, 'S&H Charged': o.shipping,
      'eBay Fees': r2(o.fees), 'Shipping Labels': r2(o.labels), 'Refunds': r2(o.refunds), 'Payout Net': r2(o.payoutNet),
      'AMC Units': us.map((u) => u.barcode).join(', '), 'Status': status,
    })
    row.getCell(orCols.indexOf('Status') + 1).fill = fill(status === 'Matched' ? FILL.green : held || o.refunds ? FILL.orange : FILL.yellow)
  }

  const lines: [string, string | number][] = [
    ['EBAY SALES + CURRENT RENTAL LIFE', `eBay Transaction report ${txnFile}; Current rentals from the latest pull. Report only.`],
    ['eBay-sold units in AMC', tally.units],
    ['  fees/net ready to apply', `${tally.planned} units (${plan.updates.length} matched in total; ${tally.applied} already applied)`],
    ['  held', `${tally.held} units — ${plan.held.join(' · ')}`],
    ['  no order link in report period', tally.noLink],
    ['  sold before report starts', `${tally.preReport} (report begins ${iso(reportStart)})`],
    ['eBay orders in report', `${orders.size} — matched ${orderTally.linked}, held ${orderTally.held}, refund only ${orderTally.refunded}, no AMC unit ${orderTally.unlinked}`],
    ['Units with Current rental history', `${tally.withRentals} of ${tally.units} (${bookings.length} bookings)`],
    ...Object.entries(basisTally).map(([k, v]) => [`  ${BASIS_LABEL[k as BookingBasis]}`, `${v.n} bookings / ${v.units.size} units`] as [string, string]),
    ['Depreciation to sale date', `${totals.deprUnits} units with cost + start date: accumulated $${r2(totals.depr).toLocaleString('en-US')}, book at sale $${r2(totals.book).toLocaleString('en-US')}, gain/loss vs book $${r2(totals.gain).toLocaleString('en-US')} (priced units only) · ${totals.proposedStart} use Current's proposed date · ${totals.unknownStart} unknown`],
    ['  how it ties', 'Cost = Accum. Depreciation + Book @ Sale; Gain/Loss = Net − Book; Total Return (as recorded) = Rent − Accum. Depreciation + Gain/Loss'],
    ['Rental revenue: as recorded / even split / rate split', `$${r2(totals.rec).toLocaleString('en-US')} / $${r2(totals.even).toLocaleString('en-US')} / $${r2(totals.rate).toLocaleString('en-US')} (rate split blank for a unit if any of its bundles lacks standalone rates)`],
  ]
  return lines
}
