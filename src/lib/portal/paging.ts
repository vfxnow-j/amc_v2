/** ?limit= for list endpoints: default 50, 1–200; null when malformed. */
export function parseLimit(raw: string | null): number | null {
  if (raw == null || raw === '') return 50
  if (!/^\d{1,3}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 && n <= 200 ? n : null
}

/** (updated_at, id) of the last row seen — opaque to the portal. */
export type Cursor = { at: Date; id: string }
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at.toISOString()}|${c.id}`).toString('base64url')
}
export function decodeCursor(raw: string): Cursor | null {
  try {
    const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    const d = new Date(at)
    return !Number.isNaN(d.getTime()) && /^[A-Za-z0-9_-]{1,64}$/.test(id ?? '') ? { at: d, id } : null
  } catch {
    return null
  }
}

