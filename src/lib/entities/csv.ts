/**
 * The inventory import file: a pure parser (no database, no next). Quoted fields
 * may hold commas, doubled quotes and line breaks; a UTF-8 BOM, CRLF endings and
 * header case/spacing are tolerated. Line numbers in messages are physical lines
 * of the file, so a person can find the row in a spreadsheet or editor.
 */
import { itemIdentity } from '@/lib/entities/match'
import { quantityProblem } from '@/lib/entities/ledger'

export type ParsedRow = {
  name: string; manufacturer?: string; model?: string; category?: string
  trackingMode: 'SERIALIZED' | 'QUANTITY'; serial?: string; ownerTag?: string; quantity?: number; location: string
}
export type ParsedLine = ParsedRow & { line: number }

export const MAX_IMPORT_ROWS = 500
/** 500 rows never needs more; well under Next's 1 MB server-action body limit. */
export const MAX_CSV_BYTES = 256_000
const MAX_ERRORS = 50
const REQUIRED = ['name', 'tracking', 'location']
const LIMITS: Record<string, number> = { name: 200, manufacturer: 200, model: 200, category: 100, serial: 200, owner_tag: 200, location: 200 }

type RawRecord = { cells: string[]; line: number }

/** Splits the text into records of trimmed cells, honouring quotes. Null when a quote is never closed. */
function records(text: string): { records: RawRecord[] } | { unterminatedAt: number } {
  const out: RawRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  let quoteLine = 1
  const endRecord = () => {
    cells.push(cell.trim())
    if (cells.some((c) => c !== '')) out.push({ cells, line: recordLine })
    cells = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else if (c === '\r') { if (text[i + 1] === '\n') continue; line++; cell += '\n' }
      else { if (c === '\n') line++; cell += c }
    } else if (c === '"') { quoted = true; quoteLine = line }
    else if (c === ',') { cells.push(cell.trim()); cell = '' }
    else if (c === '\r' && text[i + 1] === '\n') continue
    else if (c === '\n' || c === '\r') { endRecord(); line++; recordLine = line }
    else cell += c
  }
  if (quoted) return { unterminatedAt: quoteLine }
  endRecord()
  return { records: out }
}

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')

export const itemKey = itemIdentity

/** Long lists of problems are cut so the message stays readable. */
export function capErrors(errors: string[]): string[] {
  return errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), `...and ${errors.length - MAX_ERRORS} more problems.`] : errors
}

export function parseItemCsv(input: string): { rows: ParsedRow[]; errors: string[] } {
  const parsed = records(input.replace(/^﻿/, ''))
  if ('unterminatedAt' in parsed) return { rows: [], errors: [`A quote opened on line ${parsed.unterminatedAt} is never closed.`] }
  const recs = parsed.records
  if (recs.length === 0) return { rows: [], errors: ['The file is empty.'] }
  const header = recs[0].cells.map(normaliseHeader)
  const missing = REQUIRED.filter((r) => !header.includes(r))
  if (missing.length) return { rows: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`] }
  const data = recs.slice(1)
  if (data.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [`The file has ${data.length} rows; import at most ${MAX_IMPORT_ROWS} at a time. Split it into several files.`] }
  }

  const col = (cells: string[], name: string) => {
    const i = header.indexOf(name)
    const v = i >= 0 ? cells[i] : ''
    return v ? v : undefined
  }
  const rows: ParsedRow[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  for (const { cells, line: n } of data) {
    const name = col(cells, 'name')
    const tracking = (col(cells, 'tracking') ?? '').toUpperCase()
    const location = col(cells, 'location')
    if (!name) { errors.push(`Line ${n}: name is empty.`); continue }
    if (tracking !== 'SERIALIZED' && tracking !== 'QUANTITY') { errors.push(`Line ${n}: tracking must be serialized or quantity.`); continue }
    if (!location) { errors.push(`Line ${n}: location is empty.`); continue }
    if (['name', 'manufacturer', 'model'].some((c) => /[\r\n]/.test(col(cells, c) ?? ''))) { errors.push(`Line ${n}: name, manufacturer and model can't contain a line break.`); continue }
    const tooLong = Object.entries(LIMITS).find(([c, max]) => (col(cells, c)?.length ?? 0) > max)
    if (tooLong) { errors.push(`Line ${n}: ${tooLong[0]} is too long (${tooLong[1]} characters at most).`); continue }
    const quantityText = col(cells, 'quantity')
    let quantity: number | undefined
    if (tracking === 'QUANTITY') {
      if (col(cells, 'serial') || col(cells, 'owner_tag')) { errors.push(`Line ${n}: a quantity item has no serial or owner tag; leave them blank.`); continue }
      if (quantityText === undefined || !/^\d+$/.test(quantityText)) { errors.push(`Line ${n}: a quantity item needs a whole-number quantity above zero.`); continue }
      quantity = Number(quantityText)
      const problem = quantityProblem(quantity)
      if (problem) { errors.push(`Line ${n}: ${problem}`); continue }
    } else if (quantityText !== undefined && quantityText !== '1') {
      errors.push(`Line ${n}: a serialized item is one unit per row; quantity must be blank or 1 (list each unit on its own row).`)
      continue
    }
    const row: ParsedRow = {
      name, manufacturer: col(cells, 'manufacturer'), model: col(cells, 'model'), category: col(cells, 'category'),
      trackingMode: tracking, serial: col(cells, 'serial'), ownerTag: col(cells, 'owner_tag'), quantity, location,
    }
    if (tracking === 'SERIALIZED') {
      if (!row.serial && !row.ownerTag) { errors.push(`Line ${n}: a serialized item needs a serial or an owner tag.`); continue }
      const dup = [['serial', row.serial], ['owner tag', row.ownerTag]].find(([k, v]) => v && seen.has(`${itemKey(row)}\u0001${k}\u0001${v.toLowerCase()}`))
      if (dup) {
        const first = seen.get(`${itemKey(row)}\u0001${dup[0]}\u0001${dup[1]!.toLowerCase()}`)
        errors.push(`Line ${n}: ${dup[0]} ${dup[1]} is already used by the same item on line ${first}.`)
        continue
      }
      for (const [k, v] of [['serial', row.serial], ['owner tag', row.ownerTag]]) if (v) seen.set(`${itemKey(row)}\u0001${k}\u0001${v.toLowerCase()}`, n)
    }
    rows.push(row)
    lineOf.set(row, n)
  }
  return { rows, errors: capErrors(errors) }
}

const lineOf = new WeakMap<ParsedRow, number>()

export type ImportGroup = {
  key: string; name: string; manufacturer?: string; model?: string; category?: string
  trackingMode: 'SERIALIZED' | 'QUANTITY'
  units: { serial?: string; ownerTag?: string; location: string }[]
  stock: { location: string; quantity: number }[]
}

/** Rows to items: one group per (name, manufacturer, model), in file order. Contradictions are errors. */
export function groupRows(rows: ParsedRow[]): { groups: ImportGroup[]; errors: string[] } {
  const groups = new Map<string, ImportGroup>()
  const errors: string[] = []
  for (const r of rows) {
    const key = itemKey(r)
    const at = lineOf.get(r)
    const where = at ? `Line ${at}: ` : ''
    let g = groups.get(key)
    if (!g) {
      g = { key, name: r.name, manufacturer: r.manufacturer, model: r.model, category: r.category, trackingMode: r.trackingMode, units: [], stock: [] }
      groups.set(key, g)
    }
    if (g.trackingMode !== r.trackingMode) { errors.push(`${where}${r.name} is listed as both serialized and quantity.`); continue }
    g.category ??= r.category
    if (r.trackingMode === 'SERIALIZED') g.units.push({ serial: r.serial, ownerTag: r.ownerTag, location: r.location })
    else if (g.stock.some((s) => s.location.toLowerCase() === r.location.toLowerCase())) {
      errors.push(`${where}${r.name} is listed at ${r.location} more than once; combine the quantities into one row.`)
    } else g.stock.push({ location: r.location, quantity: r.quantity! })
  }
  return { groups: [...groups.values()], errors: capErrors(errors) }
}
