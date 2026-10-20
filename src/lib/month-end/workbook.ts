/**
 * Month-end close workbook: roll-forward summary, month-by-month for the
 * year, full asset register at month end, additions, disposals (with eBay
 * fees/net), every unit's lifeline, the depreciation schedule and the
 * exceptions that affect the close.
 *
 * Ported from v1 (Oct 2026). Left in v1's scripts, not here: the eBay
 * Transaction-report overlay, the AMGI buyback lots and the Current RMS rental
 * life sheets, which read files and hardcoded lists rather than the database.
 */
import ExcelJS from 'exceljs'
import { dispositionLabels } from '@/lib/utils/disposal'
import { loadMonthEnd, type LoadedUnit } from '@/lib/queries/month-end'
import {
  bookAt, deprInfo, heldAt, inService, monthBounds, monthKey, r2,
  type MEUnit, type MonthRoll,
} from './roll'

const ORDER_RE = /\b(\d{2}-\d{5}-\d{5})\b/
// Legacy catch-all from the Feb 2026 import cleanup: covers gear that was sold
// AND gear still out with clients. Not a confirmed disposal.
const isLegacyNotInWarehouse = (u: { retiredTo: string | null }) => /not in warehouse/i.test(u.retiredTo ?? '')
const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00'
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')
const CHANNEL: Record<string, string> = { EBAY: 'eBay', CUSTOMER: 'Customer', OTHER: 'Other' }

function sheet(wb: ExcelJS.Workbook, name: string, cols: { h: string; w?: number; money?: boolean }[], xSplit = 1) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit }] })
  ws.columns = cols.map((c) => ({ header: c.h, key: c.h, width: c.w ?? Math.min(40, Math.max(11, c.h.length + 2)), style: c.money ? { numFmt: MONEY } : {} }))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  return ws
}
/** One unit's depreciation expense in a month — same rules as rollMonth. */
function unitDeprInMonth(u: MEUnit, month: string): number {
  if (!inService(u).known) return 0
  const { start, end } = monthBounds(month)
  const atStart = heldAt(u, start), atEnd = heldAt(u, end)
  const base = atStart ? bookAt(u, start) : u.cost
  if (atEnd) return r2(base - bookAt(u, end))
  const d = u.reacquiredAt ? null : u.disposedAt
  if (d && d >= start && d < end && (atStart || inService(u).date! >= start)) return r2(base - bookAt(u, d))
  return 0
}

const HIGHLIGHT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } } as ExcelJS.Fill
const FLAG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } } as ExcelJS.Fill

export type RevenueFn = (from: Date, to: Date) => Promise<{ total: number; recurring: number; nonRecurringRental: number; sales: number }>

export async function buildMonthEndWorkbook(month: string, opts: { revenue?: RevenueFn } = {}) {
  const { revenue } = opts
  const { units, months, byMonth, roll } = await loadMonthEnd(month)
  const { start, end } = monthBounds(month)
  const yearStart = monthBounds(months[0]).start
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VFXNow AMC'

  // ---------- Summary
  const rev = revenue ? await revenue(start, end) : null
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF2563EB' } } })
  ws.columns = [{ width: 46 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }]
  const title = ws.addRow([`Fixed-asset month-end — ${month}`]); title.font = { bold: true, size: 14 }
  ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · each model's useful life (60 months by default), straight line, $0 salvage, from received date, full-month convention`])
  ws.addRow([])
  const hdr = ws.addRow(['Roll-forward (known in-service date)', 'Units', 'Cost', 'Accum. Depreciation', 'Net Book Value']); hdr.font = { bold: true }
  const line = (label: string, count: number | string, cost: number | null, accum: number | null, nbv: number | null, bold = false) => {
    const r = ws.addRow([label, count, cost, accum, nbv]); for (const c of [3, 4, 5]) r.getCell(c).numFmt = MONEY; if (bold) r.font = { bold: true }
  }
  line(`Opening ${iso(start)}`, roll.opening.count, roll.opening.cost, roll.opening.accum, roll.opening.nbv, true)
  line('+ Additions (placed in service)', roll.additions.count, roll.additions.cost, 0, roll.additions.cost)
  line('− Disposals (at book value)', roll.disposals.count, -roll.disposals.cost, -roll.disposals.accum, -roll.disposals.nbv)
  line('− Depreciation for the month', '', null, roll.depreciation, -roll.depreciation)
  line(`Closing ${iso(new Date(end.getTime() - 86400000))}`, roll.closing.count, roll.closing.cost, roll.closing.accum, roll.closing.nbv, true)
  const chk = ws.addRow(['Check (should be 0)', '', null, null, roll.check]); chk.getCell(5).numFmt = MONEY
  if (roll.check !== 0) chk.getCell(5).fill = FLAG
  ws.addRow([])
  const dh = ws.addRow(['Disposals in month', 'Units', 'Amount']); dh.font = { bold: true }
  for (const [label, v] of [['Sale proceeds (before fees)', roll.disposals.proceeds], ['Selling fees (eBay fees + labels)', -roll.disposals.fees],
    ['Net proceeds', roll.disposals.net], ['Book value disposed', -roll.disposals.nbv], ['Gain / (loss) on disposal', roll.disposals.gainLoss]] as [string, number][]) {
    const r = ws.addRow([label, '', v]); r.getCell(3).numFmt = MONEY
  }
  const legacy = (from: Date) => units.filter((u) => u.disposed && u.disposedAt && u.disposedAt >= from && u.disposedAt < end && isLegacyNotInWarehouse(u.src) && inService(u).known)
  for (const [label, xs] of [["  of which legacy 'Not in warehouse' (unconfirmed) — month", legacy(start)], ["  of which legacy 'Not in warehouse' (unconfirmed) — YTD", legacy(yearStart)]] as [string, typeof units][]) {
    const r = ws.addRow([label, xs.length, r2(xs.reduce((a, u) => a + bookAt(u, u.disposedAt!), 0))]); r.getCell(3).numFmt = MONEY; r.font = { italic: true }
  }
  ws.addRow([])
  const uh = ws.addRow(['Carried at cost — in-service date unknown (import stamp)', 'Units', 'Cost']); uh.font = { bold: true }
  for (const [label, n, v] of [['Opening', roll.unknownDate.openCount, roll.unknownDate.openCost], ['Disposed in month', roll.unknownDate.disposedCount, -roll.unknownDate.disposedCost],
    ['Closing', roll.unknownDate.closeCount, roll.unknownDate.closeCost]] as [string, number, number][]) {
    const r = ws.addRow([label, n, v]); r.getCell(3).numFmt = MONEY
  }
  if (rev) {
    ws.addRow([])
    const rh = ws.addRow(['Earned revenue in month (accrual, same as dashboard)', '', 'Amount']); rh.font = { bold: true }
    for (const [label, v] of [['Recurring rentals', rev.recurring], ['Non-recurring rentals', rev.nonRecurringRental], ['Completed sales orders', rev.sales], ['Total', rev.total]] as [string, number][]) {
      const r = ws.addRow([label, '', v]); r.getCell(3).numFmt = MONEY
    }
  }

  // ---------- By Month
  const bm = sheet(wb, 'By Month', [
    { h: 'Month' }, { h: 'Opening Units' }, { h: 'Opening Cost', money: true }, { h: 'Opening Accum.', money: true }, { h: 'Opening NBV', money: true },
    { h: 'Additions', }, { h: 'Additions Cost', money: true }, { h: 'Disposals' }, { h: 'Disposed Cost', money: true }, { h: 'Disposed NBV', money: true },
    { h: 'Net Proceeds', money: true }, { h: 'Gain/(Loss)', money: true }, { h: 'Depreciation', money: true },
    { h: 'Closing Units' }, { h: 'Closing Cost', money: true }, { h: 'Closing Accum.', money: true }, { h: 'Closing NBV', money: true }, { h: 'Check', money: true },
    { h: 'Unknown-date Units (close)' }, { h: 'Unknown-date Cost (close)', money: true },
  ])
  for (const m of byMonth) {
    const r = bm.addRow({
      'Month': m.month, 'Opening Units': m.opening.count, 'Opening Cost': m.opening.cost, 'Opening Accum.': m.opening.accum, 'Opening NBV': m.opening.nbv,
      'Additions': m.additions.count, 'Additions Cost': m.additions.cost, 'Disposals': m.disposals.count, 'Disposed Cost': m.disposals.cost,
      'Disposed NBV': m.disposals.nbv, 'Net Proceeds': m.disposals.net, 'Gain/(Loss)': m.disposals.gainLoss, 'Depreciation': m.depreciation,
      'Closing Units': m.closing.count, 'Closing Cost': m.closing.cost, 'Closing Accum.': m.closing.accum, 'Closing NBV': m.closing.nbv, 'Check': m.check,
      'Unknown-date Units (close)': m.unknownDate.closeCount, 'Unknown-date Cost (close)': m.unknownDate.closeCost,
    })
    if (m.month === month) r.eachCell((c) => (c.fill = HIGHLIGHT))
  }
  const sumRow = bm.addRow({
    'Month': `YTD ${months[0].slice(0, 4)}`, 'Additions': byMonth.reduce((a, m) => a + m.additions.count, 0),
    'Additions Cost': r2(byMonth.reduce((a, m) => a + m.additions.cost, 0)), 'Disposals': byMonth.reduce((a, m) => a + m.disposals.count, 0),
    'Disposed Cost': r2(byMonth.reduce((a, m) => a + m.disposals.cost, 0)), 'Disposed NBV': r2(byMonth.reduce((a, m) => a + m.disposals.nbv, 0)),
    'Net Proceeds': r2(byMonth.reduce((a, m) => a + m.disposals.net, 0)), 'Gain/(Loss)': r2(byMonth.reduce((a, m) => a + m.disposals.gainLoss, 0)),
    'Depreciation': r2(byMonth.reduce((a, m) => a + m.depreciation, 0)),
  })
  sumRow.font = { bold: true }

  // ---------- Register at month end
  const reg = sheet(wb, `Register ${month}`, [
    { h: 'Barcode' }, { h: 'Serial', w: 18 }, { h: 'Asset #' }, { h: 'Asset', w: 34 }, { h: 'Category', w: 18 }, { h: 'Status' }, { h: 'Location', w: 16 },
    { h: 'Ownership' }, { h: 'PO #' }, { h: 'Vendor', w: 18 }, { h: 'In Service' }, { h: 'In-Service Source', w: 22 },
    { h: 'Invoice Price', money: true }, { h: 'Landed Adj.', money: true }, { h: 'Cost', money: true },
    { h: 'Useful Life (mo)' }, { h: 'Depr. Start' }, { h: 'Depr. Ends' }, { h: 'Age (mo)' }, { h: 'Months Depreciated' }, { h: 'Months Remaining' },
    { h: 'Past Useful Life' }, { h: 'Monthly Depr.', money: true }, { h: 'Depr. This Month', money: true }, { h: 'Depr. YTD', money: true },
    { h: 'Accum. Depreciation', money: true }, { h: 'Net Book Value', money: true },
    { h: 'Rental Revenue to Date', money: true }, { h: 'Flags', w: 40 },
  ])
  let regCount = 0
  for (const u of units) {
    if (!heldAt(u, end)) continue
    regCount++
    const s = u.src
    const svc = inService(u)
    const closeNbv = bookAt(u, end)
    const di = deprInfo(u, end)
    const ytd = r2(months.reduce((a, m) => a + unitDeprInMonth(u, m), 0))
    const flags = [
      !u.cost && 'No cost', !svc.known && 'In-service date unknown — not depreciated', u.salvage && `Salvage $${u.salvage} (policy is $0)`,
      u.reacquiredAt && 'Sold then bought back', s.status === 'SOLD' || s.status === 'RETIRED' ? `Status ${s.status} but held` : null,
    ].filter(Boolean).join('; ')
    const r = reg.addRow({
      'Barcode': s.barcode, 'Serial': s.serialNumber, 'Asset #': s.asset.assetNumber, 'Asset': s.asset.name, 'Category': s.asset.category?.name,
      'Status': s.status, 'Location': s.location?.name, 'Ownership': s.ownershipType, 'PO #': s.purchaseOrder?.poNumber,
      'Vendor': s.purchaseOrder?.vendor?.name ?? s.vendor?.name, 'In Service': iso(svc.date), 'In-Service Source': svc.source,
      'Invoice Price': s.purchasePrice != null ? Number(s.purchasePrice) : null, 'Landed Adj.': Number(s.landedCostAdjustment || 0) || null,
      'Cost': u.cost, 'Useful Life (mo)': u.lifeMonths, 'Depr. Start': iso(di.start), 'Depr. Ends': di.endMonth,
      'Age (mo)': di.ageMonths, 'Months Depreciated': di.monthsDepreciated, 'Months Remaining': di.monthsRemaining,
      'Past Useful Life': di.fullyDepreciated == null ? 'Unknown' : di.fullyDepreciated ? 'Yes' : 'No',
      'Monthly Depr.': di.monthly,
      'Depr. This Month': svc.known ? unitDeprInMonth(u, month) : null, 'Depr. YTD': svc.known ? ytd : null,
      'Accum. Depreciation': svc.known ? r2(u.cost - closeNbv) : null, 'Net Book Value': svc.known ? closeNbv : null,
      'Rental Revenue to Date': Number(s.totalRevenue || 0), 'Flags': flags,
    })
    if (flags) r.getCell('Flags').fill = FLAG
  }
  reg.addRow({})
  const rt = reg.addRow({ 'Asset': `TOTAL — ${regCount} units`, 'Cost': roll.closing.cost + roll.unknownDate.closeCost, 'Depr. This Month': roll.depreciation,
    'Depr. YTD': r2(byMonth.reduce((a, m) => a + m.depreciation, 0)), 'Accum. Depreciation': roll.closing.accum, 'Net Book Value': roll.closing.nbv })
  rt.font = { bold: true }

  // ---------- Additions YTD
  const add = sheet(wb, 'Additions', [
    { h: 'Month' }, { h: 'In Service' }, { h: 'Source' }, { h: 'Barcode' }, { h: 'Serial', w: 18 }, { h: 'Asset', w: 34 }, { h: 'Category', w: 18 },
    { h: 'PO #' }, { h: 'Vendor', w: 18 }, { h: 'Invoice Price', money: true }, { h: 'Landed Adj.', money: true }, { h: 'Cost', money: true }, { h: 'Status Today' },
  ])
  const additions = units.filter((u) => { const d = inService(u).date; return d && d >= yearStart && d < end })
    .sort((a, b) => +inService(a).date! - +inService(b).date!)
  for (const u of additions) {
    const s = u.src; const d = inService(u).date!
    const r = add.addRow({
      'Month': monthKey(d), 'In Service': iso(d), 'Source': inService(u).source, 'Barcode': s.barcode, 'Serial': s.serialNumber, 'Asset': s.asset.name,
      'Category': s.asset.category?.name, 'PO #': s.purchaseOrder?.poNumber, 'Vendor': s.purchaseOrder?.vendor?.name ?? s.vendor?.name,
      'Invoice Price': s.purchasePrice != null ? Number(s.purchasePrice) : null, 'Landed Adj.': Number(s.landedCostAdjustment || 0) || null,
      'Cost': u.cost, 'Status Today': s.status,
    })
    if (monthKey(d) === month) r.eachCell((c) => (c.fill = HIGHLIGHT))
  }

  // ---------- Disposals YTD
  const dis = sheet(wb, 'Disposals', [
    { h: 'Month' }, { h: 'Date' }, { h: 'Barcode' }, { h: 'Serial', w: 18 }, { h: 'Asset', w: 34 }, { h: 'Disposition' }, { h: 'Channel' },
    { h: 'Buyer / Recipient', w: 22 }, { h: 'eBay Order', w: 16 }, { h: 'In Service' }, { h: 'Cost', money: true },
    { h: 'Useful Life (mo)' }, { h: 'Depr. Ends' }, { h: 'Age @ Disposal (mo)' }, { h: 'Months Depreciated' }, { h: 'Past Useful Life' },
    { h: 'Accum. Depr. @ Disposal', money: true }, { h: 'Final Book Value', money: true }, { h: 'Sale Price', money: true }, { h: 'Fees', money: true }, { h: 'Net Proceeds', money: true },
    { h: 'Gain/(Loss)', money: true }, { h: 'Price Source' }, { h: 'Flags', w: 36 },
  ])
  const disposals = units.filter((u) => u.disposed && u.disposedAt && u.disposedAt >= yearStart && u.disposedAt < end)
    .sort((a, b) => +a.disposedAt! - +b.disposedAt!)
  for (const u of disposals) {
    const s = u.src; const svc = inService(u)
    const nbv = svc.known ? bookAt(u, u.disposedAt!) : null
    const di = deprInfo(u, u.disposedAt!)
    const net = u.salePrice != null ? r2(u.salePrice - (u.saleFees ?? 0)) : u.disp.disposition === 'SOLD' ? null : 0
    const order = ORDER_RE.exec([s.soldNotes, s.retiredTo, s.notes].filter(Boolean).join(' '))?.[1]
    const flags = [
      u.disp.disposition === 'SOLD' && u.salePrice == null && 'Sold with no price',
      s.saleChannel === 'EBAY' && u.salePrice != null && u.saleFees == null && 'eBay fees not recorded',
      !svc.known && 'In-service date unknown — NBV not computed', !u.cost && 'No cost',
      u.reacquiredAt && `Bought back ${iso(u.reacquiredAt)} — not removed from register`,
      isLegacyNotInWarehouse(s) && "Legacy 'Not in warehouse' — not a confirmed disposal",
          ].filter(Boolean).join('; ')
    const r = dis.addRow({
      'Month': monthKey(u.disposedAt!), 'Date': iso(u.disposedAt), 'Barcode': s.barcode, 'Serial': s.serialNumber, 'Asset': s.asset.name,
      'Disposition': u.disp.disposition ? dispositionLabels[u.disp.disposition] : '', 'Channel': s.saleChannel ? CHANNEL[s.saleChannel] : '',
      'Buyer / Recipient': u.disp.recipient, 'eBay Order': order, 'In Service': iso(svc.date), 'Cost': u.cost,
      'Useful Life (mo)': u.lifeMonths, 'Depr. Ends': di.endMonth, 'Age @ Disposal (mo)': di.ageMonths,
      'Months Depreciated': di.monthsDepreciated, 'Past Useful Life': di.fullyDepreciated == null ? 'Unknown' : di.fullyDepreciated ? 'Yes' : 'No',
      'Accum. Depr. @ Disposal': nbv != null ? r2(u.cost - nbv) : null, 'Final Book Value': nbv,
      'Sale Price': u.salePrice, 'Fees': u.saleFees, 'Net Proceeds': net,
      'Gain/(Loss)': nbv != null && net != null ? r2(net - nbv) : null, 'Price Source': u.disp.salePriceSource, 'Flags': flags,
    })
    if (monthKey(u.disposedAt!) === month) r.eachCell((c) => (c.fill = HIGHLIGHT))
    if (flags) r.getCell('Flags').fill = FLAG
  }

  // ---------- Depreciation Schedule: every unit depreciated this year, month by month
  const monthCols = months.map((m) => ({ h: m, money: true }))
  const sch = sheet(wb, 'Depreciation Schedule', [
    { h: 'Barcode' }, { h: 'Asset', w: 34 }, { h: 'Category', w: 18 }, { h: 'Position' }, { h: 'Cost', money: true }, { h: 'Useful Life (mo)' },
    { h: 'Depr. Start' }, { h: 'Depr. Ends' }, { h: 'Age (mo)' }, { h: 'Months Depreciated' }, { h: 'Months Remaining' }, { h: 'Past Useful Life' },
    { h: 'Monthly Depr.', money: true }, ...monthCols, { h: 'Depr. YTD', money: true }, { h: 'Accum. Depreciation', money: true }, { h: 'Book Value', money: true },
  ], 2)
  const colTotals: Record<string, number> = {}
  for (const u of units) {
    if (!inService(u).known) continue
    const inYear = heldAt(u, yearStart) || heldAt(u, end) || disposals.includes(u) || additions.includes(u)
    if (!inYear) continue
    const s = u.src
    const disposedHere = disposals.includes(u) && !u.reacquiredAt
    const asOf = disposedHere ? u.disposedAt! : end
    const di = deprInfo(u, asOf)
    const per = Object.fromEntries(months.map((m) => [m, unitDeprInMonth(u, m)]))
    const ytd = r2(Object.values(per).reduce((a, v) => a + v, 0))
    for (const [k, v] of Object.entries(per)) colTotals[k] = (colTotals[k] ?? 0) + v
    colTotals.ytd = (colTotals.ytd ?? 0) + ytd
    const r = sch.addRow({
      'Barcode': s.barcode, 'Asset': s.asset.name, 'Category': s.asset.category?.name,
      'Position': disposedHere ? `Disposed ${monthKey(u.disposedAt!)}` : di.fullyDepreciated ? 'Fully depreciated' : 'Depreciating',
      'Cost': u.cost, 'Useful Life (mo)': u.lifeMonths, 'Depr. Start': iso(di.start), 'Depr. Ends': di.endMonth, 'Age (mo)': di.ageMonths,
      'Months Depreciated': di.monthsDepreciated, 'Months Remaining': di.monthsRemaining, 'Past Useful Life': di.fullyDepreciated ? 'Yes' : 'No',
      'Monthly Depr.': di.monthly, ...per, 'Depr. YTD': ytd,
      'Accum. Depreciation': di.bookValue != null ? r2(u.cost - di.bookValue) : null, 'Book Value': di.bookValue,
    })
    if (per[month]) r.getCell(month).fill = HIGHLIGHT
  }
  sch.addRow({})
  const st = sch.addRow({ 'Asset': 'TOTAL', ...Object.fromEntries(months.map((m) => [m, r2(colTotals[m] ?? 0)])), 'Depr. YTD': r2(colTotals.ytd ?? 0) })
  st.font = { bold: true }

  // ---------- Lifeline: every event for every unit held or disposed this year
  const life = sheet(wb, 'Lifeline', [
    { h: 'Barcode' }, { h: 'Asset', w: 34 }, { h: 'Date' }, { h: 'Month' }, { h: 'Event', w: 16 }, { h: 'Detail', w: 50 }, { h: 'Amount', money: true },
  ], 2)
  type Ev = { date: Date; event: string; detail: string; amount: number | null }
  for (const u of units) {
    const s = u.src
    const inScope = heldAt(u, yearStart) || heldAt(u, end) || disposals.includes(u) || additions.includes(u)
    if (!inScope) continue
    const ev: Ev[] = []
    const svc = inService(u)
    ev.push({ date: s.purchaseDate, event: 'Purchased', detail: [s.purchaseOrder?.poNumber, s.purchaseOrder?.vendor?.name ?? s.vendor?.name, !svc.known && 'date is AMC import stamp'].filter(Boolean).join(' · '), amount: u.cost || null })
    if (s.receivedDate) ev.push({ date: s.receivedDate, event: 'In service', detail: 'Received — depreciation starts this month', amount: null })
    for (const c of s.checkouts) {
      const who = c.client ? c.client.companyName || c.client.name : ''
      ev.push({ date: c.checkoutDate, event: 'Out on rental', detail: [c.reservation?.reservationNumber, who].filter(Boolean).join(' · '), amount: c.totalCharge != null ? Number(c.totalCharge) : null })
      if (c.actualReturn) ev.push({ date: c.actualReturn, event: 'Returned', detail: [c.reservation?.reservationNumber, who].filter(Boolean).join(' · '), amount: null })
    }
    for (const m of s.maintenanceRecords) {
      ev.push({ date: m.completionDate ?? m.startDate ?? m.createdAt, event: 'Maintenance', detail: `${m.type} — ${m.description}`.slice(0, 120), amount: m.totalCost != null ? Number(m.totalCost) : null })
    }
    if (u.disposed && u.disposedAt) {
      const nbv = svc.known ? bookAt(u, u.disposedAt) : null
      const detail = [u.disp.disposition ? dispositionLabels[u.disp.disposition] : '', s.saleChannel ? CHANNEL[s.saleChannel] : '', u.disp.recipient,
        u.saleFees != null && `fees $${u.saleFees}`, nbv != null && `NBV $${nbv}`].filter(Boolean).join(' · ')
      ev.push({ date: u.disposedAt, event: u.disp.disposition === 'SOLD' ? 'Sold' : 'Disposed', detail, amount: u.salePrice })
    }
    ev.sort((a, b) => +a.date - +b.date)
    for (const e of ev) {
      life.addRow({ 'Barcode': s.barcode, 'Asset': s.asset.name, 'Date': iso(e.date), 'Month': monthKey(e.date), 'Event': e.event, 'Detail': e.detail, 'Amount': e.amount })
    }
  }

  // ---------- Exceptions
  const ex = sheet(wb, 'Exceptions', [{ h: 'Issue', w: 44 }, { h: 'Barcode' }, { h: 'Asset', w: 34 }, { h: 'Status' }, { h: 'Cost', money: true }, { h: 'Detail', w: 50 }])
  const exc: [string, LoadedUnit, number, string][] = []
  for (const u of units) {
    const s = u.src; const held = heldAt(u, end)
    if (held && !u.cost) exc.push(['Held with no cost', s, u.cost, ''])
    if (held && !inService(u).known) exc.push(['In-service date unknown (import stamp)', s, u.cost, `purchaseDate ${iso(s.purchaseDate)}`])
    if (u.disposed && !u.disposedAt && !u.reacquiredAt) exc.push(['Disposed with no date — outside every period', s, u.cost, `${u.disp.disposition} · ${u.disp.recipient ?? ''}`])
    if (u.disp.disposition === 'SOLD' && u.salePrice == null && u.disposedAt && u.disposedAt >= yearStart && u.disposedAt < end) exc.push(['Sold this year with no price', s, u.cost, iso(u.disposedAt)])
    if (s.saleChannel === 'EBAY' && u.salePrice != null && u.saleFees == null && u.disposedAt && u.disposedAt >= yearStart && u.disposedAt < end) exc.push(['eBay sale without fees', s, u.cost, iso(u.disposedAt)])
    if (u.salvage) exc.push(['Non-zero salvage (policy is $0)', s, u.cost, `$${u.salvage}`])
    if (u.reacquiredAt) exc.push(['Sold then bought back — kept in register', s, u.cost, `sold ${iso(s.soldAt)}, back ${iso(u.reacquiredAt)}`])
  }
  const counts: Record<string, { n: number; cost: number }> = {}
  for (const [issue, s, cost, detail] of exc) {
    ex.addRow({ 'Issue': issue, 'Barcode': s.barcode, 'Asset': s.asset.name, 'Status': s.status, 'Cost': cost, 'Detail': detail })
    const c = (counts[issue] ??= { n: 0, cost: 0 }); c.n++; c.cost += cost
  }
  ws.addRow([])
  const eh = ws.addRow(['Exceptions (see Exceptions sheet)', 'Units', 'Cost']); eh.font = { bold: true }
  for (const [issue, c] of Object.entries(counts)) { const r = ws.addRow([issue, c.n, r2(c.cost)]); r.getCell(3).numFmt = MONEY }

  return {
    workbook: wb,
    filename: `month-end-${month}.xlsx`,
    rowCount: regCount,
    roll, byMonth,
    exceptions: Object.entries(counts).map(([issue, c]) => ({ issue, count: c.n, cost: r2(c.cost) })),
  }
}

export type { MonthRoll }
