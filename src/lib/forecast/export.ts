import ExcelJS from 'exceljs'
import { STATUS_LABEL } from '@/lib/reservations/status'
import {
  BOOKED_STREAMS,
  KINDS,
  KIND_LABEL,
  STREAM_LABEL,
  type Forecast,
  type ForecastOrder,
  type Stream,
} from '@/lib/queries/forecast'
import { PERIOD_LABEL, periodMonths, type ExportPeriod } from './period'
import type { MonthKey } from './schedule'

/**
 * The forecast as a workbook an accountant can check: the same figures the
 * Forecast page shows (it is built from the same getForecast), cut to a period,
 * with every order behind the totals and a reconciliation that adds the orders
 * back up and says where they differ from the page.
 *
 * Ex-tax throughout. Money cells are numbers, and the totals are formulas, so
 * the sheet can be filtered, re-summed and traced in Excel.
 */

const MONEY = '#,##0.00;[Red]-#,##0.00;"–"'
const PCT = '0%'
const DATE = 'mmm d, yyyy'
const INK = 'FF1F2933'
const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2933' } }
const BAND_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F4' } }
const SOFT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }

const TYPE_LABEL: Record<string, string> = {
  RENTAL: 'Rental',
  SALE: 'Sale',
  RENT_TO_OWN: 'Rent-to-own',
  CLOUD: 'Cloud',
  FLOW: 'Flow',
}
const CHOICE_LABEL = { COUNT: 'Owner: count', SKIP: 'Owner: leave out', SEPARATE: 'Owner: separate deal' } as const

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthLabel = (key: MonthKey) => MONTH.format(new Date(`${key}-01T12:00:00Z`))
const statusLabel = (s: string) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s

function header(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = HEAD_FILL
  row.alignment = { vertical: 'middle', wrapText: true }
  row.height = 30
}

function band(row: ExcelJS.Row, fill = BAND_FILL) {
  row.font = { bold: true }
  row.eachCell({ includeEmpty: true }, (c) => (c.fill = fill))
}

/** A cell holding a formula and the value it evaluates to, so viewers that don't recalculate still show it. */
const formula = (f: string, result: number) => ({ formula: f, result: Number.isFinite(result) ? result + 0 : 0 })

/** A cell's number, whether it holds a value or a formula with a cached result. */
const numeric = (v: unknown): number =>
  typeof v === 'number' ? v : v && typeof v === 'object' && 'result' in v ? Number((v as { result: unknown }).result) || 0 : 0

export async function buildForecastWorkbook(f: Forecast, period: ExportPeriod, today: Date): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VFXNow AMC'
  wb.created = f.generatedAt
  // Excel recalculates every total on open, so a zero never shows as a missing cached value.
  wb.calcProperties = { fullCalcOnLoad: true }

  const keys = periodMonths(period, today)
  const forecastKeys = new Set(f.months.map((m) => m.key))
  const earnedBy = new Map(f.history.map((h) => [h.key, h.earned]))
  const inForecast = (k: MonthKey) => forecastKeys.has(k)
  const live = keys.filter(inForecast)
  const label = PERIOD_LABEL[period]
  const span = `${monthLabel(keys[0])}${keys.length > 1 ? ` – ${monthLabel(keys[keys.length - 1])}` : ''}`

  const orders = collectOrders(f)
  const sumIn = (o: ForecastOrder, ks: MonthKey[]) => ks.reduce((s, k) => s + (o.byMonth[k] ?? 0), 0)
  const at = (s: Stream, k: MonthKey) => f.revenue[s][k] ?? 0
  const cashBooked = (k: MonthKey) => BOOKED_STREAMS.reduce((s, st) => s + (f.cash[st][k] ?? 0), 0)
  const cashExpected = (k: MonthKey) => (f.cash.playRecurring[k] ?? 0) + (f.cash.playOnce[k] ?? 0) + (f.cash.leads[k] ?? 0)

  /* ── Summary ─────────────────────────────────────────────────────────── */
  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', xSplit: 1, ySplit: 6, showGridLines: false }] })
  sum.getColumn(1).width = 42
  keys.forEach((_, i) => (sum.getColumn(i + 2).width = 15))
  const totalCol = keys.length + 2
  sum.getColumn(totalCol).width = 17
  const colLetter = (n: number) => sum.getColumn(n).letter

  sum.getCell('A1').value = `Forecast — ${label}`
  sum.getCell('A1').font = { bold: true, size: 16, color: { argb: INK } }
  sum.getCell('A2').value = `${span} · ex-tax · generated ${f.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  sum.getCell('A3').value =
    keys.some((k) => !inForecast(k))
      ? 'Months already gone show what was earned (where recorded) — the forecast covers this month onward. Their forecast cells are blank, not zero.'
      : 'Every month here is forecast.'
  sum.getCell('A3').font = { italic: true, color: { argb: 'FF5B6770' } }

  const headRow = sum.getRow(6)
  headRow.values = ['', ...keys.map(monthLabel), label]
  header(headRow)
  headRow.eachCell((c, n) => n > 1 && (c.alignment = { horizontal: 'right', vertical: 'middle' }))

  let r = 7
  const rowOf: Record<string, number> = {}
  const put = (id: string, name: string, value: (k: MonthKey) => number | null, opts: { strong?: boolean; soft?: boolean; section?: boolean } = {}) => {
    const row = sum.getRow(r)
    row.getCell(1).value = name
    if (opts.section) {
      row.getCell(1).font = { bold: true, color: { argb: 'FF5B6770' } }
      r++
      return
    }
    let total = 0
    keys.forEach((k, i) => {
      const v = value(k)
      const cell = row.getCell(i + 2)
      if (v == null) {
        cell.value = null
      } else {
        cell.value = v
        total += v
      }
      cell.numFmt = MONEY
    })
    const tc = row.getCell(totalCol)
    tc.value = formula(`SUM(${colLetter(2)}${r}:${colLetter(keys.length + 1)}${r})`, total)
    tc.numFmt = MONEY
    tc.font = { bold: true }
    if (opts.strong) band(row)
    else if (opts.soft) row.font = { color: { argb: 'FF5B6770' } }
    rowOf[id] = r
    r++
  }
  const forecastOnly = (fn: (k: MonthKey) => number) => (k: MonthKey) => (inForecast(k) ? fn(k) : null)
  const sumRows = (ids: string[], strong = true) => {
    const row = sum.getRow(r)
    keys.forEach((k, i) => {
      const cell = row.getCell(i + 2)
      const letter = colLetter(i + 2)
      cell.value = inForecast(k)
        ? formula(ids.map((id) => `${letter}${rowOf[id]}`).join('+'), ids.reduce((s, id) => s + numeric(sum.getRow(rowOf[id]).getCell(i + 2).value), 0))
        : null
      cell.numFmt = MONEY
    })
    return { row, strong }
  }

  put('', 'REVENUE — BOOKED (contracted)', () => 0, { section: true })
  const streams = BOOKED_STREAMS.filter((s) => live.some((k) => Math.abs(at(s, k)) >= 0.005))
  streams.forEach((s) => put(`b:${s}`, STREAM_LABEL[s], forecastOnly((k) => at(s, k))))
  {
    const { row } = sumRows(streams.map((s) => `b:${s}`))
    row.getCell(1).value = 'Booked revenue'
    const t = row.getCell(totalCol)
    t.value = formula(`SUM(${colLetter(2)}${r}:${colLetter(keys.length + 1)}${r})`, live.reduce((s, k) => s + BOOKED_STREAMS.reduce((a, st) => a + at(st, k), 0), 0))
    t.numFmt = MONEY
    band(row)
    rowOf.booked = r++
  }

  r++
  put('', 'REVENUE — EXPECTED (weighted, not contracted)', () => 0, { section: true })
  const kinds = KINDS.filter((kd) => live.some((k) => Math.abs(f.expectedByKind[kd][k] ?? 0) >= 0.005))
  kinds.forEach((kd) => put(`e:${kd}`, `${KIND_LABEL[kd]} — open quotes × stage weight`, forecastOnly((k) => f.expectedByKind[kd][k] ?? 0), { soft: true }))
  put('e:leads', 'Prospects — leads × stage weight', forecastOnly((k) => at('leads', k)), { soft: true })
  {
    const { row } = sumRows([...kinds.map((kd) => `e:${kd}`), 'e:leads'])
    row.getCell(1).value = 'Expected revenue'
    const t = row.getCell(totalCol)
    t.value = formula(`SUM(${colLetter(2)}${r}:${colLetter(keys.length + 1)}${r})`, live.reduce((s, k) => s + at('playRecurring', k) + at('playOnce', k) + at('leads', k), 0))
    t.numFmt = MONEY
    band(row)
    rowOf.expected = r++
  }
  {
    const { row } = sumRows(['booked', 'expected'])
    row.getCell(1).value = 'Booked + expected'
    const t = row.getCell(totalCol)
    t.value = formula(`SUM(${colLetter(2)}${r}:${colLetter(keys.length + 1)}${r})`, 0)
    t.numFmt = MONEY
    band(row, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE3E8' } })
    rowOf.both = r++
  }
  if (live.some((k) => (f.targets[k] ?? 0) > 0)) put('target', 'Revenue target (Reports → Forecast)', forecastOnly((k) => f.targets[k] ?? 0), { soft: true })
  if (keys.some((k) => earnedBy.has(k) && !inForecast(k))) {
    put('earned', 'Earned (actual, months already gone)', (k) => (earnedBy.has(k) && !inForecast(k) ? earnedBy.get(k)! : null), { soft: true })
  }

  r++
  put('', 'CASH — when it lands, by payment terms', () => 0, { section: true })
  put('c:in', 'Cash in — booked', forecastOnly(cashBooked))
  put('c:lease', 'Lease payments', forecastOnly((k) => -f.cashOut.leases[k]))
  put('c:po', 'Purchase orders (submitted)', forecastOnly((k) => -f.cashOut.purchaseOrders[k]))
  put('c:exp', 'Expenses & payroll', forecastOnly((k) => -f.cashOut.expenses[k]))
  {
    const { row } = sumRows(['c:in', 'c:lease', 'c:po', 'c:exp'])
    row.getCell(1).value = 'Net cash — booked'
    const t = row.getCell(totalCol)
    t.value = formula(`SUM(${colLetter(2)}${r}:${colLetter(keys.length + 1)}${r})`, live.reduce((s, k) => s + cashBooked(k) - f.cashOut.leases[k] - f.cashOut.purchaseOrders[k] - f.cashOut.expenses[k], 0))
    t.numFmt = MONEY
    band(row)
    rowOf.net = r++
  }
  put('c:exp-on-top', 'Expected cash on top (weighted)', forecastOnly(cashExpected), { soft: true })

  // Fill the "Booked + expected" cached total now every referenced total exists.
  {
    const row = sum.getRow(rowOf.both)
    const bookedTotal = numeric(sum.getRow(rowOf.booked).getCell(totalCol).value)
    const expectedTotal = numeric(sum.getRow(rowOf.expected).getCell(totalCol).value)
    row.getCell(totalCol).value = formula(`SUM(${colLetter(2)}${rowOf.both}:${colLetter(keys.length + 1)}${rowOf.both})`, bookedTotal + expectedTotal)
  }
  if (f.carriedIn > 0) {
    r++
    sum.getCell(`A${r}`).value = `Cash in includes ${f.carriedIn.toFixed(2)} billed before ${monthLabel(f.months[0].key)} and still due after.`
    sum.getCell(`A${r}`).font = { italic: true, color: { argb: 'FF5B6770' } }
  }

  /* ── Orders ──────────────────────────────────────────────────────────── */
  const shown = orders.filter((o) => (o.counted ? sumIn(o, live) !== 0 : true))
  const ord = wb.addWorksheet('Orders', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] })
  const fixed = [
    ['Order', 12], ['Client', 28], ['Name', 26], ['Type', 12], ['Status', 14], ['Tier', 11], ['Stream', 24],
    ['Counted in totals', 10], ['Why', 40], ['Weight', 8], ['Monthly (ex-tax)', 14], ['Term', 26], ['Ends', 13],
    ['Units out', 8], ['Units past return', 9], ['Pay terms (days)', 9], ['Last touched', 13],
  ] as const
  ord.columns = [...fixed.map(([header, width]) => ({ header, width })), ...live.map((k) => ({ header: monthLabel(k), width: 14 })), { header: `${label} — unweighted`, width: 17 }, { header: `${label} — weighted`, width: 17 }]
  header(ord.getRow(1))
  const firstMonth = fixed.length + 1
  const lastMonth = fixed.length + live.length
  const L = (n: number) => ord.getColumn(n).letter
  shown
    .sort((a, b) => Number(b.counted) - Number(a.counted) || tierOf(a).localeCompare(tierOf(b)) || sumIn(b, live) * b.weight - sumIn(a, live) * a.weight)
    .forEach((o) => {
      const unweighted = sumIn(o, live)
      const row = ord.addRow([
        o.number, o.client, o.name ?? '', TYPE_LABEL[o.type] ?? o.type, statusLabel(o.status), tierOf(o), STREAM_LABEL[o.stream],
        o.counted ? 'Yes' : 'No', whyOf(o), o.weight, o.monthly ?? null, o.term, o.endsOn ?? null, o.unitsOut, o.overdue?.units ?? 0,
        o.termsDays, o.touched, ...live.map((k) => o.byMonth[k] ?? 0),
        formula(`SUM(${L(firstMonth)}${ord.rowCount + 1}:${L(lastMonth)}${ord.rowCount + 1})`, unweighted),
        formula(`${L(lastMonth + 1)}${ord.rowCount + 1}*J${ord.rowCount + 1}`, unweighted * o.weight),
      ])
      row.getCell(10).numFmt = PCT
      row.getCell(11).numFmt = MONEY
      row.getCell(13).numFmt = DATE
      row.getCell(17).numFmt = DATE
      for (let c = firstMonth; c <= lastMonth + 2; c++) row.getCell(c).numFmt = MONEY
      row.getCell(lastMonth + 2).font = { bold: o.counted }
      if (!o.counted) row.font = { color: { argb: 'FF8A949C' }, italic: true }
    })
  ord.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastMonth + 2 } }
  {
    const n = ord.rowCount
    const tot = ord.addRow([])
    tot.getCell(1).value = 'Counted total'
    for (const c of [lastMonth + 1, lastMonth + 2]) {
      const total = shown.filter((o) => o.counted).reduce((s, o) => s + sumIn(o, live) * (c === lastMonth + 2 ? o.weight : 1), 0)
      tot.getCell(c).value = formula(`SUMIF(H2:H${n},"Yes",${L(c)}2:${L(c)}${n})`, total)
      tot.getCell(c).numFmt = MONEY
    }
    band(tot)
  }
  if (live.length === 0) ord.getCell('A2').value = 'The period is wholly in the past — there is no forecast to list.'

  /* ── By client ───────────────────────────────────────────────────────── */
  const cl = wb.addWorksheet('By client', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] })
  cl.getColumn(1).width = 34
  const clientCols = [...live.map((k) => monthLabel(k)), 'Total']
  cl.getCell('B1').value = 'Booked'
  cl.getCell(1, 2 + clientCols.length + 1).value = 'Expected (weighted)'
  cl.getCell('B1').font = cl.getCell(1, 2 + clientCols.length + 1).font = { bold: true }
  cl.getRow(2).values = ['Client', ...clientCols, '', ...clientCols, '', 'Booked + expected']
  header(cl.getRow(2))
  const bw = live.length + 1
  const eStart = 2 + bw + 1
  f.clients
    .map((c) => ({ c, b: live.reduce((s, k) => s + (c.booked[k] ?? 0), 0), e: live.reduce((s, k) => s + (c.expected[k] ?? 0), 0) }))
    .filter((x) => Math.abs(x.b) + Math.abs(x.e) >= 0.005)
    .sort((a, b) => b.b + b.e - (a.b + a.e))
    .forEach(({ c, b, e }) => {
      const rr = cl.rowCount + 1
      const vals: (string | number | null | { formula: string; result: number })[] = [c.client]
      live.forEach((k) => vals.push(c.booked[k] ?? 0))
      vals.push(formula(`SUM(B${rr}:${cl.getColumn(1 + live.length).letter}${rr})`, b), null)
      live.forEach((k) => vals.push(c.expected[k] ?? 0))
      vals.push(formula(`SUM(${cl.getColumn(eStart).letter}${rr}:${cl.getColumn(eStart + live.length - 1).letter}${rr})`, e), null)
      vals.push(formula(`${cl.getColumn(2 + live.length).letter}${rr}+${cl.getColumn(eStart + live.length).letter}${rr}`, b + e))
      const row = cl.addRow(vals)
      for (let n = 2; n <= vals.length; n++) row.getCell(n).numFmt = MONEY
    })
  if (cl.rowCount > 2) {
    const last = cl.rowCount
    const tot = cl.addRow(['Total'])
    for (let n = 2; n <= 2 + 2 * bw + 1; n++) {
      if (n === 2 + bw) continue
      const letter = cl.getColumn(n).letter
      let v = 0
      for (let i = 3; i <= last; i++) v += numeric(cl.getRow(i).getCell(n).value)
      tot.getCell(n).value = formula(`SUM(${letter}3:${letter}${last})`, v)
      tot.getCell(n).numFmt = MONEY
    }
    band(tot)
  }

  /* ── Leads ───────────────────────────────────────────────────────────── */
  const leads = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] })
  leads.columns = [{ header: 'Lead', width: 28 }, { header: 'Company', width: 28 }, { header: 'Stage', width: 12 }, { header: 'Estimated value', width: 16 }, { header: 'Weight', width: 9 }, { header: 'Weighted', width: 16 }]
  header(leads.getRow(1))
  f.leads.forEach((l) => {
    const rr = leads.rowCount + 1
    const row = leads.addRow([l.name, l.company ?? '', l.status, l.value, l.weight, formula(`D${rr}*E${rr}`, l.value * l.weight)])
    row.getCell(4).numFmt = MONEY
    row.getCell(5).numFmt = PCT
    row.getCell(6).numFmt = MONEY
  })
  if (f.leads.length) {
    const n = leads.rowCount
    const tot = leads.addRow(['Total'])
    tot.getCell(4).value = formula(`SUM(D2:D${n})`, f.leads.reduce((s, l) => s + l.value, 0))
    tot.getCell(6).value = formula(`SUM(F2:F${n})`, f.leads.reduce((s, l) => s + l.value * l.weight, 0))
    tot.getCell(4).numFmt = tot.getCell(6).numFmt = MONEY
    band(tot)
    leads.addRow([])
    leads.addRow(['Leads have no order, so the forecast spreads each one’s weighted value over three months.']).font = { italic: true, color: { argb: 'FF5B6770' } }
  }

  /* ── Check these ─────────────────────────────────────────────────────── */
  const chk = wb.addWorksheet('Check these', { views: [{ state: 'frozen', ySplit: 1 }] })
  chk.columns = [{ header: 'What to check', width: 46 }, { header: 'Order', width: 14 }, { header: 'Client', width: 28 }, { header: 'Amount', width: 16 }, { header: 'Detail', width: 60 }]
  header(chk.getRow(1))
  const a = f.attention
  const add = (what: string, list: ForecastOrder[], amount: (o: ForecastOrder) => number | null, detail: (o: ForecastOrder) => string) =>
    list.forEach((o) => {
      const row = chk.addRow([what, o.number, o.client, amount(o), detail(o)])
      row.getCell(4).numFmt = MONEY
    })
  add('Approved, never went out — not counted', a.staleBooked, (o) => o.monthly, () => 'Start date passed before it shipped; re-date or close it.')
  add('Active with everything back — not counted', a.nothingOut, (o) => o.monthly, () => 'Every unit is checked in; close it out.')
  add('Units past return date, still out — counted as rolling', a.rolling, (o) => o.monthly, (o) => `${o.overdue?.units ?? 0} units since ${o.overdue ? o.overdue.since.toISOString().slice(0, 10) : ''}; billed month to month.`)
  add('Priced lines never checked out — not billing', a.neverOut, (o) => o.neverOut, () => 'Monthly value of lines no unit was ever checked out against.')
  add('Live rental bills $0 a month', a.noBillableLines, () => 0, () => 'Comped, or a price was never set.')
  a.notBilled.forEach((o) => chk.addRow(['Marked not billed — left out on purpose', o.number, o.client, o.total, 'Evaluation or gift']).getCell(4).numFmt = MONEY)
  if (a.leasesWithoutTerms) chk.addRow(['Active leases with no payment on file', '', '', null, `${a.leasesWithoutTerms} leases — cash out is understated by their monthly cost.`])
  if (a.draftPurchaseOrders.count) chk.addRow(['Draft purchase orders — not counted as cash out', '', '', a.draftPurchaseOrders.total, `${a.draftPurchaseOrders.count} draft POs; only submitted POs count.`]).getCell(4).numFmt = MONEY
  if (chk.rowCount === 1) chk.addRow(['Nothing flagged.'])

  /* ── Reconciliation ──────────────────────────────────────────────────── */
  const rec = wb.addWorksheet('Reconciliation', { views: [{ state: 'frozen', ySplit: 1 }] })
  rec.columns = [{ header: 'Line', width: 44 }, { header: 'Month', width: 12 }, { header: 'Forecast page', width: 18 }, { header: 'Rebuilt from Orders sheet', width: 22 }, { header: 'Difference', width: 15 }, { header: 'Result', width: 10 }]
  header(rec.getRow(1))
  let bad = 0
  const check = (line: string, month: string, page: number, rebuilt: number) => {
    const rr = rec.rowCount + 1
    const diff = page - rebuilt
    const ok = Math.abs(diff) < 0.01
    if (!ok) bad++
    const row = rec.addRow([line, month, page, rebuilt, formula(`C${rr}-D${rr}`, diff), formula(`IF(ABS(E${rr})<0.01,"OK","CHECK")`, 0)])
    row.getCell(6).value = { formula: `IF(ABS(E${rr})<0.01,"OK","CHECK")`, result: ok ? 'OK' : 'CHECK' } as ExcelJS.CellFormulaValue
    for (const c of [3, 4, 5]) row.getCell(c).numFmt = MONEY
    if (!ok) row.getCell(6).font = { bold: true, color: { argb: 'FFB42318' } }
  }
  const counted = orders.filter((o) => o.counted)
  for (const k of live) {
    for (const s of [...BOOKED_STREAMS, 'playRecurring', 'playOnce'] as Stream[]) {
      const mine = counted.filter((o) => o.stream === s)
      const rebuilt = mine.reduce((t, o) => t + (o.byMonth[k] ?? 0) * o.weight, 0)
      const page = at(s, k)
      if (Math.abs(page) < 0.005 && Math.abs(rebuilt) < 0.005) continue
      check(STREAM_LABEL[s], monthLabel(k), page, rebuilt)
    }
    const clientsBooked = f.clients.reduce((t, c) => t + (c.booked[k] ?? 0), 0)
    check('By-client booked vs booked revenue', monthLabel(k), BOOKED_STREAMS.reduce((t, s) => t + at(s, k), 0), clientsBooked)
  }
  const leadsPage = f.months.reduce((t, m) => t + at('leads', m.key), 0)
  check('Leads — 12-month weighted total', '12 months', leadsPage, f.leads.reduce((t, l) => t + l.value * l.weight, 0))
  rec.addRow([])
  rec.addRow([bad === 0 ? 'Every line reconciles: the Orders sheet adds back up to the Forecast page.' : `${bad} lines differ — see CHECK above.`]).font = { bold: true }
  rec.addRow(['Cash is projected per stream from each order’s billing schedule and payment terms, so it is not rebuilt per order here.']).font = { italic: true, color: { argb: 'FF5B6770' } }

  /* ── About ───────────────────────────────────────────────────────────── */
  const about = wb.addWorksheet('About', { views: [{ showGridLines: false }] })
  about.getColumn(1).width = 120
  ;[
    ['How this forecast is built', true],
    ['Everything is ex-tax. Booked = approved and live orders (contracted). Expected = open quotes (one version per deal) and leads, multiplied by a stage weight; it is never mixed into booked.', false],
    ['Stage weights: quote sent 60%, draft or revision 40%; leads new 10%, contacted 25%, qualified 50% (same as Reports → Forecast).', false],
    ['Recurring rentals and cloud are priced on units out now, each until its checkout return date; a unit past its return date and still out rolls month to month.', false],
    ['Duplicate renditions of a deal (same client and name, or most of the same gear) count once — the furthest stage, then the newest. A quote that is a version of an order already booked is not counted. Quotes untouched for 90 days are listed but not counted.', false],
    ['Cash lands when each bill is due: payment terms in whole 30-day months from the billing day (order terms, else the client’s, else 30). Cash out is lease payments, submitted purchase orders, and expenses/payroll entered in Reports → Forecast.', false],
    ['The Orders sheet lists every order behind the totals, including ones left out and why. Filter “Counted in totals” = Yes to see exactly what is in the numbers.', false],
    ['The Reconciliation sheet adds the orders back up and compares them with the Forecast page line by line.', false],
  ].forEach(([text, bold], i) => {
    const c = about.getCell(i + 1, 1)
    c.value = text as string
    c.alignment = { wrapText: true, vertical: 'top' }
    c.font = bold ? { bold: true, size: 14 } : {}
  })
  void SOFT_FILL
  return wb
}

function tierOf(o: ForecastOrder): string {
  return ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'].includes(o.status) ? 'Booked' : 'In play'
}

function whyOf(o: ForecastOrder): string {
  const parts: string[] = []
  if (o.counted) parts.push(tierOf(o) === 'Booked' ? 'Contracted' : `Open quote × ${Math.round(o.weight * 100)}%`)
  else if (o.reason) parts.push(o.reason)
  else if (o.stale) parts.push('Untouched for 90 days')
  else parts.push('Another version of this deal counts')
  if (o.choice) parts.push(CHOICE_LABEL[o.choice])
  if (o.startShifted) parts.push('start moved to this month')
  if (o.quoteExpired) parts.push('quote expired')
  return parts.join(' · ')
}

/** Every order the forecast looked at, once each: booked, uncounted booked, and quotes. */
function collectOrders(f: Forecast): ForecastOrder[] {
  const seen = new Map<string, ForecastOrder>()
  const add = (o: ForecastOrder) => {
    if (!seen.has(o.id) || (o.counted && !seen.get(o.id)!.counted)) seen.set(o.id, o)
  }
  f.booked.forEach(add)
  f.attention.staleBooked.forEach(add)
  f.attention.nothingOut.forEach(add)
  f.attention.noBillableLines.forEach(add)
  f.deals.forEach((d) => d.orders.forEach(add))
  return [...seen.values()]
}
