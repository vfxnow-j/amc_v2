/**
 * Pure helpers for the 9b screens: reading search params that anyone can type into
 * the address bar, splitting pasted serials, and the grouping the locations and
 * release screens show. No database, no next, no dates that cross to the client.
 */

export type ReleaseTab = 'release' | 'return'
export type LogType = 'RECEIVE' | 'MOVE' | 'RELEASE' | 'RETURN'
export const LOG_TYPES: LogType[] = ['RECEIVE', 'MOVE', 'RELEASE', 'RETURN']
export const MAX_RECEIVE_UNITS = 500

type Param = string | string[] | undefined
const one = (v: Param): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))

/** Anything but "return" is the Release tab. */
export function parseTab(v: Param): ReleaseTab {
  return one(v).trim().toLowerCase() === 'return' ? 'return' : 'release'
}

/** A search term: trimmed, bounded, never an array. */
export function parseQuery(v: Param): string {
  return one(v).trim().slice(0, 100)
}

/** Filters for the movement log. An unknown type or an oversized id is dropped, not an error. */
export function parseLogFilter(sp: { item?: Param; type?: Param }): { itemId: string | null; type: LogType | null } {
  const item = one(sp.item).trim()
  const type = one(sp.type).trim().toUpperCase()
  return {
    itemId: item && item.length <= 64 ? item : null,
    type: (LOG_TYPES as string[]).includes(type) ? (type as LogType) : null,
  }
}

/** Case-insensitive "does any of these fields contain the term". An empty term matches all. */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return fields.some((f) => !!f && f.toLowerCase().includes(t))
}

/**
 * Pasted serials, one per line (commas and tabs also separate). Blank lines are
 * dropped, repeats (case-insensitive, also against what is already listed) are
 * counted and skipped, and the total never goes past the cap.
 */
export function splitSerials(text: string, existing: string[] = [], cap = MAX_RECEIVE_UNITS): { serials: string[]; duplicates: number; overCap: number } {
  const seen = new Set(existing.map((s) => s.trim().toLowerCase()).filter(Boolean))
  const room = Math.max(0, cap - existing.length)
  const serials: string[] = []
  let duplicates = 0
  let overCap = 0
  for (const raw of text.split(/[\r\n,\t]+/)) {
    const s = raw.trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) { duplicates++; continue }
    if (serials.length >= room) { overCap++; continue }
    seen.add(key)
    serials.push(s)
  }
  return { serials, duplicates, overCap }
}

export type DraftUnit = { serial: string; ownerTag: string; scanTag: string; condition: string }

/** The units to send: rows with nothing typed in them are left out. */
export function unitsToSend(rows: DraftUnit[]): { serial?: string; ownerTag?: string; scanTag?: string; condition?: string }[] {
  const t = (s: string) => s.trim() || undefined
  return rows
    .map((r) => ({ serial: t(r.serial), ownerTag: t(r.ownerTag), scanTag: t(r.scanTag), condition: t(r.condition) }))
    .filter((r) => r.serial || r.ownerTag || r.scanTag || r.condition)
}

/** A message when any unit to send has no serial, owner tag or scan tag (only a condition): it could not be told apart later. */
export function missingIdentity(units: { serial?: string; ownerTag?: string; scanTag?: string }[]): string | null {
  return units.some((u) => !u.serial && !u.ownerTag && !u.scanTag) ? 'Give each unit a serial, owner tag or scan tag.' : null
}

/** Repeated serials, owner tags or scan tags inside one receipt (case-insensitive): a typo caught before the round trip. */
export function duplicateIdentity(rows: DraftUnit[]): string | null {
  for (const field of ['serial', 'ownerTag', 'scanTag'] as const) {
    const seen = new Set<string>()
    for (const r of rows) {
      const v = r[field].trim().toLowerCase()
      if (!v) continue
      if (seen.has(v)) return `“${r[field].trim()}” is listed twice.`
      seen.add(v)
    }
  }
  return null
}

export type PlacedUnit = { id: string; itemId: string; itemName: string; serial: string | null; ownerTag: string | null; scanTag: string | null; status: string; currentLocationId: string | null }
export type PlacedStock = { id: string; itemId: string; itemName: string; locationId: string; deployed: boolean; quantity: number }
export type GroupEntry = { key: string; itemId: string; itemName: string; detail: string; quantity: number | null }
export type Group = { locationId: string; name: string; /** The location id has no match in VFXnow (it was removed). */ removed: boolean; entries: GroupEntry[] }

const unitDetail = (u: PlacedUnit) => [u.serial && `Serial ${u.serial}`, u.ownerTag && `Tag ${u.ownerTag}`, u.scanTag && `Scan ${u.scanTag}`].filter(Boolean).join(' · ') || 'Unit'

function group(entries: { locationId: string | null; entry: GroupEntry }[], names: Map<string, string>): Group[] {
  const by = new Map<string, Group>()
  for (const { locationId, entry } of entries) {
    const id = locationId ?? ''
    let g = by.get(id)
    if (!g) {
      g = { locationId: id, name: locationId ? (names.get(locationId) ?? 'Removed location') : 'No location recorded', removed: !!locationId && !names.has(locationId), entries: [] }
      by.set(id, g)
    }
    g.entries.push(entry)
  }
  const groups = [...by.values()]
  for (const g of groups) g.entries.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.detail.localeCompare(b.detail))
  return groups.sort((a, b) => a.name.localeCompare(b.name))
}

/** In-storage gear grouped by where it sits: units that are IN_STORAGE and stock rows that are not deployed. */
export function groupStored(units: PlacedUnit[], stock: PlacedStock[], names: Map<string, string>): Group[] {
  return group([
    ...units.filter((u) => u.status === 'IN_STORAGE').map((u) => ({ locationId: u.currentLocationId, entry: { key: u.id, itemId: u.itemId, itemName: u.itemName, detail: unitDetail(u), quantity: null } })),
    ...stock.filter((s) => !s.deployed && s.quantity > 0).map((s) => ({ locationId: s.locationId, entry: { key: s.id, itemId: s.itemId, itemName: s.itemName, detail: 'Counted stock', quantity: s.quantity } })),
  ], names)
}

/** Deployed gear grouped by the site it was released to. */
export function groupDeployed(units: PlacedUnit[], stock: PlacedStock[], names: Map<string, string>): Group[] {
  return group([
    ...units.filter((u) => u.status === 'DEPLOYED').map((u) => ({ locationId: u.currentLocationId, entry: { key: u.id, itemId: u.itemId, itemName: u.itemName, detail: unitDetail(u), quantity: null } })),
    ...stock.filter((s) => s.deployed && s.quantity > 0).map((s) => ({ locationId: s.locationId, entry: { key: s.id, itemId: s.itemId, itemName: s.itemName, detail: 'Counted stock', quantity: s.quantity } })),
  ], names)
}

export type ReleaseMovement = {
  type: string; correctsId: string | null; finalToOwner: boolean; unitId: string | null; itemId: string
  toLocationId: string | null; actorUserId: string; occurredAt: Date; recipient: string | null
}
export type ReleaseNote = { actorUserId: string; occurredAt: Date; recipient: string | null }

/** The one place the keys of `latestReleases` are spelled, so the producer and the release page cannot drift apart. */
export const releaseKey = {
  unit: (unitId: string) => `u:${unitId}`,
  stock: (itemId: string, locationId: string) => `s:${itemId}:${locationId}`,
}

/**
 * The most recent real RELEASE for each unit (`releaseKey.unit`) and for each
 * stock row (`releaseKey.stock`, by where it went). Corrections and
 * final hand-backs are not releases to a site.
 */
export function latestReleases(movements: ReleaseMovement[]): Map<string, ReleaseNote> {
  const out = new Map<string, ReleaseNote>()
  for (const m of movements) {
    if (m.type !== 'RELEASE' || m.correctsId || m.finalToOwner) continue
    const key = m.unitId ? releaseKey.unit(m.unitId) : m.toLocationId ? releaseKey.stock(m.itemId, m.toLocationId) : null
    if (!key) continue
    const have = out.get(key)
    if (!have || have.occurredAt < m.occurredAt) out.set(key, { actorUserId: m.actorUserId, occurredAt: m.occurredAt, recipient: m.recipient })
  }
  return out
}
