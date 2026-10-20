/**
 * Minimal RFC4180 CSV reader.
 *
 * Deliberately dependency-free: the project has no CSV parser, and the one
 * spreadsheet library present (`xlsx`) carries an unfixed advisory, so it is
 * not worth pulling into a path that reads third-party export files.
 *
 * Handles quoted fields, embedded commas/newlines, doubled quotes ("") and a
 * UTF-8 BOM. Returns rows of raw strings; callers do their own typing.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // handled by the \n branch
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }

  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Rows keyed by header name, skipping rows that are entirely empty. */
export function parseCsvObjects(
  text: string,
  headerRowIndex = 0
): Record<string, string>[] {
  const rows = parseCsv(text)
  const header = rows[headerRowIndex].map((h) => h.trim())
  return rows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()))
      return o
    })
}
