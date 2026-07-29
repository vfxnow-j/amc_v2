import ExcelJS from 'exceljs'

export type ExcelRow = Record<string, unknown>

/**
 * Parse an Excel file from a buffer and return rows as objects
 * Column headers become keys
 */
export async function parseExcelBuffer(buffer: ArrayBuffer): Promise<ExcelRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    throw new Error('No worksheet found in Excel file')
  }

  const rows: ExcelRow[] = []
  const headers: string[] = []

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // First row is headers
      row.eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '').trim()
      })
    } else {
      // Data rows
      const rowData: ExcelRow = {}
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber]
        if (header) {
          // Handle different cell types
          let value: unknown = cell.value

          // Handle rich text
          if (value && typeof value === 'object' && 'richText' in value) {
            value = (value as { richText: { text: string }[] }).richText
              .map(rt => rt.text)
              .join('')
          }

          // Handle formula results
          if (value && typeof value === 'object' && 'result' in value) {
            value = (value as { result: unknown }).result
          }

          // Handle hyperlinks
          if (value && typeof value === 'object' && 'text' in value) {
            value = (value as { text: string }).text
          }

          rowData[header] = value
        }
      })

      // Only add non-empty rows
      if (Object.keys(rowData).length > 0) {
        rows.push(rowData)
      }
    }
  })

  return rows
}

/**
 * Get cell value as string
 */
export function getCellString(row: ExcelRow, column: string): string {
  const value = row[column]
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Get cell value as number
 */
export function getCellNumber(row: ExcelRow, column: string): number | undefined {
  const value = row[column]
  if (value === null || value === undefined || value === '') return undefined

  // Handle string with currency formatting
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '')
    const num = parseFloat(cleaned)
    return isNaN(num) ? undefined : num
  }

  if (typeof value === 'number') return value
  return undefined
}

/**
 * Get cell value as date
 */
export function getCellDate(row: ExcelRow, column: string): Date | undefined {
  const value = row[column]
  if (value === null || value === undefined || value === '') return undefined

  // ExcelJS returns Date objects for date cells
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value
  }

  // Handle Excel serial date numbers
  if (typeof value === 'number') {
    // Excel serial date: days since 1900-01-01 (with leap year bug)
    const date = new Date((value - 25569) * 86400 * 1000)
    return isNaN(date.getTime()) ? undefined : date
  }

  // Try parsing string
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return isNaN(parsed.getTime()) ? undefined : parsed
  }

  return undefined
}

/**
 * Create an Excel file from an array of objects
 * Returns base64 encoded xlsx data
 */
export async function createExcelBuffer(
  data: Record<string, unknown>[],
  sheetName = 'Data'
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(sheetName)

  if (data.length === 0) {
    // Empty worksheet
    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer).toString('base64')
  }

  // Get headers from first row
  const headers = Object.keys(data[0])

  // Add header row with styling
  worksheet.addRow(headers)
  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }

  // Add data rows
  for (const row of data) {
    const values = headers.map(h => {
      const val = row[h]
      // Format dates
      if (val instanceof Date) {
        return val.toISOString().split('T')[0]
      }
      return val
    })
    worksheet.addRow(values)
  }

  // Auto-size columns
  worksheet.columns.forEach((column, index) => {
    const header = headers[index]
    let maxLength = header.length

    data.forEach(row => {
      const val = row[header]
      const len = val != null ? String(val).length : 0
      if (len > maxLength) maxLength = len
    })

    column.width = Math.min(maxLength + 2, 50)
  })

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer).toString('base64')
}
