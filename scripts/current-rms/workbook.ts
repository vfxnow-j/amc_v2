/**
 * Review workbook: Full Inventory columns + Current values inline, colour-graded.
 *   npx tsx scripts/current-rms/workbook.ts
 */
import { mkdirSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { amcReadonlyPrisma } from './lib/amc-prisma'
import { amcReadonlyPool, assertV2Schema, stagingPool } from './lib/staging'
import { proposeRow, resection, type Proposal, type SaleProposal } from './lib/proposed'
import { snapshot } from './lib/snapshot'
import { band, combined } from './lib/confidence'
import { buildFullInventoryRows, FULL_INVENTORY_COLUMNS } from './lib/full-inventory-rows'
import { addEbaySheets } from './lib/ebay-sheets'
import { proposalFor, saleFor as saleForRow } from './lib/proposals' // ADAPTED: lifted out of this file so apply-high-confidence.ts shares it

async function main() {
  // ADAPTED: baseline workbook lives in v1's backups (read-only file read); v2 has no copy.
  const BASELINE = '/home/docker/projects/vfxnow-amc/backups/current-rms-baseline-2026-09-18/full-inventory-report-2026-09-18.xlsx'
  const FILL = { green: 'FFC6EFCE', yellow: 'FFFFEB9C', orange: 'FFF8CBAD', blue: 'FFBDD7EE' } as const
  const STRONG = { yellow: 'FFFFD966', orange: 'FFF4B084' } as const
  const LABEL = { green: 'Confirmed', yellow: 'Changed', orange: 'Questionable', none: '' } as Record<string, string>
  const STABLE = ['Asset Name', 'Category', 'Serial Number', 'Status', 'Location', 'Ownership Type', 'Purchase Date', 'Purchase Price', 'Landed Cost Adj.', 'Total Cost', 'Disposition', 'Disposed On', 'Sale Price']
  const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as ExcelJS.Fill
  const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10)
  const val = (v: unknown) => { if (v && typeof v === 'object' && 'result' in v) v = (v as { result: unknown }).result; return v == null ? '' : typeof v === 'number' ? v.toFixed(2) : String(v) }

  const db = amcReadonlyPrisma()
  const staging = stagingPool()
  await assertV2Schema(staging)
  const inv = await buildFullInventoryRows(db)
  const { rows: um } = await staging.query('SELECT m.*, s.store AS current_store FROM unit_match m LEFT JOIN stock_item s ON s.id = m.current_stock_id')
  const match = new Map(um.map((r) => [r.barcode as string, r]))
  const { rows: saleRows } = await staging.query(`SELECT * FROM unit_sale ORDER BY CASE WHEN outcome = 'possible missed sale' THEN 0 WHEN outcome LIKE 'conflict%' THEN 1 WHEN outcome LIKE 'Current shows sold%' THEN 2 WHEN outcome LIKE 'fills%' THEN 3 ELSE 4 END, sale_date, barcode`)
  const saleBy = new Map(saleRows.map((r) => [r.barcode as string, r]))
  const { rows: holeRows } = await staging.query('SELECT * FROM sale_hole ORDER BY order_date, order_number, row_key')
  const { rows: seenRows } = await staging.query('SELECT * FROM unit_last_seen')
  const seenBy = new Map(seenRows.map((r) => [r.barcode as string, r]))
  const seenText = (x: any) => x ? `${x.order_number} · ${x.client ?? '?'} · ${x.starts ? new Date(x.starts).toISOString().slice(0, 10) : '?'}${x.returned ? ' · returned' : ` · NOT returned (${x.asset_status})`}` : ''
  const { rows: poRows } = await staging.query('SELECT * FROM po_line_link ORDER BY ordered_at, po_number, row_key')
  const { rows: onlyRows } = await staging.query('SELECT * FROM current_only ORDER BY asset_number')
  const { rows: [run] } = await staging.query('SELECT id, source, finished_at FROM pull_run WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')

  // Baseline for "changed since baseline"
  const bwb = new ExcelJS.Workbook()
  await bwb.xlsx.readFile(BASELINE)
  const bws = bwb.worksheets[0]
  const bh = (bws.getRow(1).values as unknown[]).slice(1).map(String)
  const baseline = new Map<string, Record<string, string>>()
  bws.eachRow((r, n) => { if (n === 1) return; const o: Record<string, string> = {}; bh.forEach((h, c) => (o[h] = val(r.getCell(c + 1).value))); if (o['Barcode']) baseline.set(o['Barcode'], o) })

  const wb = new ExcelJS.Workbook()
  const sum = wb.addWorksheet('Summary') // first tab; filled in at the end

  // --- Units
  const extra = ['Match', 'Current Barcode', 'Current Serial', 'Current → Date', 'Date Source', 'Current → Cost', 'Cost Basis', 'Current PO #', 'Supplier', 'Current Status', 'Current Store', 'Current Sale', 'Last Current Order', 'Grade', 'Reason', 'Decision', 'Notes', 'Changed Since Baseline']
  const units = wb.addWorksheet('Units', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] })
  units.columns = [...FULL_INVENTORY_COLUMNS, ...extra].map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }))
  units.getRow(1).font = { bold: true }
  const col = (h: string) => FULL_INVENTORY_COLUMNS.indexOf(h) + 1 || FULL_INVENTORY_COLUMNS.length + extra.indexOf(h) + 1
  const tally: Record<string, number> = { green: 0, yellow: 0, orange: 0, none: 0, nodata: 0 }
  for (const r of inv) {
    const bc = String(r['Barcode'] ?? '')
    const m = bc ? match.get(bc) : undefined
    const b = bc ? baseline.get(bc) : undefined
    const changed = !bc ? '' : !b ? 'new since baseline' : STABLE.filter((h) => val(r[h]) !== b[h]).join(', ')
    const row = units.addRow({
      ...r,
      'Match': m?.match_method ?? (bc ? (/^(GPL|META)/i.test(bc) ? 'excluded (GPL/META)' : 'not in Current') : ''),
      'Current Barcode': m?.current_asset_number ?? '', 'Current Serial': m?.current_serial ?? '',
      'Current → Date': m?.candidate_date ? new Date(m.candidate_date).toISOString().slice(0, 10) : '', 'Date Source': m?.date_source ?? '',
      'Current → Cost': m?.current_cost != null ? Number(m.current_cost) : '', 'Cost Basis': m?.cost_basis ?? '',
      'Current PO #': m?.po_number ?? '', 'Supplier': m?.supplier ?? '', 'Current Status': m?.current_status ?? '', 'Current Store': m?.current_store ?? '', 'Current Sale': saleBy.get(bc)?.outcome ?? '', 'Last Current Order': seenText(seenBy.get(bc)),
      'Grade': m ? LABEL[m.grade] : '', 'Reason': m?.reasons ?? '', 'Decision': '', 'Notes': '', 'Changed Since Baseline': changed,
    })
    if (!bc) { row.font = { bold: true }; continue }
    row.getCell(col('Decision')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Approve,Reject,Hold"'] }
    if (!m) { tally.nodata++; continue }
    tally[m.grade]++
    if (m.grade !== 'none') row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL[m.grade as keyof typeof FILL]) })
    const strong = (g: string, cols: string[]) => { if (g === 'yellow' || g === 'orange') cols.forEach((h) => (row.getCell(col(h)).fill = fill(STRONG[g]))) }
    strong(m.date_grade, ['Purchase Date', 'Current → Date'])
    strong(m.cost_grade, ['Purchase Price', 'Current → Cost'])
    strong(m.status_grade, ['Status', 'Current Status'])
    strong(m.identity_grade, ['Barcode', 'Current Barcode'])
  }
  units.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: units.columnCount } }

  // --- POs
  const pos = wb.addWorksheet('POs', { views: [{ state: 'frozen', ySplit: 1 }] })
  const poCols = ['Row Key', 'PO #', 'Ordered', 'Supplier', 'Subject', 'Line', 'Qty', 'Unit Price', 'Line Total', 'Group', 'Part', 'Build Key', 'Linked Barcodes', 'Grade', 'Reason', 'Decision', 'Notes']
  pos.columns = poCols.map((h) => ({ header: h, key: h, width: ['Subject', 'Line', 'Reason', 'Linked Barcodes'].includes(h) ? 45 : 13 }))
  pos.getRow(1).font = { bold: true }
  for (const p of poRows) {
    const row = pos.addRow({
      'Row Key': p.row_key, 'PO #': p.po_number, 'Ordered': p.ordered_at ? new Date(p.ordered_at).toISOString().slice(0, 10) : '', 'Supplier': p.supplier ?? '',
      'Subject': p.subject ?? '', 'Line': p.line_name ?? '', 'Qty': p.quantity != null ? Number(p.quantity) : '', 'Unit Price': p.unit_price != null ? Number(p.unit_price) : '',
      'Line Total': p.line_total != null ? Number(p.line_total) : '', 'Group': p.line_group ?? '', 'Part': p.core_kind ?? '', 'Build Key': p.build_key ?? '',
      'Linked Barcodes': p.linked_barcodes, 'Grade': LABEL[p.grade], 'Reason': p.reasons, 'Decision': '', 'Notes': '',
    })
    row.getCell(poCols.indexOf('Decision') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Approve,Reject,Hold"'] }
    if (p.grade !== 'none') row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL[p.grade as keyof typeof FILL]) })
  }
  pos.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: poCols.length } }

  // --- Current only
  const only = wb.addWorksheet('Current only', { views: [{ state: 'frozen', ySplit: 1 }] })
  only.columns = ['Current ID', 'Asset Number', 'Serial', 'Product', 'Store', 'Opening Date', 'Current Status', 'Note', 'Decision', 'Notes'].map((h) => ({ header: h, key: h, width: h === 'Product' || h === 'Note' ? 40 : 14 }))
  only.getRow(1).font = { bold: true }
  for (const o of onlyRows) {
    const row = only.addRow({ 'Current ID': Number(o.stock_id), 'Asset Number': o.asset_number, 'Serial': o.serial_number, 'Product': o.product, 'Store': o.store, 'Opening Date': o.opening_date ? new Date(o.opening_date).toISOString().slice(0, 10) : '', 'Current Status': o.current_status, 'Note': o.note, 'Decision': '', 'Notes': '' })
    row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL.blue) })
  }

  // --- Current Sales: sale evidence per AMC unit
  const cs = wb.addWorksheet('Current Sales', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  const csCols = ['Barcode', 'Asset Name', 'AMC Status', 'AMC Disposition', 'AMC Disposed On', 'AMC Disposed To', 'AMC Sale Price', 'Evidence', 'Current Sale Date', 'Buyer', 'Order #', 'Order Subject', 'Sale Line', 'Current Price', 'Sale Match %', 'Price Match %', 'Outcome', 'Applied In Proposed', 'Grade', 'Reason', 'Decision', 'Notes']
  cs.columns = csCols.map((h) => ({ header: h, key: h, width: ['Asset Name', 'Order Subject', 'Sale Line', 'Outcome', 'Reason'].includes(h) ? 40 : 14 }))
  cs.getRow(1).font = { bold: true }
  const saleTally: Record<string, number> = {}
  for (const x of saleRows) {
    const idp = match.get(x.barcode)?.identity_pct ?? 100
    const applied = [x.apply_mark_sold && 'status → SOLD', x.apply_date && 'date', x.apply_buyer && 'buyer', x.apply_price && 'price'].filter(Boolean).join(', ')
    const key = String(x.outcome).replace(/\(.*\)/, '').trim()
    saleTally[key] = (saleTally[key] ?? 0) + 1
    const row = cs.addRow({ 'Barcode': x.barcode, 'Asset Name': x.asset_name, 'AMC Status': x.amc_status, 'AMC Disposition': x.amc_disposition ?? '', 'AMC Disposed On': x.amc_disposed_on ? iso(x.amc_disposed_on) : '',
      'AMC Disposed To': x.amc_disposed_to ?? '', 'AMC Sale Price': x.amc_sale_price != null ? Number(x.amc_sale_price) : '', 'Evidence': x.kind, 'Current Sale Date': x.sale_date ? iso(x.sale_date) : '',
      'Buyer': x.buyer ?? '', 'Order #': x.order_number ?? '', 'Order Subject': x.order_subject ?? '', 'Sale Line': x.line_name ?? '', 'Current Price': x.price != null ? Number(x.price) : '',
      'Sale Match %': combined(idp, x.sale_pct), 'Price Match %': x.price_pct != null ? combined(idp, x.price_pct) : '', 'Outcome': x.outcome, 'Applied In Proposed': applied || 'no',
      'Grade': LABEL[x.grade], 'Reason': x.reasons, 'Decision': '', 'Notes': '' })
    row.getCell(csCols.indexOf('Decision') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Approve,Reject,Hold"'] }
    if (x.grade !== 'none') row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL[x.grade as keyof typeof FILL]) })
  }
  cs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: csCols.length } }

  // --- Unassetted Sales: sale quantity no evidence explains
  const us = wb.addWorksheet('Unassetted Sales', { views: [{ state: 'frozen', ySplit: 1 }] })
  const usCols = ['Row Key', 'Order #', 'Order Date', 'Order Status', 'Client', 'Subject', 'Sale Line', 'Qty', 'Unexplained', 'Unit Price', 'Unexplained $', 'Candidate AMC Units', 'Note', 'Decision', 'Notes']
  us.columns = usCols.map((h) => ({ header: h, key: h, width: ['Subject', 'Sale Line', 'Candidate AMC Units', 'Note'].includes(h) ? 42 : 13 }))
  us.getRow(1).font = { bold: true }
  for (const h of holeRows) {
    const row = us.addRow({ 'Row Key': h.row_key, 'Order #': h.order_number, 'Order Date': h.order_date ? iso(h.order_date) : '', 'Order Status': h.order_status, 'Client': h.client ?? '', 'Subject': h.subject ?? '',
      'Sale Line': h.line_name, 'Qty': Number(h.quantity), 'Unexplained': h.unexplained, 'Unit Price': Number(h.unit_price), 'Unexplained $': Math.round(h.unexplained * Number(h.unit_price) * 100) / 100,
      'Candidate AMC Units': h.candidates, 'Note': h.note, 'Decision': '', 'Notes': '' })
    row.getCell(usCols.indexOf('Decision') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Approve,Reject,Hold"'] }
    if (!h.note) row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL.orange) })
  }
  us.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: usCols.length } }

  // --- Last Seen: where Current last had units AMC can't place
  const ls = wb.addWorksheet('Last Seen', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  const lsCols = ['Barcode', 'Asset Name', 'Why Listed', 'AMC Status', 'AMC Disposition', 'AMC Disposed To', 'Last Current Order', 'Client', 'Order Start', 'Order End', 'Order Status', 'Asset Status', 'Returned', 'Rental Orders', 'Decision', 'Notes']
  ls.columns = lsCols.map((h) => ({ header: h, key: h, width: ['Asset Name', 'Why Listed', 'Client', 'AMC Disposed To'].includes(h) ? 32 : 13 }))
  ls.getRow(1).font = { bold: true }
  let lsCount = 0
  for (const r of inv) {
    const bc = String(r['Barcode'] ?? '')
    const x = bc ? seenBy.get(bc) : undefined
    if (!x || saleBy.has(bc)) continue
    const disp = String(r['Disposition'] ?? '')
    const loose = String(r['Status']) === 'RETIRED' && (['Unspecified', 'Other'].includes(disp) || /not in warehouse/i.test(String(r['Disposed To'] ?? '')))
    const activeOut = !disp && !['SOLD', 'RETIRED'].includes(String(r['Status'])) && !x.returned && x.order_status === 'Completed'
    if (!loose && !activeOut) continue
    const why = loose ? (x.returned ? 'AMC retired (loose) — last Current rental was returned' : 'AMC retired (loose) — Current never saw it return') : 'AMC active — Current says a finished rental never returned it'
    const row = ls.addRow({ 'Barcode': bc, 'Asset Name': r['Asset Name'], 'Why Listed': why, 'AMC Status': r['Status'], 'AMC Disposition': disp, 'AMC Disposed To': r['Disposed To'] ?? '',
      'Last Current Order': x.order_number, 'Client': x.client ?? '', 'Order Start': x.starts ? iso(x.starts) : '', 'Order End': x.ends ? iso(x.ends) : '', 'Order Status': x.order_status,
      'Asset Status': x.asset_status, 'Returned': x.returned ? 'yes' : 'NO', 'Rental Orders': x.orders, 'Decision': '', 'Notes': '' })
    row.getCell(lsCols.indexOf('Decision') + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Approve,Reject,Hold"'] }
    if (!x.returned) row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL.orange) })
    lsCount++
  }
  ls.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lsCols.length } }

  // --- Proposed: "what it could look like" with every Current proposal applied and flagged
  const ro = amcReadonlyPool()
  const { rows: rcv } = await ro.query(`SELECT barcode, to_char("receivedDate", 'YYYY-MM-DD') AS rd FROM asset_units`)
  await ro.end()
  const received = new Map(rcv.map((r) => [r.barcode as string, (r.rd as string | null) ?? null]))
  const saleFor = (bc: string, min: number): SaleProposal | undefined => saleForRow(saleBy.get(bc), match.get(bc)?.identity_pct ?? 100, min)
  const buildProposed = (min: number, withSales = true) => {
    const res = inv.map((r) => { const bc = String(r['Barcode'] ?? ''); return bc ? proposeRow(r, proposalFor(match.get(bc), min), received.get(bc) ?? null, withSales ? saleFor(bc, min) : undefined) : { row: r, changed: [] as string[], changes: [] as string[], pct: null } })
    const byBc = new Map(res.filter((x) => x.row['Barcode']).map((x) => [String(x.row['Barcode']), x]))
    return { res, byBc, rows: resection(res.map((x) => x.row)) }
  }
  const P = buildProposed(0)
  const BAND_FILL = { high: FILL.green, medium: FILL.yellow, low: FILL.orange } as const
  const prop = wb.addWorksheet('Proposed', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] })
  const propExtra = ['Match %', 'Confidence', 'Changes Applied', 'Source', 'Review Grade']
  prop.columns = [...FULL_INVENTORY_COLUMNS, ...propExtra].map((h) => ({ header: h, key: h, width: h === 'Changes Applied' ? 70 : Math.min(40, Math.max(12, h.length + 2)) }))
  prop.getRow(1).font = { bold: true }
  const pcol = (h: string) => FULL_INVENTORY_COLUMNS.indexOf(h) + 1 || FULL_INVENTORY_COLUMNS.length + propExtra.indexOf(h) + 1
  const propTally = { high: 0, medium: 0, low: 0, confirmed: 0 }
  P.rows.forEach((r) => {
    const bc = String(r['Barcode'] ?? '')
    const m = bc ? match.get(bc) : undefined
    const { changed, changes, pct } = (bc && P.byBc.get(bc)) || { changed: [] as string[], changes: [] as string[], pct: null }
    const b = pct != null ? band(pct) : null
    const agrees = !!m && m.date_grade === 'green' && ['green', 'none'].includes(m.cost_grade)
    const confidence = b ? `${b} — applied` : agrees ? 'Agrees with Current' : m ? 'No change proposed' : ''
    const sale = bc ? saleBy.get(bc) : undefined
    const source = [m && changes.some((c) => c.startsWith('Purchase')) ? [m.date_source, m.supplier].filter(Boolean).join(' · ') : '', sale && changes.some((c) => !c.startsWith('Purchase')) ? `${sale.kind}: ${sale.order_number ?? ''} ${sale.buyer ?? ''}`.trim() : ''].filter(Boolean).join(' | ')
    const row = prop.addRow({ ...r, 'Match %': pct ?? '', 'Confidence': confidence, 'Changes Applied': changes.join('; '), 'Source': source, 'Review Grade': m ? LABEL[m.grade] : '' })
    if (!bc) { row.font = { bold: true }; return }
    if (b) {
      propTally[b]++
      row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(BAND_FILL[b]) })
      for (const h of changed) row.getCell(pcol(h)).fill = fill(b === 'low' ? STRONG.orange : STRONG.yellow)
    } else if (agrees) { propTally.confirmed++; row.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(FILL.green) }) }
  })
  prop.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: prop.columnCount } }

  // --- Year snapshots of what was held, built from the proposed rows
  const today = new Date().toISOString().slice(0, 10)
  const SNAPS = [['Stock 2023', '2023-12-31'], ['Stock 2024', '2024-12-31'], ['Stock 2025', '2025-12-31'], ['Stock 2026 YTD', today]]
  const unitRows = P.rows.filter((r) => r['Barcode'])
  const pctBy = new Map(P.res.filter((x) => x.row['Barcode']).map((x) => [String(x.row['Barcode']), x.pct]))
  const snapCols = ['Asset Name', 'Category', 'Barcode', 'Serial Number', 'Purchase Date', 'Total Cost', 'Book Value', 'Accumulated Depreciation', 'Status Today', 'Disposition', 'Disposed On', 'Held Basis', 'Match %']
  const snapSummary: [string, string | number][] = []
  for (const [name, asOf] of SNAPS) {
    const rows = snapshot(unitRows, asOf, received)
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] })
    ws.columns = snapCols.map((h) => ({ header: h === 'Book Value' ? `Book Value @ ${asOf}` : h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }))
    ws.getRow(1).font = { bold: true }
    for (const x of rows) {
      const r = x.row
      const row = ws.addRow({ 'Asset Name': r['Asset Name'], 'Category': r['Category'], 'Barcode': r['Barcode'], 'Serial Number': r['Serial Number'], 'Purchase Date': r['Purchase Date'],
        'Total Cost': r['Total Cost'], 'Book Value': x.bookValue, 'Accumulated Depreciation': x.accumulated, 'Status Today': r['Status'], 'Disposition': r['Disposition'],
        'Disposed On': r['Disposed On'], 'Held Basis': x.basis, 'Match %': pctBy.get(String(r['Barcode'])) ?? '' })
      if (x.basis !== 'dated') row.getCell(snapCols.indexOf('Held Basis') + 1).fill = fill(FILL.orange)
    }
    const tot = (xs: typeof rows, k: 'cost' | 'book') => Math.round(xs.reduce((a, x) => a + (k === 'cost' ? Number(x.row['Total Cost']) || 0 : x.bookValue), 0) * 100) / 100
    const dated = rows.filter((x) => x.basis === 'dated')
    ws.addRow({})
    for (const [label, xs] of [[`--- HELD ${asOf}: ${rows.length} units ---`, rows], [`    dated: ${dated.length} units`, dated], [`    uncertain (acquired/disposal date unknown): ${rows.length - dated.length} units`, rows.filter((x) => x.basis !== 'dated')]] as const) {
      ws.addRow({ 'Asset Name': label, 'Total Cost': tot(xs, 'cost'), 'Book Value': tot(xs, 'book') }).font = { bold: true }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: snapCols.length } }
    snapSummary.push([`${name} (as of ${asOf})`, `${rows.length} units (${dated.length} dated, ${rows.length - dated.length} uncertain) — cost $${tot(rows, 'cost').toLocaleString('en-US')} — book $${tot(rows, 'book').toLocaleString('en-US')}`])
  }

  // Year movement (AMC disposals + proposed purchase dates): the track from one snapshot to the next.
  const movement: [string, string][] = []
  const heldCount = (asOf: string) => snapshot(unitRows, asOf, received).length
  for (const [label, from, to] of [['2023', '2022-12-31', '2023-12-31'], ['2024', '2023-12-31', '2024-12-31'], ['2025', '2024-12-31', '2025-12-31'], ['2026 YTD', '2025-12-31', today]] as const) {
    const inYear = (d: unknown) => { const v = String(d ?? ''); return v > from && v <= to }
    const acquired = unitRows.filter((r) => inYear(r['Purchase Date']) && !['2026-02-07', '2026-02-20'].includes(String(r['Purchase Date']))).length
    const gone = unitRows.filter((r) => r['Disposition'] && inYear(r['Disposed On']))
    const sold = gone.filter((r) => r['Disposition'] === 'Sold').length
    const byType = Object.entries(gone.filter((r) => r['Disposition'] !== 'Sold').reduce<Record<string, number>>((m, r) => ((m[String(r['Disposition'])] = (m[String(r['Disposition'])] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ')
    movement.push([`${label}`, `held at start ${heldCount(from)} + acquired ${acquired} − sold ${sold} − other ${gone.length - sold}${byType ? ` (${byType})` : ''} → held at end ${heldCount(to)}`])
  }

  const activeCount = (rows: typeof inv) => rows.filter((r) => r['Barcode'] && !r['Disposition'] && !['SOLD', 'RETIRED'].includes(String(r['Status']))).length
  // What-if: apply only proposals at or above a match %.
  const tv = (rows: typeof inv, prefix: string, k: string) => Number(rows.find((r) => String(r['Asset Name']).startsWith(prefix))?.[k] ?? 0)
  const whatIf: [string, string][] = [0, 50, 60, 70, 80, 90].map((t) => {
    const w = buildProposed(t)
    const n = w.res.filter((x) => x.changes.length).length
    return [`apply ≥ ${t}%`, `${n} units changed — active cost $${tv(w.rows, '--- TOTALS', 'Total Cost').toLocaleString('en-US')} / book $${tv(w.rows, '--- TOTALS', 'Current Book Value').toLocaleString('en-US')} — sold/retired cost $${tv(w.rows, '--- SOLD / RETIRED TOTALS', 'Total Cost').toLocaleString('en-US')}`]
  })

  const ebayLines = await addEbaySheets(wb, db, staging, '/home/docker/projects/vfxnow-amc/import_tmp/Transaction_report_20240101_20261015.csv')

  // --- Summary
  sum.columns = [{ width: 38 }, { width: 70 }]
  const totals = inv.filter((r) => String(r['Asset Name']).startsWith('--- '))
  const baseTotals = [...bws.getRows(2, bws.rowCount - 1) ?? []].filter((r) => val(r.getCell(1).value).startsWith('--- '))
  const lines: [string, string | number][] = [
    ['Generated', new Date().toISOString()],
    ['Current pull', `run ${run.id} — ${run.source} — finished ${new Date(run.finished_at).toISOString()}`],
    ['Rule', 'Report only. Built against the v2 database (vfxnow_amc_v2), read-only.'],
    ['', ''],
    ['Green — Confirmed', 'Current agrees with AMC'], ['Yellow — Changed', 'Current fills a blank or differs (stronger fill marks the differing cells)'],
    ['Orange — Questionable', 'weak link, partial build, bulk-entry date, competing PO, or status conflict — see Reason'],
    ['Blue — Current only', 'in Current, not in AMC — listed, never created'],
    ['', ''],
    ['Units: Confirmed', tally.green], ['Units: Changed', tally.yellow], ['Units: Questionable', tally.orange], ['Units: matched, nothing to compare', tally.none],
    ['Units: no Current data (incl. GPL/META)', tally.nodata], ['PO rows', poRows.length], ['Current-only items', onlyRows.length],
    ['', ''],
    ...totals.map((t) => [`${t['Asset Name']} — Purchase Price (now)`, Number(t['Purchase Price'])] as [string, number]),
    ...baseTotals.map((t) => [`${val(t.getCell(1).value)} — Purchase Price (baseline 2026-09-18)`, Number(val(t.getCell(FULL_INVENTORY_COLUMNS.indexOf('Purchase Price') + 1).value))] as [string, number]),
    ['', ''],
    ['PROPOSED SHEET', 'every Current proposal applied; Match % = weakest applied field; changed cells strongly filled'],
    ['Proposed: high ≥85% (green)', propTally.high], ['Proposed: medium 65–84% (yellow)', propTally.medium], ['Proposed: low <65% (orange)', propTally.low], ['Unchanged, agrees with Current (green)', propTally.confirmed],
    ['Active total cost: now → proposed', `$${tv(inv, '--- TOTALS', 'Total Cost').toLocaleString('en-US')} → $${tv(P.rows, '--- TOTALS', 'Total Cost').toLocaleString('en-US')}`],
    ['Active book value: now → proposed', `$${tv(inv, '--- TOTALS', 'Current Book Value').toLocaleString('en-US')} → $${tv(P.rows, '--- TOTALS', 'Current Book Value').toLocaleString('en-US')}`],
    ['Sold/retired cost: now → proposed', `$${tv(inv, '--- SOLD / RETIRED TOTALS', 'Total Cost').toLocaleString('en-US')} → $${tv(P.rows, '--- SOLD / RETIRED TOTALS', 'Total Cost').toLocaleString('en-US')}`],
    ['', ''],
    ['CURRENT SALES', 'evidence: sale line asset > Sell movement > rental buyout > barcode in text; applied to Proposed unless AMC has a specific disposition or a recorded sale'],
    ...Object.entries(saleTally).map(([k, v]) => [`Sales: ${k}`, v] as [string, number]),
    ['Unassetted sale lines (holes)', `${holeRows.length} lines, ${holeRows.reduce((a, h) => a + h.unexplained, 0)} units, $${Math.round(holeRows.reduce((a, h) => a + h.unexplained * Number(h.unit_price), 0)).toLocaleString('en-US')}`],
    ['Active units: now → proposed (with sales)', `${activeCount(inv)} → ${activeCount(P.rows)}`],
    ['Last Seen sheet', `${lsCount} units AMC can't place, with their last Current rental (orange = never returned per Current); ${seenRows.length} units have Current rental history so far`],
    ['Sold/retired sale price: now → proposed', `$${tv(inv, '--- SOLD / RETIRED TOTALS', 'Sale Price').toLocaleString('en-US')} → $${tv(P.rows, '--- SOLD / RETIRED TOTALS', 'Sale Price').toLocaleString('en-US')}`],
    ['', ''],
    ['WHAT-IF (apply only ≥ match %)', ''],
    ...whatIf,
    ['', ''],
    ['YEAR SNAPSHOTS (from Proposed)', 'held = acquired on/before the date and not disposed by it; unknown dates are kept and flagged'],
    ...snapSummary,
    ['', ''],
    ['YEAR MOVEMENT', 'acquired = dated purchase in the year (import stamps excluded); sold/other = AMC disposal dated in the year. Start + acquired − out ≠ end when dates are unknown.'],
    ...movement,
    ['', ''],
    ...ebayLines,
  ]
  for (const [a, b] of lines) sum.addRow([a, b])
  sum.getColumn(1).font = { bold: true }

  mkdirSync('reports/current-rms-v2', { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')
  const out = `reports/current-rms-v2/review-${stamp}.xlsx`
  await wb.xlsx.writeFile(out)
  console.log(`${out}\n  units ${inv.filter((r) => r['Barcode']).length} (green ${tally.green}, yellow ${tally.yellow}, orange ${tally.orange}, matched-no-compare ${tally.none}, no data ${tally.nodata})\n  PO rows ${poRows.length}, Current-only ${onlyRows.length}`)
  for (const t of totals) console.log(`  ${t['Asset Name']}: ${t['Purchase Price']}`)
  console.log(`  proposed: high ${propTally.high}, medium ${propTally.medium}, low ${propTally.low}, confirmed ${propTally.confirmed}`)
  console.log('  sales', saleTally, `holes ${holeRows.length}`)
  for (const [k, v] of [...whatIf, ...snapSummary, ...movement]) console.log(`  ${k}: ${v}`)
  await db.$disconnect(); await staging.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
