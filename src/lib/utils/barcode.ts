/**
 * Generate a unique barcode for an asset
 * Format: VFX-YYYYMMDD-XXXXX (e.g., VFX-20260204-A1B2C)
 */
export function generateBarcode(prefix = 'VFX'): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  // Generate a random 5-character alphanumeric string
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let random = ''
  for (let i = 0; i < 5; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `${prefix}-${year}${month}${day}-${random}`
}

/**
 * Generate an asset tag
 * Format: AST-XXXXX (e.g., AST-00001)
 */
export function generateAssetTag(sequence: number, prefix = 'AST'): string {
  return `${prefix}-${String(sequence).padStart(5, '0')}`
}

/**
 * Generate sequential zero-padded numeric barcodes
 * Format: 00#### (e.g., 006825, 006826, 006827...)
 * @param startingNumber - The starting number (e.g., 6825)
 * @param count - How many barcodes to generate
 * @param padLength - Total length with zero padding (default 6)
 */
export function generateSequentialBarcodes(
  startingNumber: number,
  count: number,
  padLength = 6
): string[] {
  return Array.from({ length: count }, (_, i) =>
    String(startingNumber + i).padStart(padLength, '0')
  )
}

/**
 * Parse a zero-padded barcode string back to its numeric value
 */
export function parseBarcodeNumber(barcode: string): number | null {
  const num = parseInt(barcode, 10)
  return isNaN(num) ? null : num
}

/**
 * Parse a barcode into its alphabetic prefix and numeric suffix.
 * Supports formats like "VFX0001", "00#### ", "ABC123", etc.
 * Returns { prefix, number, padLength } or null if no numeric suffix found.
 */
export function parseBarcodeWithPrefix(barcode: string): { prefix: string; number: number; padLength: number } | null {
  const match = barcode.match(/^([A-Za-z]*)(\d+)$/)
  if (!match) return null
  const prefix = match[1]
  const numStr = match[2]
  const num = parseInt(numStr, 10)
  if (isNaN(num)) return null
  return { prefix, number: num, padLength: numStr.length }
}

/**
 * Generate sequential barcodes from a starting barcode that may have an alphabetic prefix.
 * E.g. "VFX0001" with count 3 → ["VFX0001", "VFX0002", "VFX0003"]
 * E.g. "006825" with count 2 → ["006825", "006826"]
 */
export function generateSequentialBarcodesFromStart(startBarcode: string, count: number): string[] {
  const parsed = parseBarcodeWithPrefix(startBarcode)
  if (!parsed) return []
  return Array.from({ length: count }, (_, i) =>
    parsed.prefix + String(parsed.number + i).padStart(parsed.padLength, '0')
  )
}

/**
 * Validate barcode format (supports both legacy VFX-* and new numeric 00#### format)
 */
export function isValidBarcode(barcode: string): boolean {
  // Accept any non-empty barcode — legacy VFX-*, numeric 00####, or alphanumeric like VFX0001
  return barcode.trim().length > 0
}

/**
 * Validate asset tag format
 */
export function isValidAssetTag(assetTag: string): boolean {
  const pattern = /^[A-Z]{2,4}-\d{5}$/
  return pattern.test(assetTag)
}

/**
 * Generate a barcode SVG (simple Code39 representation)
 * Returns an SVG string that can be rendered
 */
export function generateBarcodeSVG(value: string, width = 200, height = 50): string {
  // Code39 character patterns (0 = narrow, 1 = wide)
  const code39: Record<string, string> = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
    '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
    '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
    'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
    'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
    'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
    'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
    'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
    '-': 'nwnnnnwnw', '.': 'wwnnnnnwn', ' ': 'nwwnnnnwn', '*': 'nwnnwnwnn',
  }

  const cleanValue = value.toUpperCase().replace(/[^A-Z0-9\-. ]/g, '')
  const fullCode = `*${cleanValue}*`

  const bars: { x: number; width: number }[] = []
  let x = 0
  const narrowWidth = width / (fullCode.length * 13 + (fullCode.length - 1))
  const wideWidth = narrowWidth * 3
  const gap = narrowWidth

  for (const char of fullCode) {
    const pattern = code39[char] || code39['-']
    for (let i = 0; i < pattern.length; i++) {
      const isWide = pattern[i] === 'w'
      const barWidth = isWide ? wideWidth : narrowWidth
      if (i % 2 === 0) { // Bars are at even positions
        bars.push({ x, width: barWidth })
      }
      x += barWidth
    }
    x += gap // Gap between characters
  }

  const svgBars = bars.map(bar =>
    `<rect x="${bar.x}" y="0" width="${bar.width}" height="${height - 15}" fill="currentColor"/>`
  ).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" width="${width}" height="${height}">
    ${svgBars}
    <text x="${x / 2}" y="${height - 2}" font-size="10" text-anchor="middle" fill="currentColor">${cleanValue}</text>
  </svg>`
}
