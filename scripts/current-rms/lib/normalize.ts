/** Numeric barcodes compare as 6-digit zero-padded (leading zeros dropped first); others verbatim, upper-cased. */
export function normalizeBarcode(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (/^\d+$/.test(s)) return String(parseInt(s, 10)).padStart(6, '0')
  return s.toUpperCase()
}

/** 'PO-000248' | '000248' | '248' | 'po 248' → 'PO-000248'. Anything else (AMAZON, N/A) → null. */
export function normalizePoNumber(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const m = s.match(/^(?:PO-?)?0*(\d{1,6})$/)
  return m ? `PO-${m[1].padStart(6, '0')}` : null
}
