/**
 * What an item or package already says about itself, as the specs the portal
 * shows — read live on every /v1/offers call, never copied. The spec source is the
 * item's base build (Settings → Configurable items): one line per slot, parts
 * in the same slot joined. A package merges the builds of the items in it.
 */

export type BuildPart = { slot: string; quantity: number; label: string | null; componentAsset: { name: string } | null }
export type SpecRow = { key: string; value: string }

const SLOT_LABEL: Record<string, string> = { GPU: 'GPU', MEMORY: 'Memory', STORAGE: 'Storage', ADDON: 'Add-on', OTHER: 'Other' }
const SLOT_ORDER = ['GPU', 'MEMORY', 'STORAGE', 'ADDON', 'OTHER']

/** Base-build parts → one row per slot, in GPU, Memory, Storage, Add-on, Other order. */
export function buildSpecs(parts: BuildPart[]): SpecRow[] {
  const bySlot = new Map<string, string[]>()
  for (const part of parts) {
    const name = (part.label || part.componentAsset?.name || '').trim()
    if (!name) continue
    const text = `${part.quantity > 1 ? `${part.quantity}× ` : ''}${name}`
    const list = bySlot.get(part.slot) ?? []
    if (!list.includes(text)) list.push(text)
    bySlot.set(part.slot, list)
  }
  return [...bySlot]
    .sort(([a], [b]) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b))
    .map(([slot, list]) => ({ key: SLOT_LABEL[slot] ?? slot, value: list.join(' + ') }))
}

/** The asset's own `specs` JSON, when anyone has filled it: [{key,value}] or {key: value}. */
export function jsonSpecs(v: unknown): SpecRow[] {
  if (Array.isArray(v)) {
    return v
      .filter((r): r is { key: unknown; value: unknown } => !!r && typeof r === 'object')
      .map((r) => ({ key: String(r.key ?? '').trim(), value: String(r.value ?? '').trim() }))
      .filter((r) => r.key && r.value)
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([key, value]) => ({ key: key.trim(), value: String(value ?? '').trim() }))
      .filter((r) => r.key && r.value)
  }
  return []
}

/** Rows with the same key merged (first key's position kept), values joined. */
export function mergeSpecs(rows: SpecRow[]): SpecRow[] {
  const out = new Map<string, string[]>()
  for (const row of rows) {
    const list = out.get(row.key) ?? []
    if (!list.includes(row.value)) list.push(row.value)
    out.set(row.key, list)
  }
  return [...out].map(([key, list]) => ({ key, value: list.join(' + ') }))
}
